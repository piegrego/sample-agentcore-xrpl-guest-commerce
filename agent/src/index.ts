// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  InvokeAgentRuntimeCommand,
  RetrieveMemoryRecordsCommand
} from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool
} from "@aws-sdk/client-bedrock-runtime";
import {
  GetSecretValueCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import type { x402HTTPClient } from "@x402/core/http";
import type { Network } from "@x402/core/types";
import { createXrplWalletSigner } from "@x402/xrpl";
import { Wallet } from "xrpl";
import {
  parseAgentInvocation,
  specialistInvocation,
  type AgentInvocation
} from "../../shared/contracts";
import {
  prepareXrplPaymentTransaction,
  xrplHttpEndpoint
} from "../../shared/xrpl";
import {
  createXrplPayer
} from "../../packages/agentcore-xrpl-settlement/src";
import {
  createAgentCorePaymentBackend,
  createPaymentClient,
  createXrplPaymentBackend,
  PaymentClientError
} from "../../packages/x402-payments/src";

export { xrplHttpEndpoint } from "../../shared/xrpl";

const PORT = Number(process.env.PORT || 8080);
const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.MODEL_ID || "amazon.nova-lite-v1:0";
const STOREFRONT_ORIGIN =
  process.env.STOREFRONT_ORIGIN || "http://127.0.0.1:4173";
const MEMORY_ID = process.env.MEMORY_ID;
const PAYMENT_MANAGER_ARN = process.env.PAYMENT_MANAGER_ARN;
const PAYMENT_BACKEND =
  process.env.PAYMENT_BACKEND || process.env.PAYMENT_MODE || "sandbox";
const PAYMENT_ASSET = configuredPaymentAsset(
  process.env.PAYMENT_ASSET || "USDC"
);
const XRPL_NETWORK = (process.env.XRPL_NETWORK || "xrpl:1") as Network;
const PAYMENT_MAX_AMOUNT = configuredMaximum(
  process.env.PAYMENT_MAX_AMOUNT || "2"
);
const XRPL_WALLET_SEED_SECRET_ARN =
  process.env.XRPL_WALLET_SEED_SECRET_ARN;
const XRPL_RUNTIME_PAYER_ADDRESS =
  process.env.XRPL_RUNTIME_PAYER_ADDRESS;
const DEVOPS_RUNTIME_ARN = process.env.DEVOPS_RUNTIME_ARN;
const SECURITY_RUNTIME_ARN = process.env.SECURITY_RUNTIME_ARN;

const bedrock = new BedrockRuntimeClient({ region: REGION });
const agentcore = new BedrockAgentCoreClient({ region: REGION });
const secrets = new SecretsManagerClient({ region: REGION });

function configuredPaymentAsset(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "USDC" || normalized === "XRP") return normalized;
  throw new Error('PAYMENT_ASSET must be either "USDC" or "XRP".');
}

function configuredMaximum(value: string) {
  const maximum = Number(value);
  if (!Number.isFinite(maximum) || maximum <= 0) {
    throw new Error("PAYMENT_MAX_AMOUNT must be a positive number.");
  }
  return maximum;
}

export function xrpAtomicPaymentLimit(maximum: number) {
  return String(Math.floor(maximum * 1_000_000));
}

export function assertRuntimePayerAddress(
  actualAddress: string,
  configuredAddress?: string
) {
  if (!configuredAddress || actualAddress !== configuredAddress) {
    throw new Error(
      "The XRPL wallet secret does not match XRPL_RUNTIME_PAYER_ADDRESS."
    );
  }
}

type InvocationInput = AgentInvocation;

interface ToolUseBlock {
  toolUse: {
    toolUseId: string;
    name: string;
    input?: unknown;
  };
}

type TraceCategory =
  | "runtime"
  | "agent"
  | "policy"
  | "memory"
  | "model"
  | "tool";
type TraceStatus = "success" | "skipped" | "error";

interface TraceStep {
  id: string;
  category: TraceCategory;
  name: string;
  status: TraceStatus;
  detail: string;
  offsetMs: number;
  durationMs: number;
}

interface MemoryRecall {
  namespace: string;
  records: string[];
  status: TraceStatus;
  durationMs: number;
  detail: string;
}

interface MemoryWrite {
  status: TraceStatus;
  durationMs: number;
  detail: string;
}

interface SpecialistResult {
  message: string;
  actorId: string;
  sessionId: string;
  agentMode: "devops" | "security";
  paymentApproved: false;
  memoryEnabled: boolean;
  memory?: {
    enabled: boolean;
    namespace: string;
    recalled: string[];
    recallStatus: TraceStatus;
    writeStatus: TraceStatus;
  };
  trace?: {
    startedAt: string;
    totalDurationMs: number;
    steps: TraceStep[];
  };
  traceId?: string;
  findings?: unknown[];
  orchestration?: Record<string, unknown>;
}

const tools: Tool[] = [
  {
    toolSpec: {
      name: "list_catalog",
      description:
        "List the available demo movies with prices, ratings, runtimes, genres, moods, themes, languages, subtitles, pace, and accessibility metadata.",
      inputSchema: {
        json: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }
    }
  },
  {
    toolSpec: {
      name: "play_movie",
      description:
        "Request playback for a catalog title. This may return an x402 payment request. Payment is only resolved when the user explicitly approved it in the invocation.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            titleId: {
              type: "string",
              description: "The exact movie ID returned by list_catalog."
            }
          },
          required: ["titleId"],
          additionalProperties: false
        }
      }
    }
  },
  {
    toolSpec: {
      name: "present_recommendations",
      description:
        "Return a persistent, selectable set of 3 to 6 catalog recommendations to the storefront. Use this after list_catalog for discovery, preference, or recommendation requests instead of replying with prose alone.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description:
                "A concise customer-facing summary of what the recommendations have in common."
            },
            memoryInfluenced: {
              type: "boolean",
              description:
                "True only when a recalled preference materially affected the selections."
            },
            recommendations: {
              type: "array",
              minItems: 3,
              maxItems: 6,
              items: {
                type: "object",
                properties: {
                  titleId: {
                    type: "string",
                    description: "An exact movie ID returned by list_catalog."
                  },
                  reason: {
                    type: "string",
                    description:
                      "One short, specific explanation of why this title matches."
                  }
                },
                required: ["titleId", "reason"],
                additionalProperties: false
              }
            }
          },
          required: ["summary", "memoryInfluenced", "recommendations"],
          additionalProperties: false
        }
      }
    }
  }
];

function json(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}

function safeId(value: string | undefined, prefix: string) {
  const fallback = `${prefix}-${crypto.randomUUID()}`;
  const candidate = value?.trim() || fallback;
  return candidate.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
}

function isToolUse(block: ContentBlock): block is ContentBlock & ToolUseBlock {
  return "toolUse" in block && Boolean(block.toolUse);
}

function elapsedSince(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function createExecutionTrace() {
  const startedAt = new Date().toISOString();
  const startedAtMs = performance.now();
  const steps: TraceStep[] = [];

  return {
    add(
      category: TraceCategory,
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
        offsetMs: elapsedSince(startedAtMs),
        durationMs
      });
    },
    finish() {
      return {
        startedAt,
        totalDurationMs: elapsedSince(startedAtMs),
        steps
      };
    }
  };
}

function visibleMemory(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}

export function visibleAssistantText(value: string) {
  return value
    .replace(
      /<(thinking|analysis|reasoning)>[\s\S]*?<\/\1>/gi,
      ""
    )
    .replace(/<(thinking|analysis|reasoning)>[\s\S]*$/gi, "")
    .replace(/<\/?(thinking|analysis|reasoning)>/gi, "")
    .replace(/<\/?(response|final)>/gi, "")
    .trim();
}

export function memoryRecordsForInspector(
  records: string[],
  actorId: string,
  includeMemoryDetails: boolean
) {
  return includeMemoryDetails && actorId.startsWith("xrpl:")
    ? records
    : [];
}

async function getPreferences(actorId: string): Promise<MemoryRecall> {
  const namespace = `/users/${actorId}/preferences`;
  const startedAt = performance.now();
  if (!MEMORY_ID) {
    return {
      namespace,
      records: [],
      status: "skipped",
      durationMs: elapsedSince(startedAt),
      detail: "AgentCore Memory is not configured for this Runtime."
    };
  }

  try {
    const response = await agentcore.send(
      new RetrieveMemoryRecordsCommand({
        memoryId: MEMORY_ID,
        namespace,
        searchCriteria: {
          searchQuery:
            "movie genres, languages, captions, accessibility, and viewing preferences",
          topK: 5
        }
      })
    );

    const records = (response.memoryRecordSummaries ?? [])
      .map((record) => record.content?.text)
      .filter((value): value is string => Boolean(value))
      .map(visibleMemory)
      .filter(Boolean);
    return {
      namespace,
      records,
      status: "success",
      durationMs: elapsedSince(startedAt),
      detail: records.length
        ? `Recalled ${records.length} preference record${records.length === 1 ? "" : "s"}.`
        : "No matching long-term preference records were found."
    };
  } catch (error) {
    console.warn("Memory retrieval was skipped", error);
    return {
      namespace,
      records: [],
      status: "error",
      durationMs: elapsedSince(startedAt),
      detail: "Memory lookup failed; the request continued without recalled preferences."
    };
  }
}

async function rememberConversation(
  actorId: string,
  sessionId: string,
  prompt: string,
  response: string
): Promise<MemoryWrite> {
  const startedAt = performance.now();
  if (!MEMORY_ID) {
    return {
      status: "skipped",
      durationMs: elapsedSince(startedAt),
      detail: "Conversation was not stored because AgentCore Memory is disabled."
    };
  }

  try {
    await agentcore.send(
      new CreateEventCommand({
        memoryId: MEMORY_ID,
        actorId,
        sessionId,
        eventTimestamp: new Date(),
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
        ],
        clientToken: crypto.randomUUID()
      })
    );
    return {
      status: "success",
      durationMs: elapsedSince(startedAt),
      detail: "Conversation event was sent to AgentCore Memory for extraction."
    };
  } catch (error) {
    console.warn("Memory event creation was skipped", error);
    return {
      status: "error",
      durationMs: elapsedSince(startedAt),
      detail: "The response completed, but the conversation event was not stored."
    };
  }
}

function toolExecutionDetail(
  name: string,
  input: unknown,
  result: unknown
) {
  const resultStatus =
    result && typeof result === "object" && "status" in result
      ? String(result.status)
      : result && typeof result === "object" && "error" in result
        ? "error"
        : "completed";

  if (name === "list_catalog") {
    return `Fetched the private storefront catalog; result=${resultStatus}.`;
  }

  if (name === "play_movie") {
    const titleId =
      input &&
      typeof input === "object" &&
      "titleId" in input &&
      typeof input.titleId === "string"
        ? input.titleId
        : "unknown";
    return `Requested playback for titleId=${titleId}; result=${resultStatus}.`;
  }

  if (name === "present_recommendations") {
    const count =
      result &&
      typeof result === "object" &&
      "recommendations" in result &&
      Array.isArray(result.recommendations)
        ? result.recommendations.length
        : 0;
    return `Prepared ${count} validated storefront recommendation${count === 1 ? "" : "s"}; result=${resultStatus}.`;
  }

  return `Executed ${name}; result=${resultStatus}.`;
}

async function listCatalog() {
  const response = await fetch(`${STOREFRONT_ORIGIN}/api/catalog`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Catalog request failed with HTTP ${response.status}.`);
  }

  return response.json();
}

export function buildRecommendationAction(
  rawInput: unknown,
  validTitleIds: ReadonlySet<string>,
  hasRecalledPreferences: boolean
) {
  const input =
    rawInput && typeof rawInput === "object"
      ? (rawInput as {
          summary?: unknown;
          memoryInfluenced?: unknown;
          recommendations?: unknown;
        })
      : {};
  const summary =
    typeof input.summary === "string" && input.summary.trim()
      ? input.summary.trim().slice(0, 320)
      : "A few titles selected for your request.";
  const candidates = Array.isArray(input.recommendations)
    ? input.recommendations
    : [];
  const seen = new Set<string>();
  const recommendations = candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const titleId =
      "titleId" in candidate && typeof candidate.titleId === "string"
        ? candidate.titleId.trim()
        : "";
    const reason =
      "reason" in candidate && typeof candidate.reason === "string"
        ? candidate.reason.trim()
        : "";
    if (!titleId || !reason || !validTitleIds.has(titleId) || seen.has(titleId)) {
      return [];
    }
    seen.add(titleId);
    return [{ titleId, reason: reason.slice(0, 240) }];
  }).slice(0, 6);

  if (!recommendations.length) {
    return {
      error:
        "present_recommendations requires valid, unique title IDs returned by list_catalog."
    };
  }

  return {
    status: "recommendations_ready",
    summary,
    recommendations,
    memoryInfluenced:
      hasRecalledPreferences && input.memoryInfluenced === true
  };
}

async function presentRecommendations(
  rawInput: unknown,
  hasRecalledPreferences: boolean
) {
  const result = (await listCatalog()) as { catalog?: Array<{ id?: unknown }> };
  const validTitleIds = new Set(
    (result.catalog || []).flatMap((movie) =>
      typeof movie.id === "string" ? [movie.id] : []
    )
  );
  return buildRecommendationAction(
    rawInput,
    validTitleIds,
    hasRecalledPreferences
  );
}

let xrplHttpClientPromise: Promise<x402HTTPClient> | undefined;

function parseWalletSeed(secret: string) {
  try {
    const parsed = JSON.parse(secret) as { seed?: unknown };
    if (typeof parsed.seed === "string" && parsed.seed) return parsed.seed;
  } catch {
    // A raw XRPL seed is also supported.
  }
  return secret;
}

async function xrplWalletSeed() {
  if (XRPL_WALLET_SEED_SECRET_ARN) {
    const result = await secrets.send(
      new GetSecretValueCommand({
        SecretId: XRPL_WALLET_SEED_SECRET_ARN
      })
    );
    if (!result.SecretString) {
      throw new Error(
        "The XRPL wallet secret must contain a SecretString value."
      );
    }
    return parseWalletSeed(result.SecretString);
  }

  if (process.env.XRPL_WALLET_SEED && process.env.NODE_ENV !== "production") {
    return process.env.XRPL_WALLET_SEED;
  }

  throw new Error(
    "XRPL_WALLET_SEED_SECRET_ARN is required for direct XRPL payments."
  );
}

async function xrplHttpClient() {
  if (!xrplHttpClientPromise) {
    xrplHttpClientPromise = (async () => {
      const wallet = Wallet.fromSeed(await xrplWalletSeed());
      assertRuntimePayerAddress(
        wallet.classicAddress,
        XRPL_RUNTIME_PAYER_ADDRESS
      );
      const signer = createXrplWalletSigner(wallet);
      return createXrplPayer({
        network: XRPL_NETWORK,
        signer,
        maxAmountPerPayment: xrpAtomicPaymentLimit(
          PAYMENT_MAX_AMOUNT
        ),
        preparePaymentTransaction: prepareXrplPaymentTransaction
      });
    })();
  }
  return xrplHttpClientPromise;
}

function selectedBackend(paymentRequired: {
  challenge?: { accepts?: Array<{ network?: unknown }> };
}) {
  if (
    PAYMENT_BACKEND === "sandbox" ||
    PAYMENT_BACKEND === "agentcore" ||
    PAYMENT_BACKEND === "xrpl"
  ) {
    return PAYMENT_BACKEND;
  }
  if (PAYMENT_BACKEND !== "auto") {
    throw new Error(
      'PAYMENT_BACKEND must be one of "sandbox", "agentcore", "xrpl", or "auto".'
    );
  }
  return paymentRequired.challenge?.accepts?.some(
    (accept) =>
      typeof accept.network === "string" &&
      accept.network.startsWith("xrpl:")
  )
    ? "xrpl"
    : "agentcore";
}

function requestedAmount(paymentRequired: {
  challenge?: {
    accepts?: Array<{ asset?: unknown; amount?: unknown }>;
  };
}) {
  const requirement = paymentRequired.challenge?.accepts?.[0];
  if (
    typeof requirement?.asset !== "string" ||
    typeof requirement.amount !== "string"
  ) {
    return undefined;
  }
  const atomicAmount = Number(requirement.amount);
  if (!Number.isFinite(atomicAmount)) return undefined;
  return requirement.asset === "XRP" || requirement.asset.startsWith("0x")
    ? atomicAmount / 1_000_000
    : atomicAmount;
}

async function payWithBackend(
  backend: "xrpl" | "agentcore",
  firstAttempt: Response,
  paymentRequiredBody: unknown,
  streamUrl: string,
  invocation: Required<
    Pick<InvocationInput, "actorId" | "sessionId">
  > &
    Pick<
      InvocationInput,
      "paymentSessionId" | "paymentInstrumentId" | "paymentDelegationToken"
    >,
  titleId: string
) {
  const headers = invocation.paymentDelegationToken
    ? { "x-payment-delegation": invocation.paymentDelegationToken }
    : undefined;
  const paymentBackend =
    backend === "xrpl"
      ? createXrplPaymentBackend({
          client: await xrplHttpClient()
        })
      : createAgentCorePaymentBackend({
          client: agentcore,
          context: {
            paymentManagerArn: PAYMENT_MANAGER_ARN!,
            paymentSessionId: invocation.paymentSessionId!,
            paymentInstrumentId: invocation.paymentInstrumentId!,
            agentName: "AgentCoreXrplConcierge"
          },
          supportsRequirement: (requirement) =>
            !requirement.network.startsWith("xrpl:")
        });
  const payments = createPaymentClient({
    backends: [paymentBackend]
  });
  const result = await payments.payResource({
    principalId: invocation.actorId,
    approved: true,
    idempotencyKey: `${invocation.sessionId}-${titleId}`
      .padEnd(33, "0")
      .slice(0, 64),
    firstResponse: firstAttempt,
    paymentRequiredBody,
    resourceUrl: streamUrl,
    headers,
    preferredBackend: backend
  });

  return {
    status: result.status === "resource_granted"
      ? "playback_unlocked"
      : "merchant_retry_failed",
    payment: result.receipt.details,
    playback: result.body
  };
}

async function requestPlayback(
  titleId: string,
  invocation: Required<
    Pick<InvocationInput, "approvePayment" | "actorId" | "sessionId">
  > &
    Pick<
      InvocationInput,
      "paymentSessionId" | "paymentInstrumentId" | "paymentDelegationToken"
    >
) {
  const streamUrl = `${STOREFRONT_ORIGIN}/api/titles/${encodeURIComponent(titleId)}/stream`;
  const walletHeaders: Record<string, string> = {};
  if (invocation.paymentDelegationToken) {
    walletHeaders["x-payment-delegation"] =
      invocation.paymentDelegationToken;
  }
  const firstAttempt = await fetch(streamUrl, {
    headers: { accept: "application/json", ...walletHeaders }
  });

  if (firstAttempt.status !== 402) {
    return normalizePlaybackResponse(
      firstAttempt.status,
      await firstAttempt.json()
    );
  }

  const paymentRequired = await firstAttempt.json();
  if (!invocation.approvePayment) {
    return {
      status: "payment_confirmation_required",
      message:
        "The merchant returned HTTP 402. Ask the user to approve the displayed amount before retrying.",
      paymentRequired
    };
  }

  const amount = requestedAmount(paymentRequired);
  if (amount === undefined || amount > PAYMENT_MAX_AMOUNT) {
    return {
      status: "payment_limit_exceeded",
      message:
        amount === undefined
          ? "The payment amount could not be interpreted safely."
          : `The ${amount.toFixed(2)} ${PAYMENT_ASSET} payment exceeds the Runtime's ${PAYMENT_MAX_AMOUNT.toFixed(2)} ${PAYMENT_ASSET} per-payment limit.`
    };
  }

  const backend = selectedBackend(paymentRequired);

  if (backend === "sandbox") {
    const payment = await fetch(`${STOREFRONT_ORIGIN}/api/payments/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(invocation.paymentDelegationToken
          ? {
              "x-payment-delegation":
                invocation.paymentDelegationToken
            }
          : {})
      },
      body: JSON.stringify({
        titleId,
        challenge: paymentRequired.challenge
      })
    });
    const paymentBody = await payment.json();

    if (!payment.ok) {
      return {
        status: "payment_failed",
        payment: paymentBody
      };
    }

    const retry = await fetch(streamUrl, {
      headers: {
        accept: "application/json",
        "x-payment": paymentBody.proof
      }
    });

    return {
      status: retry.ok ? "playback_unlocked" : "merchant_retry_failed",
      payment: paymentBody,
      playback: await retry.json()
    };
  }

  if (backend === "xrpl") {
    try {
      return await payWithBackend(
        backend,
        firstAttempt,
        paymentRequired,
        streamUrl,
        invocation,
        titleId
      );
    } catch (error) {
      return {
        status: "xrpl_payment_failed",
        message: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  if (
    !PAYMENT_MANAGER_ARN ||
    PAYMENT_MANAGER_ARN === "disabled" ||
    !invocation.paymentSessionId ||
    !invocation.paymentInstrumentId
  ) {
    return {
      status: "live_payment_setup_required",
      message:
        "AgentCore Payments mode requires an active connector plus a user payment instrument and payment session."
    };
  }

  try {
    return await payWithBackend(
      backend,
      firstAttempt,
      paymentRequired,
      streamUrl,
      invocation,
      titleId
    );
  } catch (error) {
    return {
      status: "payment_failed",
      payment:
        error instanceof PaymentClientError
          ? error.details
          : undefined,
      message:
        error instanceof Error ? error.message : "Unknown error"
    };
  }
}

async function executeTool(
  name: string,
  rawInput: unknown,
  invocation: Required<
    Pick<InvocationInput, "approvePayment" | "actorId" | "sessionId">
  > &
    Pick<
      InvocationInput,
      "paymentSessionId" | "paymentInstrumentId" | "paymentDelegationToken"
    > & {
      hasRecalledPreferences: boolean;
    }
) {
  if (name === "list_catalog") return listCatalog();

  if (name === "present_recommendations") {
    return presentRecommendations(
      rawInput,
      invocation.hasRecalledPreferences
    );
  }

  if (name === "play_movie") {
    const input =
      rawInput && typeof rawInput === "object"
        ? (rawInput as { titleId?: unknown })
        : {};
    if (typeof input.titleId !== "string" || !input.titleId) {
      return { error: "play_movie requires a titleId returned by list_catalog." };
    }
    return requestPlayback(input.titleId, invocation);
  }

  return { error: `Unknown tool: ${name}` };
}

export function isPlaybackUnlocked(result: unknown) {
  return (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    result.status === "playback_unlocked"
  );
}

export function isPaymentConfirmationRequired(result: unknown) {
  return (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    result.status === "payment_confirmation_required"
  );
}

export function isRecommendationsReady(result: unknown) {
  return (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    result.status === "recommendations_ready"
  );
}

export function normalizePlaybackResponse(status: number, playback: unknown) {
  if (
    status >= 200 &&
    status < 300 &&
    typeof playback === "object" &&
    playback !== null &&
    "access" in playback &&
    playback.access === "granted"
  ) {
    return {
      status: "playback_unlocked",
      playback
    };
  }
  return playback;
}

function paymentConfirmationMessage(result: unknown) {
  if (
    typeof result !== "object" ||
    result === null ||
    !("paymentRequired" in result) ||
    typeof result.paymentRequired !== "object" ||
    result.paymentRequired === null ||
    !("challenge" in result.paymentRequired) ||
    typeof result.paymentRequired.challenge !== "object" ||
    result.paymentRequired.challenge === null ||
    !("accepts" in result.paymentRequired.challenge) ||
    !Array.isArray(result.paymentRequired.challenge.accepts)
  ) {
    return "Payment approval is required. No payment has been submitted.";
  }

  const requirement = result.paymentRequired.challenge.accepts[0];
  if (
    !requirement ||
    typeof requirement !== "object" ||
    typeof requirement.amount !== "string" ||
    typeof requirement.asset !== "string"
  ) {
    return "Payment approval is required. No payment has been submitted.";
  }

  const displayAmount =
    requirement.asset === "XRP" && /^\d+$/.test(requirement.amount)
      ? `${Number(requirement.amount) / 1_000_000} XRP`
      : `${requirement.amount} ${requirement.asset}`;

  return `Payment approval is required for ${displayAmount}. No payment has been submitted.`;
}

function unlockedPlaybackMessage(result: unknown) {
  if (
    typeof result === "object" &&
    result !== null &&
    "playback" in result &&
    typeof result.playback === "object" &&
    result.playback !== null &&
    "title" in result.playback &&
    typeof result.playback.title === "object" &&
    result.playback.title !== null &&
    "title" in result.playback.title &&
    typeof result.playback.title.title === "string"
  ) {
    return `Payment settled and playback is unlocked for "${result.playback.title.title}".`;
  }
  return "Payment settled and playback is unlocked.";
}

async function invokeSpecialist(
  role: "devops" | "security",
  input: InvocationInput,
  trace: ReturnType<typeof createExecutionTrace>
) {
  const runtimeArn =
    role === "devops" ? DEVOPS_RUNTIME_ARN : SECURITY_RUNTIME_ARN;
  if (!runtimeArn) {
    throw new Error(`The ${role} specialist Runtime is not configured.`);
  }
  const runtimeSessionId =
    `agentcore-xrpl-${role}-session-${crypto.randomUUID()}`;
  const startedAt = performance.now();
  trace.add(
    "agent",
    "Supervisor route",
    "success",
    `Delegated the request to the isolated ${role} specialist Runtime.`
  );
  const response = await agentcore.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      qualifier: "live",
      runtimeSessionId,
      runtimeUserId: safeId(input.actorId, "demo-user"),
      contentType: "application/json",
      accept: "application/json",
      payload: new TextEncoder().encode(
        JSON.stringify(
          specialistInvocation(
            input,
            role,
            safeId(input.actorId, "demo-user"),
            runtimeSessionId
          )
        )
      )
    })
  );
  if (!response.response) {
    throw new Error(`The ${role} specialist returned an empty response.`);
  }
  const result = JSON.parse(
    new TextDecoder().decode(await response.response.transformToByteArray())
  ) as SpecialistResult;
  trace.add(
    "agent",
    `${role === "devops" ? "DevOps" : "Security"} Runtime`,
    response.statusCode && response.statusCode >= 400 ? "error" : "success",
    `Specialist Runtime completed with HTTP ${response.statusCode || 200}; trace=${response.traceId || "not returned"}.`,
    elapsedSince(startedAt)
  );
  for (const step of result.trace?.steps ?? []) {
    trace.add(
      step.category,
      `${role === "devops" ? "DevOps" : "Security"} · ${step.name}`,
      step.status,
      step.detail,
      step.durationMs
    );
  }
  return {
    ...result,
    trace: trace.finish(),
    orchestration: {
      selectedAgent: role,
      route: [
        {
          name: "Supervisor Agent",
          role: "supervisor",
          status: "success"
        },
        {
          name: role === "devops" ? "DevOps Agent" : "Security Agent",
          role,
          status: "success",
          runtimeSessionId,
          traceId: response.traceId
        }
      ],
      gateway: result.orchestration?.gateway,
      specialistTraceId: response.traceId
    }
  };
}

async function handleSupervisorInvocation(
  input: InvocationInput
): Promise<Record<string, unknown>> {
  const trace = createExecutionTrace();
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error('The invocation body must contain a non-empty "prompt".');
  }

  const actorId = safeId(input.actorId, "demo-user");
  const sessionId = safeId(input.sessionId, "runtime-session");
  const approvePayment = input.approvePayment === true;
  trace.add(
    "runtime",
    "Prompt accepted",
    "success",
    `${prompt.length} characters received; payment approval=${approvePayment}.`
  );

  if (input.agentMode === "devops" || input.agentMode === "security") {
    if (approvePayment) {
      throw new Error(
        "Operations specialist requests cannot include payment approval."
      );
    }
    return invokeSpecialist(input.agentMode, input, trace);
  }

  const memoryRecall = await getPreferences(actorId);
  trace.add(
    "memory",
    "RetrieveMemoryRecords",
    memoryRecall.status,
    memoryRecall.detail,
    memoryRecall.durationMs
  );
  const preferences = memoryRecall.records;
  const invocation = {
    actorId,
    sessionId,
    approvePayment,
    paymentSessionId: input.paymentSessionId,
    paymentInstrumentId: input.paymentInstrumentId,
    paymentDelegationToken: input.paymentDelegationToken,
    hasRecalledPreferences: preferences.length > 0
  };

  const messages: Message[] = [
    {
      role: "user",
      content: [{ text: prompt }]
    }
  ];

  let finalText = "";
  let lastToolResult: unknown;

  const completeInvocation = async (message: string, action: unknown) => {
    const memoryWrite = await rememberConversation(
      actorId,
      sessionId,
      prompt,
      message
    );
    trace.add(
      "memory",
      "CreateEvent",
      memoryWrite.status,
      memoryWrite.detail,
      memoryWrite.durationMs
    );
    trace.add(
      "runtime",
      "Response ready",
      "success",
      action ? "Returned an agent response with action data." : "Returned a text response."
    );

    return {
      message,
      actorId,
      sessionId,
      agentMode: "concierge",
      paymentApproved: approvePayment,
      action,
      memoryEnabled: Boolean(MEMORY_ID),
      memory: {
        enabled: Boolean(MEMORY_ID),
        namespace: memoryRecall.namespace,
        recalled: memoryRecordsForInspector(
          memoryRecall.records,
          actorId,
          input.includeMemoryDetails === true
        ),
        recallStatus: memoryRecall.status,
        writeStatus: memoryWrite.status
      },
      trace: trace.finish(),
      orchestration: {
        selectedAgent: "concierge",
        route: [
          {
            name: "Supervisor Agent",
            role: "supervisor",
            status: "success"
          },
          {
            name: "Media Concierge",
            role: "concierge",
            status: "success",
            runtimeSessionId: sessionId
          }
        ],
        gateway: {
          used: false,
          policyMode: "PAYMENT_APPROVAL_BOUNDARY",
          mutationAllowed: approvePayment
        }
      }
    };
  };

  for (let turn = 0; turn < 6; turn += 1) {
    const modelStartedAt = performance.now();
    let response;
    try {
      response = await bedrock.send(
        new ConverseCommand({
          modelId: MODEL_ID,
          system: [
            {
              text: [
                "You are the sample's concise media concierge.",
                "Use list_catalog before selecting a title when the request is ambiguous.",
                "For discovery, recommendation, or preference-based requests, call list_catalog and then present_recommendations with 3 to 6 exact title IDs and specific match reasons.",
                "Never finish a recommendation request as prose alone; present_recommendations is required so the storefront can retain and display the result.",
                "Match recommendations against catalog genre, mood, theme, language, subtitle, pace, runtime, rating, price, caption, and audio-description metadata.",
                "When preferences influenced a recommendation, include one short 'Because you prefer…' explanation grounded only in the current prompt or recalled memory.",
                "Never imply that a preference was remembered when no saved preference record is available.",
                "Use play_movie when the user asks to watch or play a title.",
                "Never claim a payment succeeded unless the tool reports playback_unlocked.",
                "Never bypass payment confirmation or budget limits.",
                `The configured payment asset is ${PAYMENT_ASSET} and the payment backend is ${PAYMENT_BACKEND}.`,
                preferences.length
                  ? `Known non-authoritative preferences: ${preferences.join(" | ")}`
                  : "No saved viewing preferences are available."
              ].join("\n")
            }
          ],
          messages,
          toolConfig: { tools },
          inferenceConfig: {
            maxTokens: 700,
            temperature: 0.2
          }
        })
      );
    } catch (error) {
      trace.add(
        "model",
        "Bedrock Converse",
        "error",
        `Model turn ${turn + 1} failed.`,
        elapsedSince(modelStartedAt)
      );
      throw error;
    }

    const assistant = response.output?.message;
    if (!assistant) {
      throw new Error("The model returned no assistant message.");
    }
    messages.push(assistant);

    const content = assistant.content ?? [];
    const toolUses = content.filter(isToolUse);
    finalText = visibleAssistantText(
      content
        .flatMap((block) => ("text" in block && block.text ? [block.text] : []))
        .join("\n")
    );
    const tokenCount = response.usage?.totalTokens;
    trace.add(
      "model",
      "Bedrock Converse",
      "success",
      `Turn ${turn + 1} completed with ${toolUses.length} tool request${toolUses.length === 1 ? "" : "s"}${tokenCount ? ` and ${tokenCount} tokens` : ""}.`,
      elapsedSince(modelStartedAt)
    );

    if (!toolUses.length) break;

    const toolResults: ContentBlock[] = [];
    for (const block of toolUses) {
      const toolStartedAt = performance.now();
      let toolResult;
      try {
        toolResult = await executeTool(
          block.toolUse.name,
          block.toolUse.input,
          invocation
        );
      } catch (error) {
        trace.add(
          "tool",
          block.toolUse.name,
          "error",
          `Tool execution failed after ${elapsedSince(toolStartedAt)} ms.`,
          elapsedSince(toolStartedAt)
        );
        throw error;
      }
      const toolStatus =
        toolResult &&
        typeof toolResult === "object" &&
        "error" in toolResult
          ? "error"
          : "success";
      trace.add(
        "tool",
        block.toolUse.name,
        toolStatus,
        toolExecutionDetail(
          block.toolUse.name,
          block.toolUse.input,
          toolResult
        ),
        elapsedSince(toolStartedAt)
      );
      lastToolResult = toolResult;
      if (isPlaybackUnlocked(toolResult)) {
        const message = unlockedPlaybackMessage(toolResult);
        return completeInvocation(message, toolResult);
      }
      if (isPaymentConfirmationRequired(toolResult)) {
        const message = paymentConfirmationMessage(toolResult);
        return completeInvocation(message, toolResult);
      }
      if (isRecommendationsReady(toolResult)) {
        const recommendation = toolResult as { summary?: unknown };
        const message =
          typeof recommendation.summary === "string"
            ? recommendation.summary
            : "Your recommendations are ready.";
        return completeInvocation(message, toolResult);
      }
      toolResults.push({
        toolResult: {
          toolUseId: block.toolUse.toolUseId,
          content: [{ json: toolResult }],
          status:
            toolResult &&
            typeof toolResult === "object" &&
            "error" in toolResult
              ? "error"
              : "success"
        }
      });
    }

    messages.push({
      role: "user",
      content: toolResults
    });
  }

  const message =
    finalText ||
    "I completed the request. Review the returned action details for the result.";
  return completeInvocation(message, lastToolResult);
}

export async function handleInvocation(
  input: InvocationInput
): Promise<Record<string, unknown>> {
  return handleSupervisorInvocation(input);
}

export async function handleRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/ping") {
    return json(200, {
      status: "Healthy",
      service: "agentcore-xrpl-concierge"
    });
  }

  if (request.method === "POST" && pathname === "/invocations") {
    try {
      const input = parseAgentInvocation(await request.json());
      return json(200, await handleInvocation(input));
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

if (import.meta.main) {
  const server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    fetch: handleRequest
  });
  console.log(`Demo concierge is listening on ${server.url}`);
}
