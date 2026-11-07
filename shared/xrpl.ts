// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { PaymentRequirements } from "@x402/core/types";
import type { Payment } from "xrpl";
import {
  createXrplHttpRpcClient,
  prepareXrplPaymentTransaction as prepareTransaction,
  xrplHttpEndpoint as resolveXrplHttpEndpoint
} from "../packages/agentcore-xrpl-settlement/src";

export function xrplHttpEndpoint(
  network: string,
  configuredUrl = process.env.XRPL_HTTP_URL
) {
  return resolveXrplHttpEndpoint(network, configuredUrl);
}

export async function xrplRpc<T>(
  network: string,
  method: string,
  parameters: Record<string, unknown>
): Promise<T> {
  return createXrplHttpRpcClient({
    endpoint: (candidateNetwork) => xrplHttpEndpoint(candidateNetwork)
  }).request<T>(network, method, parameters);
}

export async function prepareXrplPaymentTransaction(
  transaction: Payment,
  requirements: PaymentRequirements
) {
  return prepareTransaction(transaction, requirements, {
    rpc: {
      request: xrplRpc
    },
    feeLimitDrops: process.env.XRPL_MAX_FEE_DROPS || "2000"
  });
}
