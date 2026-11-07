// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type {
  Network,
  PaymentRequirements
} from "@x402/core/types";
import type { ClientXrplSigner } from "@x402/xrpl";
import { ExactXrplScheme } from "@x402/xrpl/exact/client";
import type { Payment } from "xrpl";

type PreparePaymentTransaction = (
  transaction: Payment,
  requirements: PaymentRequirements
) => Promise<Payment>;

type PaymentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

type ParsePaymentResponse = (response: Response) => Promise<unknown>;

async function parsePaymentResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("json")
    ? response.json()
    : response.text();
}

export interface XrplPayerOptions {
  network: Network;
  signer: ClientXrplSigner;
  maxAmountPerPayment: string;
  preparePaymentTransaction: PreparePaymentTransaction;
}

export function createXrplPayer({
  network,
  signer,
  maxAmountPerPayment,
  preparePaymentTransaction
}: XrplPayerOptions) {
  if (!network.startsWith("xrpl:")) {
    throw new Error("The XRPL payer requires an XRPL network.");
  }
  if (
    !/^\d+$/.test(maxAmountPerPayment) ||
    BigInt(maxAmountPerPayment) <= 0n
  ) {
    throw new Error(
      "The XRPL payment limit must use integer drops."
    );
  }
  const client = new x402Client()
    .setSpendControls({
      maxAmountPerPayment: false,
      allowedAssets: [
        {
          network: "xrpl:*",
          asset: "XRP",
          maxAmountPerPayment
        }
      ]
    })
    .registerPolicy((_version, requirements) =>
      requirements.filter(
        (requirement) =>
          requirement.network.startsWith("xrpl:") &&
          requirement.asset.toUpperCase() === "XRP"
      )
    )
    .register(
      network,
      new ExactXrplScheme(signer, {
        preparePaymentTransaction
      })
    );
  return new x402HTTPClient(client);
}

interface PayXrplResourceOptions {
  client: x402HTTPClient;
  firstResponse: Response;
  paymentRequiredBody: unknown;
  resourceUrl: string;
  headers?: Record<string, string>;
  fetch?: PaymentFetch;
  parseResponse?: ParsePaymentResponse;
}

export async function payXrplResource({
  client,
  firstResponse,
  paymentRequiredBody,
  resourceUrl,
  headers = {},
  fetch: fetchImplementation = globalThis.fetch as PaymentFetch,
  parseResponse = parsePaymentResponse
}: PayXrplResourceOptions) {
  const required = client.getPaymentRequiredResponse(
    (name) => firstResponse.headers.get(name),
    paymentRequiredBody
  );
  const payload = await client.createPaymentPayload(required);
  const response = await fetchImplementation(resourceUrl, {
    headers: {
      accept: "application/json",
      ...headers,
      ...client.encodePaymentSignatureHeader(payload)
    }
  });
  const body = await parseResponse(response);
  const settlement = response.headers.get("payment-response")
    ? client.getPaymentSettleResponse((name) =>
        response.headers.get(name)
      )
    : undefined;
  return {
    response,
    body,
    settlement
  };
}
