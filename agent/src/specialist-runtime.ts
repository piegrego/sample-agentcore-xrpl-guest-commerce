// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  RetrieveMemoryRecordsCommand
} from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockRuntimeClient,
  ConverseCommand
} from "@aws-sdk/client-bedrock-runtime";
import { AwsClient } from "aws4fetch";
import {
  parseAgentInvocation,
  type AgentInvocation
} from "../../shared/contracts";

type SpecialistRole = "devops" | "security";
type TraceStatus = "success" | "skipped" | "error";

const region = process.env.AWS_REGION || "us-east-1";
const modelId = process.env.MODEL_ID || "amazon.nova-lite-v1:0";
const role = process.env.AGENT_ROLE as SpecialistRole;
const memoryId = process.env.OPS_MEMORY_ID;
const gatewayUrl = process.env.OPS_GATEWAY_URL;
const gatewayTarget = process.env.OPS_GATEWAY_TARGET_PREFIX || "OpsTools";
const agentcore = new BedrockAgentCoreClient({ region });
const bedrock = new BedrockRuntimeClient({ region });

function json(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

function safeId(value: string | undefined, prefix: string) {
  return (value?.trim() || `${prefix}-${crypto.randomUUID()}`)
    .replace(/[^a-zA-Z0-9_.:-]/g, "-")
    .slice(0, 100);
}

function traceCollector() {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const steps: Array<Record<string, unknown>> = [];
  return {
    add(
      category: string,
      name: string,
      status: TraceStatus,
      detail: string,
      durationMs = 0
    ) {
      steps.push({
        id: `step-${String(steps.length + 1).padStart(2, "0")}`,
        category,
        name,
        status,
        detail,
        offsetMs: Math.round(performance.now() - start),
        durationMs
      });
    },
    finish() {
      return {
        startedAt,
        totalDurationMs: Math.round(performance.now() - start),
        steps
      };
    }
  };
}

function parseGatewayResponse(text: string) {
  const payload = text.includes("\ndata:")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
        .at(-1) || "{}"
    : text;
  const envelope = JSON.parse(payload) as {
    error?: { message?: string };
    result?: {
      content?: Array<{ text?: string; json?: unknown }>;
      structuredContent?: unknown;
    };
  };
  if (envelope.error) {
    throw new Error(envelope.error.message || "Gateway rejected the tool call.");
  }
  if (envelope.result?.structuredContent !== undefined) {
    return envelope.result.structuredContent;
  }
  const content = envelope.result?.content?.[0];
  if (content?.json !== undefined) return content.json;
  if (content?.text) {
    try {
      return JSON.parse(content.text);
    } catch {
      return { message: content.text };
    }
  }
  return envelope.result ?? envelope;
}

async function callGateway(name: string, input: Record<string, unknown>) {
  if (!gatewayUrl) throw new Error("OPS_GATEWAY_URL is not configured.");
  const credentials = await agentcore.config.credentials();
  const aws = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    service: "bedrock-agentcore",
    region,
    retries: 2
  });
  const response = await aws.fetch(gatewayUrl, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: {
        name: `${gatewayTarget}___${name}`,
        arguments: input
      }
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gateway returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return parseGatewayResponse(text);
}

async function recall(actorId: string, prompt: string) {
  const namespace = `/users/${actorId}/operations`;
  if (!memoryId) {
    return {
      namespace,
      records: [] as string[],
      status: "skipped" as TraceStatus,
      detail: "Operations Memory is not configured."
    };
  }
  try {
    const response = await agentcore.send(
      new RetrieveMemoryRecordsCommand({
        memoryId,
        namespace,
        searchCriteria: { searchQuery: prompt.slice(0, 500), topK: 5 }
      })
    );
    const records = (response.memoryRecordSummaries ?? [])
      .flatMap((item) => (item.content?.text ? [item.content.text] : []))
      .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 280));
    return {
      namespace,
      records,
      status: "success" as TraceStatus,
      detail: `Recalled ${records.length} prior operations record(s).`
    };
  } catch {
    return {
      namespace,
      records: [] as string[],
      status: "error" as TraceStatus,
      detail: "Operations memory lookup failed."
    };
  }
}

async function remember(
  actorId: string,
  sessionId: string,
  prompt: string,
  response: string
) {
  if (!memoryId) return "skipped" as TraceStatus;
  try {
    await agentcore.send(
      new CreateEventCommand({
        memoryId,
        actorId,
        sessionId,
        eventTimestamp: new Date(),
        clientToken: crypto.randomUUID(),
        payload: [
          {
            conversational: {
              role: "USER",
              content: { text: prompt }
            }
          },
          {
            conversational: {
              role: "ASSISTANT",
              content: { text: response }
            }
          }
        ]
      })
    );
    return "success" as TraceStatus;
  } catch {
    return "error" as TraceStatus;
  }
}

function toolPlan(specialist: SpecialistRole, prompt: string) {
  if (specialist === "security") {
    return [
      { name: "audit_security_posture", input: {} },
      { name: "get_iam_summary", input: {} }
    ];
  }
  const match = prompt.match(/\b(\d{1,4})\s*(?:minute|min|hour|hr)/i);
  const requested = match ? Number(match[1]) : 60;
  const minutes = /\bhour|hr/i.test(match?.[0] || "")
    ? requested * 60
    : requested;
  return [
    { name: "get_deployment_health", input: {} },
    {
      name: "get_recent_service_events",
      input: { windowMinutes: Math.min(1440, Math.max(5, minutes)) }
    }
  ];
}

function findings(evidence: Array<{ name: string; result: unknown }>) {
  const audit = evidence.find((item) => item.name === "audit_security_posture");
  const result =
    audit?.result && typeof audit.result === "object"
      ? (audit.result as Record<string, unknown>)
      : undefined;
  return Array.isArray(result?.findings) ? result.findings : undefined;
}

export async function handleSpecialistInvocation(input: AgentInvocation) {
  if (role !== "devops" && role !== "security") {
    throw new Error("AGENT_ROLE must identify a specialist Runtime.");
  }
  if (
    input.approvePayment ||
    input.paymentDelegationToken ||
    input.paymentSessionId ||
    input.paymentInstrumentId
  ) {
    throw new Error("Specialist Runtimes cannot receive payment authority.");
  }
  const trace = traceCollector();
  const actorId = safeId(input.actorId, "demo-user");
  const sessionId = safeId(input.sessionId, `${role}-session`);
  const memory = await recall(actorId, input.prompt);
  trace.add("memory", "RetrieveMemoryRecords", memory.status, memory.detail);

  const evidence: Array<{ name: string; result: unknown }> = [];
  for (const tool of toolPlan(role, input.prompt)) {
    const startedAt = performance.now();
    try {
      const result = await callGateway(tool.name, tool.input);
      const duration = Math.round(performance.now() - startedAt);
      trace.add(
        "policy",
        "AgentCore Gateway policy",
        "success",
        `ACTIVE policy allowed ${gatewayTarget}___${tool.name}.`,
        duration
      );
      trace.add(
        "tool",
        `${gatewayTarget}___${tool.name}`,
        result && typeof result === "object" && "error" in result
          ? "error"
          : "success",
        "Read-only AWS evidence returned through the Gateway.",
        duration
      );
      evidence.push({ name: tool.name, result });
    } catch (error) {
      trace.add(
        "tool",
        `${gatewayTarget}___${tool.name}`,
        "error",
        error instanceof Error ? error.message : "Unknown Gateway error."
      );
      evidence.push({
        name: tool.name,
        result: { error: "gateway_call_failed" }
      });
    }
  }

  const modelStarted = performance.now();
  const response = await bedrock.send(
    new ConverseCommand({
      modelId,
      system: [
        {
          text:
            role === "devops"
              ? "You are the sample's read-only DevOps specialist. Answer only from supplied evidence. Lead with health and never claim to make changes."
              : "You are the sample's read-only Security specialist. Answer only from supplied evidence. Lead with highest-severity items and keep remediation proposal-only."
        }
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              text: [
                `User request: ${input.prompt}`,
                `Prior memory: ${memory.records.join(" | ") || "none"}`,
                `Live evidence: ${JSON.stringify(evidence).slice(0, 24_000)}`
              ].join("\n\n")
            }
          ]
        }
      ],
      inferenceConfig: { maxTokens: 850, temperature: 0.1 }
    })
  );
  const message =
    response.output?.message?.content
      ?.flatMap((block) => ("text" in block && block.text ? [block.text] : []))
      .join("\n")
      .trim() || `${role} evidence collection completed.`;
  trace.add(
    "model",
    "Bedrock Converse",
    "success",
    `Synthesized ${evidence.length} read-only evidence result(s).`,
    Math.round(performance.now() - modelStarted)
  );
  const writeStatus = await remember(actorId, sessionId, input.prompt, message);
  trace.add(
    "memory",
    "CreateEvent",
    writeStatus,
    "Recorded the investigation when Operations Memory was available."
  );

  return {
    message,
    actorId,
    sessionId,
    agentMode: role,
    paymentApproved: false,
    memoryEnabled: Boolean(memoryId),
    memory: {
      enabled: Boolean(memoryId),
      namespace: memory.namespace,
      recalled: input.includeMemoryDetails ? memory.records : [],
      recallStatus: memory.status,
      writeStatus
    },
    trace: trace.finish(),
    findings: findings(evidence),
    orchestration: {
      selectedAgent: role,
      route: [
        {
          name: role === "devops" ? "DevOps Agent" : "Security Agent",
          role,
          status: "success",
          runtimeSessionId: sessionId
        }
      ],
      gateway: {
        used: true,
        target: gatewayTarget,
        policyMode: "ENFORCED",
        mutationAllowed: false,
        tools: evidence.map((item) => item.name)
      }
    }
  };
}

export async function handleSpecialistRequest(request: Request) {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/ping") {
    return json(200, {
      status: "Healthy",
      service: `agentcore-xrpl-${role}`
    });
  }
  if (request.method === "POST" && pathname === "/invocations") {
    try {
      return json(
        200,
        await handleSpecialistInvocation(
          parseAgentInvocation(await request.json())
        )
      );
    } catch (error) {
      console.error(error);
      return json(400, {
        error: "invocation_failed",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  return json(404, { error: "not_found" });
}
