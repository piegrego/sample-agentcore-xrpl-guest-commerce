// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  PaymentRequirements
} from "@x402/core/types";
import {
  isValidClassicAddress,
  type Payment
} from "xrpl";
import {
  prepareXrplPaymentTransaction
} from "../shared/xrpl";
import type {
  Movie,
  PaymentChallenge
} from "../src/types";
import type { WalletSession } from "./entitlementStore";
import { PaymentRuntime } from "./paymentRuntime";
import {
  MERCHANT_NAME,
  managedBeneficiary,
  type ManagedPaymentPrincipal,
  type PaymentServiceResult
} from "./paymentServiceTypes";

export class PaymentChallengeService {
  constructor(private readonly runtime: PaymentRuntime) {}

  async recordApprovalRequested(
    movie: Movie,
    challenge: PaymentChallenge,
    principal: ManagedPaymentPrincipal | undefined,
    correlationId: string
  ) {
    const beneficiary = principal
      ? managedBeneficiary(principal)
      : undefined;
    this.runtime.emitEvent({
      event: "payment.approval.requested",
      correlationId,
      principalHash: beneficiary
        ? await this.runtime.hashPrincipal(beneficiary.id)
        : undefined,
      network: challenge.accepts[0]?.network,
      resourceId: movie.id,
      amount: challenge.accepts[0]?.amount,
      state: "CHALLENGED"
    });
  }

  async createXrplChallenge(
    movie: Movie,
    payTo: string,
    invoiceId?: string
  ): Promise<PaymentChallenge> {
    const merchant = await this.runtime.merchant();
    const required = await merchant.createPaymentRequired({
      network: this.runtime.config.xrplNetwork,
      payTo,
      amount: Math.round(movie.price * 1_000_000).toString(),
      maxTimeoutSeconds: 60,
      invoiceId,
      resource: {
        url: `/api/titles/${movie.id}/stream`,
        description: `48-hour streaming access to ${movie.title}`,
        mimeType: "application/vnd.apple.mpegurl",
        serviceName: MERCHANT_NAME
      },
      errorMessage: `Payment is required to stream ${movie.title}.`
    });
    return {
      ...required,
      merchant: {
        name: MERCHANT_NAME,
        category: "Digital entertainment"
      }
    } as PaymentChallenge;
  }

  createUsdcChallenge(movie: Movie): PaymentChallenge {
    return {
      x402Version: 2,
      resource: {
        url: `/api/titles/${movie.id}/stream`,
        description: `48-hour streaming access to ${movie.title}`,
        mimeType: "application/vnd.apple.mpegurl"
      },
      accepts: [
        {
          scheme: "exact",
          network: this.runtime.config.usdcNetwork,
          asset: this.runtime.config.usdcAsset,
          amount: Math.round(movie.price * 1_000_000).toString(),
          payTo: this.runtime.config.usdcPayTo,
          maxTimeoutSeconds: 60,
          extra: { name: "USDC", version: "2" }
        }
      ],
      merchant: {
        name: MERCHANT_NAME,
        category: "Digital entertainment"
      }
    };
  }

  async prepareWalletPayment(
    transaction: Payment | undefined,
    requirements: PaymentRequirements | undefined,
    wallet: WalletSession,
    correlationId: string
  ): Promise<PaymentServiceResult<Payment>> {
    if (
      !transaction ||
      transaction.TransactionType !== "Payment" ||
      !isValidClassicAddress(transaction.Account) ||
      transaction.Account !== wallet.address ||
      !requirements ||
      requirements.scheme !== "exact" ||
      requirements.network !== this.runtime.config.xrplNetwork ||
      requirements.asset !== "XRP" ||
      requirements.payTo !==
        this.runtime.config.xrplMerchantAddress ||
      transaction.Destination !== requirements.payTo ||
      transaction.Amount !== requirements.amount
    ) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_xrpl_payment",
          message:
            "The transaction does not match this storefront's XRPL payment configuration."
        }
      };
    }

    const invoiceId = requirements.extra?.invoiceId;
    const ledgerInvoiceId = transaction.InvoiceID?.toUpperCase();
    const invoice = ledgerInvoiceId
      ? await this.runtime.store.getHotelInvoice(ledgerInvoiceId)
      : undefined;
    if (
      typeof invoiceId !== "string" ||
      !ledgerInvoiceId ||
      !invoice ||
      invoice.invoiceId !== invoiceId ||
      invoice.paymentMode !== "consumer-wallet" ||
      invoice.beneficiaryType !== "wallet" ||
      invoice.beneficiaryId !== wallet.address ||
      invoice.expectedPayerAddress !== wallet.address
    ) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "proof_of_stay_receipt_invalid",
          message:
            "The payment is missing its Ledger Lodge invoice binding."
        }
      };
    }

    try {
      const prepared = await prepareXrplPaymentTransaction(
        transaction,
        requirements
      );
      this.runtime.emitEvent({
        event: "payment.transaction.prepared",
        correlationId,
        settlementId:
          this.runtime.settlementIdForInvoice(invoice),
        principalHash:
          await this.runtime.hashPrincipal(wallet.address),
        network: wallet.network,
        resourceId: invoice.titleId,
        amount: requirements.amount,
        state: "CHALLENGED"
      });
      return { ok: true, value: prepared };
    } catch (error) {
      console.error(error);
      return {
        ok: false,
        status: 502,
        body: {
          error: "xrpl_prepare_failed",
          message:
            error instanceof Error ? error.message : "Unknown error"
        }
      };
    }
  }
}
