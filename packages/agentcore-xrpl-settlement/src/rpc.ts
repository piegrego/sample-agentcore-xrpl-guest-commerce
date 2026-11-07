// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { XrplRpcClient } from "./contracts";
import { xrplHttpEndpoint } from "./networks";

type Fetch = typeof globalThis.fetch;

export interface XrplHttpRpcClientOptions {
  endpoint?: string | ((network: string) => string);
  fetch?: Fetch;
}

export function createXrplHttpRpcClient(
  options: XrplHttpRpcClientOptions = {}
): XrplRpcClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new Error("An HTTP fetch implementation is required.");
  }

  return {
    async request<T>(
      network: string,
      method: string,
      parameters: Record<string, unknown>
    ): Promise<T> {
      if (!method.trim()) {
        throw new Error("An XRPL RPC method is required.");
      }
      const endpoint =
        typeof options.endpoint === "function"
          ? options.endpoint(network)
          : xrplHttpEndpoint(network, options.endpoint);
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params: [parameters] })
      });
      const body = (await response.json()) as {
        result?: T & { error?: string; error_message?: string };
      };
      if (!response.ok || !body.result || body.result.error) {
        throw new Error(
          body.result?.error_message ||
            body.result?.error ||
            `XRPL ${method} request failed with HTTP ${response.status}.`
        );
      }
      return body.result;
    }
  };
}

export async function xrplRpc<T>(
  network: string,
  method: string,
  parameters: Record<string, unknown>,
  options?: XrplHttpRpcClientOptions
) {
  return createXrplHttpRpcClient(options).request<T>(
    network,
    method,
    parameters
  );
}
