// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  ProcessPaymentCommand,
  type CryptoX402PaymentInput,
  type ProcessPaymentCommandOutput
} from "@aws-sdk/client-bedrock-agentcore";
import {
  readPaymentChallenge,
  readPaymentRequirements,
  readX402Version
} from "./challenge";
import type {
  PaidResourceRequest,
  PaymentBackend,
  PaymentRequirementView
} from "./contracts";
import { PaymentClientError } from "./errors";

export interface AgentCoreProcessPaymentClient {
  send(
    command: ProcessPaymentCommand
  ): Promise<ProcessPaymentCommandOutput>;
}

export interface AgentCorePaymentContext {
  paymentManagerArn: string;
  paymentSessionId: string;
  paymentInstrumentId: string;
  agentName: string;
}

export interface AgentCorePaymentBackendOptions {
  client: AgentCoreProcessPaymentClient;
  context:
    | AgentCorePaymentContext
    | ((
        request: PaidResourceRequest
      ) => AgentCorePaymentContext | Promise<AgentCorePaymentContext>);
  supportedNetworks?: readonly string[];
  supportedAssets?: readonly string[];
  supportedSchemes?: readonly string[];
  supportsRequirement?: (
    requirement: PaymentRequirementView
  ) => boolean;
  proofHeaderNames?: readonly ("x-payment" | "payment-signature")[];
}

async function responseBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("json")
    ? response.json()
    : response.text();
}

function nonEmpty(value: string, field: string) {
  if (!value.trim()) {
    throw new PaymentClientError(
      "invalid_request",
      `AgentCore Payments requires ${field}.`
    );
  }
}

function isDocumentValue(
  value: unknown,
  seen = new Set<object>()
): value is NonNullable<CryptoX402PaymentInput["payload"]> {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    valid = value.every((item) => isDocumentValue(item, seen));
  } else {
    valid = Object.values(value).every((item) =>
      isDocumentValue(item, seen)
    );
  }
  seen.delete(value);
  return valid;
}

export function createAgentCorePaymentBackend(
  options: AgentCorePaymentBackendOptions
): PaymentBackend {
  const schemes = new Set(options.supportedSchemes ?? ["exact", "upto"]);
  const networks = new Set(options.supportedNetworks ?? []);
  const assets = new Set(
    (options.supportedAssets ?? []).map((asset) => asset.toUpperCase())
  );
  const proofHeaderNames =
    options.proofHeaderNames ?? ["x-payment", "payment-signature"];

  if (
    proofHeaderNames.length === 0 ||
    new Set(proofHeaderNames).size !== proofHeaderNames.length
  ) {
    throw new PaymentClientError(
      "invalid_request",
      "AgentCore Payments requires one or more unique proofHeaderNames."
    );
  }
  if (
    !options.supportsRequirement &&
    networks.size === 0
  ) {
    throw new PaymentClientError(
      "invalid_request",
      "AgentCore Payments requires supportedNetworks or supportsRequirement."
    );
  }

  const supports = (requirement: PaymentRequirementView) => {
    if (!schemes.has(requirement.scheme)) return false;
    if (options.supportsRequirement) {
      return options.supportsRequirement(requirement);
    }
    return (
      networks.has(requirement.network) &&
      (assets.size === 0 ||
        assets.has(requirement.asset.toUpperCase()))
    );
  };

  return {
    name: "agentcore",
    supports(paymentRequiredBody) {
      return readPaymentRequirements(paymentRequiredBody).some(supports);
    },
    async execute(request) {
      if (!request.approved) {
        throw new PaymentClientError(
          "approval_required",
          "Explicit payment approval is required."
        );
      }
      if (
        !readPaymentRequirements(request.paymentRequiredBody).some(
          supports
        )
      ) {
        throw new PaymentClientError(
          "unsupported_challenge",
          "AgentCore Payments cannot pay this challenge."
        );
      }
      if (
        request.idempotencyKey.length < 33 ||
        request.idempotencyKey.length > 256
      ) {
        throw new PaymentClientError(
          "invalid_request",
          "AgentCore Payments idempotencyKey must contain 33 to 256 characters."
        );
      }
      const context =
        typeof options.context === "function"
          ? await options.context(request)
          : options.context;
      nonEmpty(context.paymentManagerArn, "paymentManagerArn");
      nonEmpty(context.paymentSessionId, "paymentSessionId");
      nonEmpty(context.paymentInstrumentId, "paymentInstrumentId");
      nonEmpty(context.agentName, "agentName");

      const challenge = readPaymentChallenge(request.paymentRequiredBody);
      if (!challenge) {
        throw new PaymentClientError(
          "invalid_request",
          "The x402 payment challenge is missing."
        );
      }
      if (!isDocumentValue(challenge)) {
        throw new PaymentClientError(
          "invalid_request",
          "The x402 payment challenge must contain JSON-compatible values."
        );
      }

      const payment = await options.client.send(
        new ProcessPaymentCommand({
          userId: request.principalId,
          agentName: context.agentName,
          paymentManagerArn: context.paymentManagerArn,
          paymentSessionId: context.paymentSessionId,
          paymentInstrumentId: context.paymentInstrumentId,
          paymentType: "CRYPTO_X402",
          paymentInput: {
            cryptoX402: {
              version: readX402Version(request.paymentRequiredBody),
              payload: challenge
            }
          },
          clientToken: request.idempotencyKey
        })
      );

      const proof = payment.paymentOutput?.cryptoX402?.payload;
      if (payment.status !== "PROOF_GENERATED" || !proof) {
        throw new PaymentClientError(
          "backend_failed",
          "AgentCore Payments did not return payment proof.",
          payment
        );
      }

      const encodedProof =
        typeof proof === "string" ? proof : JSON.stringify(proof);
      const proofHeaders = Object.fromEntries(
        proofHeaderNames.map((name) => [name, encodedProof])
      );
      const fetchImplementation = request.fetch ?? globalThis.fetch;
      if (!fetchImplementation) {
        throw new PaymentClientError(
          "invalid_request",
          "An HTTP fetch implementation is required."
        );
      }
      const response = await fetchImplementation(request.resourceUrl, {
        headers: {
          accept: "application/json",
          ...request.headers,
          ...proofHeaders
        }
      });

      return {
        response,
        body: await (request.responseParser ?? responseBody)(response),
        providerId: payment.processPaymentId,
        stage: response.ok ? "merchant_accepted" : "proof_generated",
        details: payment
      };
    }
  };
}
