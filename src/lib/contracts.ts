// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  AgentActionStatus,
  AgentResponse,
  HotelRoomAvailability,
  Movie,
  PaymentSession
} from "../types";

const ACTION_STATUSES = new Set<AgentActionStatus>([
  "payment_confirmation_required",
  "playback_unlocked",
  "recommendations_ready",
  "payment_limit_exceeded",
  "payment_failed",
  "merchant_retry_failed",
  "xrpl_payment_failed",
  "live_payment_setup_required",
  "tool_error"
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isAgentResponse(value: unknown): value is AgentResponse {
  const body = record(value);
  const action = record(body?.action);
  return Boolean(
    body &&
      typeof body.message === "string" &&
      typeof body.actorId === "string" &&
      typeof body.sessionId === "string" &&
      typeof body.paymentApproved === "boolean" &&
      typeof body.memoryEnabled === "boolean" &&
      (!action ||
        (typeof action.status === "string" &&
          ACTION_STATUSES.has(action.status as AgentActionStatus)))
  );
}

export function parsePaymentSession(value: unknown): PaymentSession {
  const body = record(value);
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.currency !== "string" ||
    typeof body.backend !== "string" ||
    typeof body.network !== "string" ||
    typeof body.authenticated !== "boolean" ||
    !Array.isArray(body.approvalModes) ||
    !body.approvalModes.every((mode) => mode === "runtime") ||
    typeof body.limit !== "number" ||
    typeof body.spent !== "number" ||
    typeof body.remaining !== "number" ||
    !Array.isArray(body.transactions)
  ) {
    throw new Error("The server returned an invalid payment session.");
  }
  return body as unknown as PaymentSession;
}

export function parseCatalog(value: unknown): { catalog: Movie[] } {
  const body = record(value);
  if (
    !body ||
    !Array.isArray(body.catalog) ||
    !body.catalog.every((movie) => {
      const item = record(movie);
      return (
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.price === "number"
      );
    })
  ) {
    throw new Error("The server returned an invalid movie catalog.");
  }
  return body as unknown as { catalog: Movie[] };
}

export function parseHotelRoomAvailability(
  value: unknown
): HotelRoomAvailability {
  const body = record(value);
  if (
    !body ||
    typeof body.propertyId !== "string" ||
    typeof body.totalRooms !== "number" ||
    !Array.isArray(body.availableRooms) ||
    !body.availableRooms.every((room) => typeof room === "string")
  ) {
    throw new Error("The server returned invalid hotel room availability.");
  }
  return body as unknown as HotelRoomAvailability;
}
