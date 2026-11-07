// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export type PaymentEventName =
  | "payment.challenge.created"
  | "payment.approval.requested"
  | "payment.policy.denied"
  | "payment.transaction.prepared"
  | "payment.transaction.signed"
  | "payment.transaction.submitted"
  | "payment.transaction.validated"
  | "payment.grant.created"
  | "payment.recovery.completed"
  | "payment.reconciliation.pending"
  | "payment.reconciliation.failed";

export interface PaymentEvent {
  event: PaymentEventName;
  timestamp: string;
  correlationId: string;
  settlementId?: string;
  transactionId?: string;
  principalHash?: string;
  network?: string;
  resourceId?: string;
  amount?: string;
  state?: string;
  reason?: string;
}

export function requestCorrelationId(request: Request) {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export async function principalHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Buffer.from(digest).toString("hex").slice(0, 16);
}

export function emitPaymentEvent(
  event: Omit<PaymentEvent, "timestamp">
) {
  console.info(
    JSON.stringify({
      ...event,
      timestamp: new Date().toISOString()
    } satisfies PaymentEvent)
  );
}
