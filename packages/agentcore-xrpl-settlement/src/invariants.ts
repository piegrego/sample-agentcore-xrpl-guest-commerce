// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  XrplLedgerPayment,
  XrplPaymentExpectation
} from "./contracts";

export function validateXrplPayment(
  transaction: XrplLedgerPayment,
  expected: XrplPaymentExpectation
) {
  const errors: string[] = [];
  if (transaction.validated !== true) {
    errors.push("transaction is not validated");
  }
  if (transaction.meta?.TransactionResult !== "tesSUCCESS") {
    errors.push("transaction result is not tesSUCCESS");
  }
  if (transaction.TransactionType !== "Payment") {
    errors.push("transaction type is not Payment");
  }
  if (transaction.Account !== expected.payer) {
    errors.push("payer does not match");
  }
  if (transaction.Destination !== expected.destination) {
    errors.push("destination does not match");
  }
  if (transaction.Amount !== expected.amount) {
    errors.push("amount does not match");
  }
  if (
    expected.invoiceId &&
    transaction.InvoiceID?.toUpperCase() !== expected.invoiceId.toUpperCase()
  ) {
    errors.push("invoice does not match");
  }
  const actualTransactionId = transaction.hash?.toUpperCase();
  if (
    expected.transactionId &&
    actualTransactionId &&
    actualTransactionId !== expected.transactionId.toUpperCase()
  ) {
    errors.push("transaction hash does not match");
  }
  return errors;
}
