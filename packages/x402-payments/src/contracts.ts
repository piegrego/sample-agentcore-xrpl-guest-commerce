// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export type PaymentBackendName = "xrpl" | "agentcore";

export type PaymentResultStatus =
  | "resource_granted"
  | "merchant_retry_failed";

export type PaymentProviderStage =
  | "proof_generated"
  | "merchant_accepted"
  | "settled";

export type PaymentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface PaidResourceRequest {
  principalId: string;
  resourceUrl: string;
  firstResponse: Response;
  paymentRequiredBody: unknown;
  approved: boolean;
  idempotencyKey: string;
  headers?: Record<string, string>;
  preferredBackend?: PaymentBackendName;
  fetch?: PaymentFetch;
  responseParser?: (response: Response) => Promise<unknown>;
}

export interface BackendPaymentResult {
  response: Response;
  body: unknown;
  providerId?: string;
  stage: PaymentProviderStage;
  details?: unknown;
}

export interface PaymentReceipt {
  backend: PaymentBackendName;
  providerId?: string;
  stage: PaymentProviderStage;
  details?: unknown;
}

export interface PaidResourceResult {
  status: PaymentResultStatus;
  response: Response;
  body: unknown;
  receipt: PaymentReceipt;
}

export interface PaymentRequirementView {
  scheme: string;
  network: string;
  asset: string;
  amount?: string;
  payTo?: string;
}

export interface PaymentBackend {
  readonly name: PaymentBackendName;
  supports(paymentRequiredBody: unknown): boolean;
  execute(request: PaidResourceRequest): Promise<BackendPaymentResult>;
}
