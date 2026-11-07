// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  AgentMode,
  AgentResponse,
  HotelDashboard,
  Movie,
  PaymentChallenge,
  PaymentRequiredResponse,
  PaymentResponse,
  PaymentSession,
  PlaybackResponse
} from "../types";
import {
  isAgentResponse,
  parseCatalog,
  parseHotelRoomAvailability,
  parsePaymentSession
} from "./contracts";

export interface ApiResult<T> {
  response: Response;
  body: T;
}

async function fetchJson<T>(
  url: string,
  options?: RequestInit,
  validate?: (value: unknown) => T
): Promise<ApiResult<T>> {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Expected JSON from ${url}, received ${contentType || "an unknown content type"}.`
    );
  }
  const value: unknown = await response.json();
  const body = validate ? validate(value) : (value as T);
  return { response, body };
}

export const api = {
  async getCatalog() {
    return fetchJson("/api/catalog", undefined, parseCatalog);
  },

  async getSession() {
    return fetchJson("/api/session", undefined, parsePaymentSession);
  },

  async resetSession() {
    return fetchJson(
      "/api/session/reset",
      { method: "POST" },
      parsePaymentSession
    );
  },

  async createWalletChallenge(input: {
    address: string;
    publicKey: string;
  }) {
    return fetchJson<{
      challengeId: string;
      message: string;
      expiresAt: number;
    }>("/api/wallet/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  },

  async verifyWalletChallenge(input: {
    challengeId: string;
    signature: string;
  }) {
    return fetchJson<PaymentSession | { message?: string }>(
      "/api/wallet/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      }
    );
  },

  async logoutWallet() {
    return fetchJson<PaymentSession>("/api/wallet/logout", {
      method: "POST"
    });
  },

  async finishKioskSession() {
    return fetchJson<PaymentSession | { message?: string }>(
      "/api/session/handoff",
      { method: "POST" }
    );
  },

  async checkInHotel() {
    return fetchJson<PaymentSession | { message?: string }>(
      "/api/hotel/check-in",
      { method: "POST" }
    );
  },

  async linkHotelStay(input: { roomNumber: string; pin: string }) {
    return fetchJson<PaymentSession | { message?: string }>(
      "/api/hotel/stays/link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      }
    );
  },

  async getAvailableHotelRooms() {
    return fetchJson(
      "/api/hotel/rooms/available",
      undefined,
      parseHotelRoomAvailability
    );
  },

  async getHotelDashboard() {
    return fetchJson<HotelDashboard | { message?: string }>(
      "/api/hotel/dashboard"
    );
  },

  async invokeAgent(input: {
    prompt: string;
    actorId: string;
    sessionId?: string;
    approvePayment: boolean;
    agentMode?: AgentMode;
  }) {
    return fetchJson<AgentResponse | { error: string; message?: string }>(
      "/api/agent",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      },
      (value) => {
        if (isAgentResponse(value)) return value;
        if (
          value &&
          typeof value === "object" &&
          "error" in value &&
          typeof value.error === "string"
        ) {
          return value as { error: string; message?: string };
        }
        throw new Error("The Runtime returned an invalid agent response.");
      }
    );
  },

  async requestPlayback(titleId: string, proof?: string) {
    return fetchJson<PaymentRequiredResponse | PlaybackResponse>(
      `/api/titles/${titleId}/stream`,
      proof ? { headers: { "x-payment": proof } } : undefined
    );
  },

  async recoverPlayback(titleId: string, transactionId: string) {
    return fetchJson<PlaybackResponse | { message?: string }>(
      `/api/titles/${encodeURIComponent(titleId)}/stream?transactionId=${encodeURIComponent(transactionId)}`
    );
  },

  async recoverXrplPayment(titleId: string, transactionId: string) {
    return fetchJson<
      | { status: "settled"; session: PaymentSession; playback: PlaybackResponse }
      | { message?: string }
    >("/api/xrpl/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titleId, transactionId })
    });
  },

  async resolvePayment(titleId: string, challenge: PaymentChallenge) {
    return fetchJson<PaymentResponse | { message: string; session?: PaymentSession }>(
      "/api/payments/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titleId, challenge })
      }
    );
  }
};
