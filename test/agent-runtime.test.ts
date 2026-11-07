// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import {
  buildRecommendationAction,
  handleRequest,
  isPaymentConfirmationRequired,
  isPlaybackUnlocked,
  memoryRecordsForInspector,
  normalizePlaybackResponse,
  visibleAssistantText
} from "../agent/src";
import { specialistInvocation } from "../shared/contracts";

describe("AgentCore Runtime protocol", () => {
  test("preserves shared-module paths in both Runtime images", async () => {
    const [conciergeDockerfile, specialistDockerfile] = await Promise.all([
      Bun.file("agent/Dockerfile").text(),
      Bun.file("agent/Dockerfile.specialist").text()
    ]);
    expect(conciergeDockerfile).toContain("COPY agent/src ./agent/src");
    expect(conciergeDockerfile).toContain("COPY packages ./packages");
    expect(conciergeDockerfile).toContain(
      'CMD ["bun", "run", "agent/src/index.ts"]'
    );
    expect(specialistDockerfile).toContain("./agent/src/");
    expect(specialistDockerfile).toContain(
      'CMD ["bun", "run", "agent/src/specialist-entry.ts"]'
    );
  });

  test("does not propagate payment authority to specialist runtimes", () => {
    expect(
      specialistInvocation(
        {
          prompt: "Audit security",
          actorId: "xrpl:1:rExample",
          approvePayment: true,
          paymentDelegationToken: "sensitive-delegation"
        },
        "security",
        "xrpl:1:rExample",
        "specialist-session"
      )
    ).toEqual({
      prompt: "Audit security",
      actorId: "xrpl:1:rExample",
      sessionId: "specialist-session",
      agentMode: "security",
      includeMemoryDetails: false,
      approvePayment: false
    });
  });

  test("specialist runtimes reject direct payment authority", async () => {
    const previousRole = process.env.AGENT_ROLE;
    process.env.AGENT_ROLE = "security";
    try {
      const { handleSpecialistInvocation } = await import(
        "../agent/src/specialist-runtime"
      );
      await expect(
        handleSpecialistInvocation({
          prompt: "Inspect the deployment",
          paymentSessionId: "payment-session",
          paymentInstrumentId: "payment-instrument"
        })
      ).rejects.toThrow("cannot receive payment authority");
    } finally {
      if (previousRole === undefined) delete process.env.AGENT_ROLE;
      else process.env.AGENT_ROLE = previousRole;
    }
  });

  test("validates structured catalog recommendations for the storefront", () => {
    expect(
      buildRecommendationAction(
        {
          summary: "Gentle science fiction for tonight.",
          memoryInfluenced: true,
          recommendations: [
            { titleId: "afterlight", reason: "Reflective and captioned." },
            { titleId: "deep-field", reason: "Calm and cerebral." },
            { titleId: "missing", reason: "Not in the catalog." }
          ]
        },
        new Set(["afterlight", "deep-field"]),
        true
      )
    ).toEqual({
      status: "recommendations_ready",
      summary: "Gentle science fiction for tonight.",
      memoryInfluenced: true,
      recommendations: [
        { titleId: "afterlight", reason: "Reflective and captioned." },
        { titleId: "deep-field", reason: "Calm and cerebral." }
      ]
    });
  });

  test("reports healthy on the required ping route", async () => {
    const response = await handleRequest(
      new Request("http://localhost:8080/ping")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "Healthy",
      service: "agentcore-xrpl-concierge"
    });
  });

  test("rejects invocations without a prompt before calling AWS", async () => {
    const response = await handleRequest(
      new Request("http://localhost:8080/invocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invocation_failed");
  });

  test("recognizes a settled playback result as terminal", () => {
    expect(
      isPlaybackUnlocked({
        status: "playback_unlocked",
        playback: { access: "granted" }
      })
    ).toBe(true);
    expect(isPlaybackUnlocked({ status: "merchant_retry_failed" })).toBe(
      false
    );
  });

  test("recognizes payment confirmation as terminal", () => {
    expect(
      isPaymentConfirmationRequired({
        status: "payment_confirmation_required",
        paymentRequired: {
          challenge: {
            accepts: [{ amount: "650000", asset: "XRP" }]
          }
        }
      })
    ).toBe(true);
    expect(
      isPaymentConfirmationRequired({ status: "payment_limit_exceeded" })
    ).toBe(false);
  });

  test("normalizes an existing entitlement as unlocked playback", () => {
    expect(
      normalizePlaybackResponse(200, {
        access: "granted",
        title: { title: "Wild Signal" }
      })
    ).toEqual({
      status: "playback_unlocked",
      playback: {
        access: "granted",
        title: { title: "Wild Signal" }
      }
    });
  });

  test("only exposes recalled memory for a verified wallet actor", () => {
    const records = ["Prefers science fiction with captions."];

    expect(
      memoryRecordsForInspector(records, "xrpl:1:rVerified", true)
    ).toEqual(records);
    expect(
      memoryRecordsForInspector(records, "anonymous:agentcore-xrpl-session-1", true)
    ).toEqual([]);
    expect(
      memoryRecordsForInspector(records, "xrpl:1:rVerified", false)
    ).toEqual([]);
  });

  test("removes hidden reasoning tags from visible agent responses", () => {
    expect(
      visibleAssistantText(
        "<thinking>I should call the catalog.</thinking>\n\nHere are the available genres."
      )
    ).toBe("Here are the available genres.");
    expect(
      visibleAssistantText(
        "<analysis>This incomplete block must never reach the UI."
      )
    ).toBe("");
    expect(
      visibleAssistantText("<response>Here are the available genres.</response>")
    ).toBe("Here are the available genres.");
  });
});
