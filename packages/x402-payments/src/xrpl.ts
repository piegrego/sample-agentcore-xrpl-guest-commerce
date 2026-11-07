// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { x402HTTPClient } from "@x402/core/http";
import {
  payXrplResource
} from "../../agentcore-xrpl-settlement/src";
import { readPaymentRequirements } from "./challenge";
import type {
  PaymentBackend,
  PaidResourceRequest
} from "./contracts";
import { PaymentClientError } from "./errors";

export interface XrplPaymentBackendOptions {
  client: x402HTTPClient;
}

function transactionId(settlement: unknown) {
  if (
    typeof settlement === "object" &&
    settlement !== null &&
    "transaction" in settlement &&
    typeof settlement.transaction === "string"
  ) {
    return settlement.transaction;
  }
  return undefined;
}

export function createXrplPaymentBackend({
  client
}: XrplPaymentBackendOptions): PaymentBackend {
  const supports = (paymentRequiredBody: unknown) =>
    readPaymentRequirements(paymentRequiredBody).some(
      (requirement) =>
        requirement.scheme === "exact" &&
        requirement.network.startsWith("xrpl:") &&
        requirement.asset.toUpperCase() === "XRP"
    );

  return {
    name: "xrpl",
    supports,
    async execute(request: PaidResourceRequest) {
      if (!request.approved) {
        throw new PaymentClientError(
          "approval_required",
          "Explicit payment approval is required."
        );
      }
      if (!supports(request.paymentRequiredBody)) {
        throw new PaymentClientError(
          "unsupported_challenge",
          "The XRPL backend cannot pay this challenge."
        );
      }
      const result = await payXrplResource({
        client,
        firstResponse: request.firstResponse,
        paymentRequiredBody: request.paymentRequiredBody,
        resourceUrl: request.resourceUrl,
        headers: request.headers,
        fetch: request.fetch,
        parseResponse: request.responseParser
      });
      return {
        response: result.response,
        body: result.body,
        providerId: transactionId(result.settlement),
        stage: result.settlement
          ? "settled"
          : result.response.ok
            ? "merchant_accepted"
            : "proof_generated",
        details: result.settlement
      };
    }
  };
}
