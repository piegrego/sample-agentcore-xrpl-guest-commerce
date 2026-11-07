// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  SettlementInspection,
  SettlementRecord,
  XrplLedgerPayment,
  XrplRpcClient
} from "./contracts";
import { validateXrplPayment } from "./invariants";

export async function inspectSettlement(
  settlement: SettlementRecord,
  rpc: XrplRpcClient
): Promise<SettlementInspection> {
  if (!settlement.transactionId) {
    return { status: "pending" };
  }
  const transaction = await rpc.request<XrplLedgerPayment>(
    settlement.network,
    "tx",
    {
      transaction: settlement.transactionId.toUpperCase(),
      binary: false
    }
  );
  if (transaction.validated !== true) {
    return { status: "pending", transaction };
  }
  const errors = validateXrplPayment(transaction, {
    network: settlement.network,
    payer: settlement.payer,
    destination: settlement.destination,
    amount: settlement.amount,
    invoiceId: settlement.invoiceId,
    transactionId: settlement.transactionId
  });
  return errors.length
    ? { status: "invalid", transaction, errors }
    : { status: "validated", transaction };
}
