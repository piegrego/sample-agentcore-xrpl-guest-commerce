// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { PaymentRequirementView } from "./contracts";

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readPaymentChallenge(
  paymentRequiredBody: unknown
): Record<string, unknown> | undefined {
  const body = objectValue(paymentRequiredBody);
  if (!body) return undefined;
  return objectValue(body.challenge) ?? body;
}

export function readPaymentRequirements(
  paymentRequiredBody: unknown
): PaymentRequirementView[] {
  const challenge = readPaymentChallenge(paymentRequiredBody);
  if (!Array.isArray(challenge?.accepts)) return [];

  return challenge.accepts.flatMap((candidate) => {
    const requirement = objectValue(candidate);
    if (
      typeof requirement?.scheme !== "string" ||
      typeof requirement.network !== "string" ||
      typeof requirement.asset !== "string"
    ) {
      return [];
    }
    return [
      {
        scheme: requirement.scheme,
        network: requirement.network,
        asset: requirement.asset,
        amount:
          typeof requirement.amount === "string"
            ? requirement.amount
            : undefined,
        payTo:
          typeof requirement.payTo === "string"
            ? requirement.payTo
            : undefined
      }
    ];
  });
}

export function readX402Version(paymentRequiredBody: unknown) {
  const version = readPaymentChallenge(paymentRequiredBody)?.x402Version;
  return typeof version === "number" || typeof version === "string"
    ? String(version)
    : "2";
}
