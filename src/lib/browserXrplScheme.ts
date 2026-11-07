// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient
} from "@x402/core/types";
import type { ClientXrplSigner } from "@x402/xrpl";
import type { Payment } from "xrpl";

type PreparePaymentTransaction = (
  transaction: Payment,
  requirements: PaymentRequirements
) => Promise<Payment>;

export async function browserInvoiceIdToInvoiceIdField(invoiceId: string) {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(invoiceId)
    )
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export class BrowserExactXrplScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(
    private readonly signer: ClientXrplSigner,
    private readonly preparePaymentTransaction: PreparePaymentTransaction
  ) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements
  ): Promise<PaymentPayloadResult> {
    if (
      requirements.scheme !== "exact" ||
      !/^xrpl:\d+$/.test(requirements.network)
    ) {
      throw new Error("The merchant returned an unsupported XRPL payment.");
    }
    if (
      requirements.asset !== "XRP" ||
      !/^\d+$/.test(requirements.amount)
    ) {
      throw new Error("The browser wallet supports native XRP payments only.");
    }
    if (requirements.extra?.areFeesSponsored !== false) {
      throw new Error("The XRPL payer must pay the transaction fee.");
    }
    const transferMethod =
      requirements.extra?.assetTransferMethod ?? "sequence";
    if (transferMethod !== "sequence") {
      throw new Error(
        "The browser wallet supports sequence-based XRPL payments only."
      );
    }

    const invoiceId = requirements.extra?.invoiceId;
    if (
      invoiceId !== undefined &&
      (typeof invoiceId !== "string" || !invoiceId)
    ) {
      throw new Error("The XRPL invoice identifier is invalid.");
    }
    const destinationTag = requirements.extra?.destinationTag;
    if (
      destinationTag !== undefined &&
      (typeof destinationTag !== "number" ||
        !Number.isInteger(destinationTag) ||
        destinationTag < 0 ||
        destinationTag > 0xffffffff)
    ) {
      throw new Error("The XRPL destination tag is invalid.");
    }

    const networkId = Number(requirements.network.slice("xrpl:".length));
    if (
      !Number.isSafeInteger(networkId) ||
      networkId < 0 ||
      networkId > 0xffffffff
    ) {
      throw new Error("The XRPL network identifier is invalid.");
    }
    const transaction: Payment = {
      TransactionType: "Payment",
      Account: this.signer.classicAddress,
      Destination: requirements.payTo,
      Amount: requirements.amount,
      ...(invoiceId
        ? {
            InvoiceID:
              await browserInvoiceIdToInvoiceIdField(invoiceId)
          }
        : {}),
      ...(destinationTag !== undefined
        ? { DestinationTag: destinationTag }
        : {}),
      ...(networkId > 1024 ? { NetworkID: networkId } : {})
    };
    const prepared = await this.preparePaymentTransaction(
      transaction,
      requirements
    );
    if (
      prepared.TransactionType !== "Payment" ||
      typeof prepared.Sequence !== "number" ||
      prepared.Sequence <= 0 ||
      typeof prepared.Fee !== "string" ||
      !/^\d+$/.test(prepared.Fee) ||
      typeof prepared.LastLedgerSequence !== "number"
    ) {
      throw new Error(
        "The storefront returned an invalid prepared XRPL payment."
      );
    }

    const signed = await this.signer.sign(prepared);
    return {
      x402Version,
      payload: { signedTxBlob: signed.signedTxBlob }
    };
  }
}
