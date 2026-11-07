// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { randomBytes } from "node:crypto";
import { Wallet } from "xrpl";

export function createTestAccountId(): string {
  const digits = Array.from(randomBytes(12), (value) => String(value % 10));
  digits[0] = String((randomBytes(1)[0] % 9) + 1);
  return digits.join("");
}

export function createTestCommitSha(): string {
  return randomBytes(20).toString("hex");
}

export function createTestRuntimeSessionId(): string {
  return `agentcore-xrpl-session-${randomBytes(18).toString("hex")}`;
}

export function createTestXrplAddress(): string {
  return Wallet.generate().classicAddress;
}

export function createTestSecretArn(
  account: string,
  region = "us-east-1"
): string {
  return `arn:aws:secretsmanager:${region}:${account}:secret:test/${randomBytes(12).toString("hex")}`;
}
