// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { PaymentRequirements } from "@x402/core/types";
import type { Payment } from "xrpl";
import type { XrplRpcClient } from "./contracts";
import { createXrplHttpRpcClient } from "./rpc";

export interface PrepareXrplPaymentOptions {
  rpc?: XrplRpcClient;
  ledgerCloseSeconds?: number;
  feeLimitDrops?: string;
}

function positiveInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`XRPL ${field} must be a positive integer.`);
  }
  return parsed;
}

export async function prepareXrplPaymentTransaction(
  transaction: Payment,
  requirements: PaymentRequirements,
  options: PrepareXrplPaymentOptions = {}
) {
  if (
    transaction.TransactionType !== "Payment" ||
    requirements.scheme !== "exact" ||
    !requirements.network.startsWith("xrpl:") ||
    requirements.asset.toUpperCase() !== "XRP"
  ) {
    throw new Error("Only exact native-XRP payments can be prepared.");
  }
  const rpc = options.rpc ?? createXrplHttpRpcClient();
  const [accountInfo, fee, ledger] = await Promise.all([
    rpc.request<{ account_data: { Sequence: number } }>(
      requirements.network,
      "account_info",
      {
        account: transaction.Account,
        ledger_index: "validated",
        strict: true
      }
    ),
    rpc.request<{ drops: { open_ledger_fee: string } }>(
      requirements.network,
      "fee",
      {}
    ),
    rpc.request<{ ledger_index: number | string }>(
      requirements.network,
      "ledger",
      {
        ledger_index: "validated",
        transactions: false,
        expand: false
      }
    )
  ]);
  const sequence = positiveInteger(
    accountInfo.account_data.Sequence,
    "account sequence"
  );
  const validatedLedgerIndex = positiveInteger(
    ledger.ledger_index,
    "validated ledger index"
  );
  const openLedgerFee = fee.drops.open_ledger_fee;
  if (!/^\d+$/.test(openLedgerFee) || BigInt(openLedgerFee) <= 0n) {
    throw new Error("XRPL fee response omitted a valid open-ledger fee.");
  }
  if (
    options.feeLimitDrops &&
    (!/^\d+$/.test(options.feeLimitDrops) ||
      BigInt(options.feeLimitDrops) <= 0n)
  ) {
    throw new Error(
      "feeLimitDrops must be a positive integer number of drops."
    );
  }
  if (
    options.feeLimitDrops &&
    BigInt(openLedgerFee) > BigInt(options.feeLimitDrops)
  ) {
    throw new Error(
      `XRPL open-ledger fee ${openLedgerFee} exceeds the configured ${options.feeLimitDrops} drop limit.`
    );
  }
  const ledgerCloseSeconds = options.ledgerCloseSeconds ?? 5;
  if (!Number.isFinite(ledgerCloseSeconds) || ledgerCloseSeconds <= 0) {
    throw new Error("ledgerCloseSeconds must be greater than zero.");
  }
  return {
    ...transaction,
    Sequence: sequence,
    Fee: openLedgerFee,
    LastLedgerSequence:
      validatedLedgerIndex +
      Math.ceil(requirements.maxTimeoutSeconds / ledgerCloseSeconds) +
      2
  } satisfies Payment;
}
