// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { api } from "../src/lib/api";
import {
  createMovieCuration,
  isAgentResponse
} from "../src/hooks/useStorefront";
import { createCatalog } from "../server/catalog";
import { createTestRuntimeSessionId } from "./fixtures";

describe("storefront AgentCore bridge", () => {
  test("maps structured agent recommendations to selectable catalog movies", () => {
    const catalog = createCatalog("XRP");
    const sessionId = createTestRuntimeSessionId();
    const curation = createMovieCuration(
      {
        message: "Gentle choices for tonight.",
        actorId: "xrpl:1:rExample",
        sessionId,
        paymentApproved: false,
        memoryEnabled: true,
        action: {
          status: "recommendations_ready",
          summary: "Gentle choices for tonight.",
          memoryInfluenced: true,
          recommendations: [
            { titleId: "afterlight", reason: "Reflective science fiction." },
            { titleId: "paper-kingdom", reason: "A gentle fantasy." },
            { titleId: "unknown", reason: "Should be ignored." }
          ]
        }
      },
      "Something gentle",
      catalog
    );

    expect(curation).toMatchObject({
      prompt: "Something gentle",
      summary: "Gentle choices for tonight.",
      memoryInfluenced: true
    });
    expect(
      curation?.recommendations.map(({ movie }) => movie.id)
    ).toEqual(["afterlight", "paper-kingdom"]);
  });

  test("accepts a successful text-only response for memory prompts", () => {
    const sessionId = createTestRuntimeSessionId();
    expect(
      isAgentResponse({
        message: "I will remember that you prefer science fiction.",
        actorId: "xrpl:1:rExample",
        sessionId,
        paymentApproved: false,
        memoryEnabled: true,
        trace: {
          startedAt: "2026-10-12T12:00:00.000Z",
          totalDurationMs: 120,
          steps: []
        }
      })
    ).toBe(true);
  });

  test("sends approval through the same Runtime session", async () => {
    const originalFetch = globalThis.fetch;
    const sessionId = createTestRuntimeSessionId();
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        message: "Payment settled and playback is unlocked.",
        actorId: "agentcore-xrpl-web-user",
        sessionId,
        runtimeSessionId: sessionId,
        paymentApproved: true,
        action: {
          status: "playback_unlocked",
          playback: { access: "granted" }
        },
        memoryEnabled: true
      });
    }) as typeof fetch;

    try {
      await api.invokeAgent({
        prompt: "Play Afterlight",
        actorId: "agentcore-xrpl-web-user",
        sessionId,
        approvePayment: true
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestUrl).toBe("/api/agent");
    expect(requestBody).toMatchObject({
      prompt: "Play Afterlight",
      actorId: "agentcore-xrpl-web-user",
      sessionId,
      approvePayment: true
    });
  });

  test("routes operations prompts without payment authority", async () => {
    const originalFetch = globalThis.fetch;
    const sessionId = createTestRuntimeSessionId();
    let requestBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        message: "The storefront is healthy.",
        actorId: "anonymous:agentcore-xrpl-session",
        sessionId,
        agentMode: "devops",
        paymentApproved: false,
        memoryEnabled: true
      });
    }) as typeof fetch;

    try {
      await api.invokeAgent({
        prompt: "Is the storefront healthy?",
        actorId: "agentcore-xrpl-web-user",
        approvePayment: false,
        agentMode: "devops"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestBody).toMatchObject({
      prompt: "Is the storefront healthy?",
      agentMode: "devops",
      approvePayment: false
    });
  });

});
