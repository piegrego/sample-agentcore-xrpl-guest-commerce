// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  decodePaymentSignatureHeader
} from "@x402/core/http";
import {
  x402ResourceServer,
  type FacilitatorClient
} from "@x402/core/server";
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SupportedResponse
} from "@x402/core/types";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  decodeSignedTransactionBlob
} from "@x402/xrpl";
import { ExactXrplScheme as XrplServerScheme } from "@x402/xrpl/exact/server";
import { ExactXrplScheme as XrplFacilitatorScheme } from "@x402/xrpl/exact/facilitator";

export interface XrplPaymentChallengeOptions {
  network: Network;
  payTo: string;
  amount: string;
  maxTimeoutSeconds: number;
  invoiceId?: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
    serviceName: string;
  };
  errorMessage: string;
}

export interface DecodedXrplPayment {
  payload: PaymentPayload;
  signedTxBlob: string;
  transaction: ReturnType<typeof decodeSignedTransactionBlob>;
}

export class XrplMerchantSettlement {
  private constructor(
    private readonly server: x402ResourceServer
  ) {}

  static async create(network: Network) {
    if (!network.startsWith("xrpl:")) {
      throw new Error("The XRPL merchant requires an XRPL network.");
    }
    const facilitator = new x402Facilitator().register(
      network,
      new XrplFacilitatorScheme()
    );
    const facilitatorClient: FacilitatorClient = {
      verify: (payload, requirements) =>
        facilitator.verify(payload, requirements),
      settle: (payload, requirements) =>
        facilitator.settle(payload, requirements),
      getSupported: async () =>
        facilitator.getSupported() as SupportedResponse
    };
    const server = new x402ResourceServer(
      facilitatorClient
    ).register("xrpl:*", new XrplServerScheme());
    await server.initialize();
    return new XrplMerchantSettlement(server);
  }

  async createPaymentRequired({
    network,
    payTo,
    amount,
    maxTimeoutSeconds,
    invoiceId,
    resource,
    errorMessage
  }: XrplPaymentChallengeOptions): Promise<PaymentRequired> {
    if (
      !network.startsWith("xrpl:") ||
      !/^\d+$/.test(amount) ||
      BigInt(amount) <= 0n ||
      !payTo.trim() ||
      !Number.isFinite(maxTimeoutSeconds) ||
      maxTimeoutSeconds <= 0
    ) {
      throw new Error("The XRPL payment challenge is invalid.");
    }
    const accepts = await this.server.buildPaymentRequirementsFromOptions(
      [
        {
          scheme: "exact",
          network,
          payTo,
          price: {
            asset: "XRP",
            amount
          },
          maxTimeoutSeconds,
          extra: invoiceId ? { invoiceId } : undefined
        }
      ],
      undefined
    );
    return this.server.createPaymentRequiredResponse(
      accepts,
      resource,
      errorMessage
    );
  }

  decodePayment(signature: string): DecodedXrplPayment {
    const payload = decodePaymentSignatureHeader(signature);
    const candidate = payload.payload;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("signedTxBlob" in candidate) ||
      typeof candidate.signedTxBlob !== "string"
    ) {
      throw new Error(
        "The XRPL payment payload did not contain a signed transaction."
      );
    }
    return {
      payload,
      signedTxBlob: candidate.signedTxBlob,
      transaction: decodeSignedTransactionBlob(
        candidate.signedTxBlob
      )
    };
  }

  findRequirements(
    challenge: PaymentRequired,
    payload: PaymentPayload
  ): PaymentRequirements | undefined {
    return this.server.findMatchingRequirements(
      challenge.accepts,
      payload
    );
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.server.verifyPayment(payload, requirements);
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.server.settlePayment(payload, requirements);
  }
}
