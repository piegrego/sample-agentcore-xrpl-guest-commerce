// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { beforeEach, describe, expect, test } from "bun:test";
import { handleRequest } from "../server";

let browserCookie = "";

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (browserCookie) headers.set("cookie", browserCookie);
  const response = await handleRequest(
    new Request(`http://localhost${path}`, { ...init, headers })
  );
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) browserCookie = setCookie.split(";")[0];
  return response;
}

describe("x402 payment flow", () => {
  beforeEach(async () => {
    browserCookie = "";
    await request("/api/session/reset", { method: "POST" });
  });

  test("the agent bridge reports when Runtime is not configured", async () => {
    const response = await request("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Play Afterlight" })
    });

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe(
      "agent_runtime_not_configured"
    );
  });

  test("the deployment health endpoint reports ready", async () => {
    const response = await request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "agentcore-xrpl-demo"
    });
  });

  test("the legacy favicon request does not pollute the browser console", async () => {
    const response = await request("/favicon.ico");

    expect(response.status).toBe(204);
  });

  test("a 402 challenge can be paid and retried with proof", async () => {
    const firstAttempt = await request("/api/titles/afterlight/stream");
    expect(firstAttempt.status).toBe(402);
    expect(firstAttempt.headers.get("payment-required")).toBeTruthy();

    const challenge = await firstAttempt.json();
    expect(challenge.challenge.x402Version).toBe(2);
    expect(challenge.challenge.accepts[0].amount).toBe("650000");
    expect(challenge.challenge.accepts[0]).toMatchObject({
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    });
    expect(challenge.challenge.accepts[0].payTo).toMatch(
      /^0x[0-9a-f]{40}$/i
    );
    expect(challenge.challenge.accepts[0].payTo).not.toContain("...");

    const payment = await request("/api/payments/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        titleId: "afterlight",
        challenge: challenge.challenge
      })
    });
    expect(payment.status).toBe(200);
    const paymentBody = await payment.json();
    expect(paymentBody.session.remaining).toBe(1.35);

    const retry = await request("/api/titles/afterlight/stream", {
      headers: { "x-payment": paymentBody.proof }
    });
    expect(retry.status).toBe(200);
    const stream = await retry.json();
    expect(stream.access).toBe("granted");
    expect(stream.title.id).toBe("afterlight");

    const recovered = await request(
      `/api/titles/afterlight/stream?transactionId=${paymentBody.transaction.id}`
    );
    expect(recovered.status).toBe(200);
    const recoveredStream = await recovered.json();
    expect(recoveredStream.access).toBe("granted");
    expect(recoveredStream.entitlement.transactionId).toBe(
      paymentBody.transaction.id
    );

    const entitledRetry = await request(
      "/api/titles/afterlight/stream"
    );
    expect(entitledRetry.status).toBe(200);
    expect((await entitledRetry.json()).access).toBe("granted");
  });

  test("the server enforces the payment session limit", async () => {
    const payment = await request("/api/payments/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleId: "last-archive" })
    });

    expect(payment.status).toBe(409);
    const body = await payment.json();
    expect(body.error).toBe("payment_limit_exceeded");
    expect(body.session.remaining).toBe(2);
  });

  test("isolates sandbox budgets and entitlements by browser session", async () => {
    const firstCookie = browserCookie;
    const payment = await request("/api/payments/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleId: "afterlight" })
    });
    expect(payment.status).toBe(200);

    browserCookie = "";
    const secondSession = await request("/api/session");
    expect((await secondSession.json()).remaining).toBe(2);
    const secondPlayback = await request("/api/titles/afterlight/stream");
    expect(secondPlayback.status).toBe(402);

    browserCookie = firstCookie;
    const firstSession = await request("/api/session");
    expect((await firstSession.json()).remaining).toBe(1.35);
  });
});
