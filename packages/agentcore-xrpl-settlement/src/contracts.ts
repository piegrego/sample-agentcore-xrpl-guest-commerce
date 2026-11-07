// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Payment } from "xrpl";

export interface XrplRpcClient {
  request<T>(
    network: string,
    method: string,
    parameters: Record<string, unknown>
  ): Promise<T>;
}

export interface XrplPaymentExpectation {
  network: string;
  payer: string;
  destination: string;
  amount: string;
  invoiceId?: string;
  transactionId?: string;
}

export interface XrplLedgerPayment extends Payment {
  hash?: string;
  validated?: boolean;
  meta?: {
    TransactionResult?: string;
  };
}

export type SettlementState =
  | "CHALLENGED"
  | "SIGNED"
  | "SUBMITTED"
  | "VALIDATED"
  | "GRANTED"
  | "EXPIRED"
  | "FAILED";

export interface SettlementRecord {
  settlementId: string;
  state: SettlementState;
  network: string;
  resourceId: string;
  payer: string;
  destination: string;
  amount: string;
  asset: "XRP";
  invoiceId?: string;
  transactionId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
  failureReason?: string;
}

export interface SettlementInspection {
  status: "pending" | "validated" | "invalid";
  transaction?: XrplLedgerPayment;
  errors?: string[];
}
