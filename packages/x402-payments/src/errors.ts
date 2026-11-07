// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export type PaymentClientErrorCode =
  | "approval_required"
  | "invalid_request"
  | "unsupported_challenge"
  | "backend_failed";

export class PaymentClientError extends Error {
  constructor(
    readonly code: PaymentClientErrorCode,
    message: string,
    readonly details?: unknown,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PaymentClientError";
  }
}
