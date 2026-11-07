// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  SettlementRecord,
  SettlementState
} from "./contracts";

const forwardTransitions: Record<SettlementState, SettlementState[]> = {
  CHALLENGED: ["SIGNED", "SUBMITTED", "FAILED", "EXPIRED"],
  SIGNED: ["SUBMITTED", "FAILED", "EXPIRED"],
  SUBMITTED: ["VALIDATED", "FAILED", "EXPIRED"],
  VALIDATED: ["GRANTED", "FAILED"],
  GRANTED: [],
  EXPIRED: ["CHALLENGED"],
  FAILED: ["SIGNED", "SUBMITTED"]
};

export function canTransitionSettlement(
  current: SettlementState,
  next: SettlementState
) {
  return current === next || forwardTransitions[current].includes(next);
}

export function transitionSettlementRecord(
  current: SettlementRecord,
  next: SettlementState,
  changes: Partial<
    Pick<SettlementRecord, "transactionId" | "failureReason" | "expiresAt">
  > = {},
  now = new Date()
) {
  if (!canTransitionSettlement(current.state, next)) {
    throw new Error(
      `Settlement cannot transition from ${current.state} to ${next}.`
    );
  }
  if (
    (next === "SIGNED" ||
      next === "SUBMITTED" ||
      next === "VALIDATED" ||
      next === "GRANTED") &&
    !(changes.transactionId || current.transactionId)
  ) {
    throw new Error(`${next} settlements require a transactionId.`);
  }
  return {
    ...current,
    ...changes,
    state: next,
    updatedAt: now.toISOString(),
    failureReason:
      next === "FAILED"
        ? changes.failureReason || current.failureReason || "Unknown failure"
        : undefined
  } satisfies SettlementRecord;
}
