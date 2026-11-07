// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  PaidResourceRequest,
  PaidResourceResult,
  PaymentBackend
} from "./contracts";
import { PaymentClientError } from "./errors";

export interface PaymentClientOptions {
  backends: PaymentBackend[];
}

function validateRequest(request: PaidResourceRequest) {
  if (!request.approved) {
    throw new PaymentClientError(
      "approval_required",
      "Explicit payment approval is required."
    );
  }
  if (!request.principalId.trim()) {
    throw new PaymentClientError(
      "invalid_request",
      "A non-empty principalId is required."
    );
  }
  if (!request.idempotencyKey.trim()) {
    throw new PaymentClientError(
      "invalid_request",
      "A non-empty idempotencyKey is required."
    );
  }
  if (request.firstResponse.status !== 402) {
    throw new PaymentClientError(
      "invalid_request",
      `The first resource response must be HTTP 402, received ${request.firstResponse.status}.`
    );
  }
  let resource: URL;
  try {
    resource = new URL(request.resourceUrl);
  } catch {
    throw new PaymentClientError(
      "invalid_request",
      "resourceUrl must be an absolute HTTP or HTTPS URL."
    );
  }
  if (resource.protocol !== "http:" && resource.protocol !== "https:") {
    throw new PaymentClientError(
      "invalid_request",
      "resourceUrl must use HTTP or HTTPS."
    );
  }
}

export function createPaymentClient({ backends }: PaymentClientOptions) {
  if (backends.length === 0) {
    throw new PaymentClientError(
      "invalid_request",
      "At least one payment backend is required."
    );
  }
  const backendNames = new Set(backends.map((backend) => backend.name));
  if (backendNames.size !== backends.length) {
    throw new PaymentClientError(
      "invalid_request",
      "Payment backend names must be unique."
    );
  }

  return {
    async payResource(
      request: PaidResourceRequest
    ): Promise<PaidResourceResult> {
      validateRequest(request);

      const compatible = backends.filter((backend) =>
        backend.supports(request.paymentRequiredBody)
      );
      const backend = request.preferredBackend
        ? compatible.find(
            (candidate) => candidate.name === request.preferredBackend
          )
        : compatible[0];

      if (!backend) {
        throw new PaymentClientError(
          "unsupported_challenge",
          request.preferredBackend
            ? `The ${request.preferredBackend} backend cannot pay this challenge.`
            : "No configured payment backend can pay this challenge."
        );
      }

      try {
        const result = await backend.execute(request);
        return {
          status: result.response.ok
            ? "resource_granted"
            : "merchant_retry_failed",
          response: result.response,
          body: result.body,
          receipt: {
            backend: backend.name,
            providerId: result.providerId,
            stage: result.stage,
            details: result.details
          }
        };
      } catch (error) {
        if (error instanceof PaymentClientError) throw error;
        throw new PaymentClientError(
          "backend_failed",
          `${backend.name} payment execution failed.`,
          undefined,
          { cause: error }
        );
      }
    }
  };
}

export type PaymentClient = ReturnType<typeof createPaymentClient>;
