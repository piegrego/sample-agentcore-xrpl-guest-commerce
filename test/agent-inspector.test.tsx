// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentInspector } from "../src/components/AgentInspector";
import { createTestRuntimeSessionId } from "./fixtures";

describe("AgentCore Session Inspector", () => {
  test("renders recalled memory and a sanitized execution trace", () => {
    const sessionId = createTestRuntimeSessionId();
    const html = renderToStaticMarkup(
      <AgentInspector
        busy={false}
        inspection={{
          prompt: "Pick a sci-fi movie for me",
          capturedAt: "2026-10-12T12:00:00.000Z",
          response: {
            message: "Afterlight matches your saved preference.",
            actorId: "xrpl:1:rExample",
            sessionId,
            runtimeSessionId: sessionId,
            runtimeDurationMs: 540,
            paymentApproved: false,
            memoryEnabled: true,
            traceId: "1-abcdef0123456789",
            memory: {
              enabled: true,
              namespace: "/users/xrpl:1:rExample/preferences",
              recalled: ["Prefers science fiction with captions."],
              recallStatus: "success",
              writeStatus: "success"
            },
            trace: {
              startedAt: "2026-10-12T12:00:00.000Z",
              totalDurationMs: 500,
              steps: [
                {
                  id: "step-01",
                  category: "memory",
                  name: "RetrieveMemoryRecords",
                  status: "success",
                  detail: "Recalled 1 preference record.",
                  offsetMs: 20,
                  durationMs: 18
                },
                {
                  id: "step-02",
                  category: "model",
                  name: "Bedrock Converse",
                  status: "success",
                  detail: "Turn 1 completed with 0 tool requests.",
                  offsetMs: 490,
                  durationMs: 470
                }
              ]
            }
          }
        }}
      />
    );

    expect(html).toContain("Pick a sci-fi movie for me");
    expect(html).toContain("Prefers science fiction with captions.");
    expect(html).toContain("RetrieveMemoryRecords");
    expect(html).toContain("Bedrock Converse");
    expect(html).toContain("does not expose hidden model reasoning");
  });

  test("renders specialist handoffs, policy boundary, and security findings", () => {
    const sessionId = createTestRuntimeSessionId();
    const html = renderToStaticMarkup(
      <AgentInspector
        busy={false}
        inspection={{
          prompt: "Audit this demo",
          capturedAt: "2026-10-12T12:00:00.000Z",
          response: {
            message: "One public-demo exposure needs review.",
            actorId: "anonymous:agentcore-xrpl-session",
            sessionId,
            agentMode: "security",
            paymentApproved: false,
            memoryEnabled: true,
            orchestration: {
              selectedAgent: "security",
              route: [
                {
                  name: "Supervisor Agent",
                  role: "supervisor",
                  status: "success"
                },
                {
                  name: "Security Agent",
                  role: "security",
                  status: "success"
                }
              ],
              gateway: {
                used: true,
                target: "OpsTools",
                policyMode: "ENFORCED",
                mutationAllowed: false,
                tools: ["audit_security_posture"]
              }
            },
            findings: [
              {
                severity: "medium",
                title: "Demo viewer access scope",
                status: "review",
                detail: "The demo is intentionally shareable."
              }
            ]
          }
        }}
      />
    );

    expect(html).toContain("Supervisor Agent → Security Agent");
    expect(html).toContain("OpsTools · ENFORCED");
    expect(html).toContain("mutation authority=no");
    expect(html).toContain("Demo viewer access scope");
  });
});
