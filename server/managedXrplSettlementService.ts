// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { PaymentRequired } from "@x402/core/types";
import {
  inspectSettlement,
  signedXrplTransactionHash,
  type SettlementRecord,
  type SettlementState,
  type XrplMerchantSettlement
} from "../packages/agentcore-xrpl-settlement/src";
import type { Movie, Transaction } from "../src/types";
import {
  activeHotelStay,
  createHotelInvoice
} from "./hotel";
import { ManagedEntitlementService } from "./managedEntitlementService";
import {
  validateManagedPaymentBinding
} from "./managedXrplPayment";
import { PaymentChallengeService } from "./paymentChallengeService";
import { withPaymentLock } from "./paymentContext";
import { PaymentRuntime } from "./paymentRuntime";
import {
  managedBeneficiary,
  type ManagedPaymentPrincipal,
  type PaymentServiceResult
} from "./paymentServiceTypes";
import { reconcileSettlementBatch } from "./reconciliation";
import type { HotelInvoiceRecord } from "./entitlementStore";

const SETTLEMENT_STATE_ORDER: SettlementState[] = [
  "CHALLENGED",
  "SIGNED",
  "SUBMITTED",
  "VALIDATED",
  "GRANTED"
];

export class ManagedXrplSettlementService {
  constructor(
    private readonly runtime: PaymentRuntime,
    private readonly challenges: PaymentChallengeService,
    private readonly entitlements: ManagedEntitlementService
  ) {}

  private async ensureSettlement(
    invoice: HotelInvoiceRecord,
    movie: Movie
  ) {
    if (!this.runtime.config.xrplMerchantAddress) {
      throw new Error(
        "XRPL_MERCHANT_ADDRESS is required for direct XRPL payments."
      );
    }
    const now = this.runtime.now().toISOString();
    return this.runtime.store.ensureSettlement({
      settlementId:
        this.runtime.settlementIdForInvoice(invoice),
      state: "CHALLENGED",
      network: invoice.network,
      resourceId: movie.id,
      payer: invoice.expectedPayerAddress,
      destination:
        this.runtime.config.xrplMerchantAddress,
      amount: String(Math.round(movie.price * 1_000_000)),
      asset: "XRP",
      invoiceId: invoice.ledgerInvoiceId,
      createdAt: now,
      updatedAt: now,
      expiresAt: invoice.expiresAt
    });
  }

  private async advanceSettlement(
    settlementId: string,
    nextState: SettlementState,
    changes: Partial<
      Pick<
        SettlementRecord,
        "transactionId" | "failureReason" | "expiresAt"
      >
    > = {}
  ) {
    const current =
      await this.runtime.store.getSettlement(settlementId);
    if (!current) {
      throw new Error(`Settlement ${settlementId} does not exist.`);
    }
    const currentIndex = SETTLEMENT_STATE_ORDER.indexOf(
      current.state
    );
    const nextIndex = SETTLEMENT_STATE_ORDER.indexOf(nextState);
    if (
      currentIndex >= 0 &&
      nextIndex >= 0 &&
      currentIndex >= nextIndex &&
      (!changes.transactionId ||
        !current.transactionId ||
        changes.transactionId.toUpperCase() ===
          current.transactionId.toUpperCase())
    ) {
      return current;
    }
    return this.runtime.store.transitionSettlement(
      settlementId,
      nextState,
      changes
    );
  }

  async createPurchaseInvoice(
    principal: ManagedPaymentPrincipal,
    movie: Movie,
    correlationId?: string
  ) {
    if (!this.runtime.config.xrplRuntimePayerAddress) {
      throw new Error(
        "XRPL_RUNTIME_PAYER_ADDRESS is required for Runtime-managed XRPL payments."
      );
    }
    const beneficiary = managedBeneficiary(principal);
    const stay = activeHotelStay(
      await this.runtime.store.getActiveHotelStay(
        beneficiary.id,
        beneficiary.network
      )
    );
    if (!stay) {
      throw new Error(
        "Complete Proof of Stay at Ledger Lodge before purchasing a movie."
      );
    }
    const invoice = createHotelInvoice(
      stay,
      movie.id,
      this.runtime.config.xrplRuntimePayerAddress,
      String(Math.round(movie.price * 1_000_000))
    );
    await this.runtime.store.putHotelInvoice(invoice);
    const settlement = await this.ensureSettlement(invoice, movie);
    if (correlationId) {
      this.runtime.emitEvent({
        event: "payment.challenge.created",
        correlationId,
        settlementId: settlement.settlementId,
        principalHash:
          await this.runtime.hashPrincipal(beneficiary.id),
        network: beneficiary.network,
        resourceId: movie.id,
        amount: settlement.amount,
        state: settlement.state
      });
    }
    return invoice;
  }

  private async existingPurchaseInvoice(
    principal: ManagedPaymentPrincipal,
    movie: Movie
  ) {
    if (!this.runtime.config.xrplRuntimePayerAddress) {
      throw new Error(
        "XRPL_RUNTIME_PAYER_ADDRESS is required for Runtime-managed XRPL payments."
      );
    }
    const beneficiary = managedBeneficiary(principal);
    const stay = activeHotelStay(
      await this.runtime.store.getActiveHotelStay(
        beneficiary.id,
        beneficiary.network
      )
    );
    if (!stay) {
      throw new Error(
        "Complete Proof of Stay at Ledger Lodge before recovering a payment."
      );
    }
    const expected = createHotelInvoice(
      stay,
      movie.id,
      this.runtime.config.xrplRuntimePayerAddress,
      String(Math.round(movie.price * 1_000_000))
    );
    const invoice =
      await this.runtime.store.getHotelInvoice(
        expected.ledgerInvoiceId
      );
    if (
      !invoice ||
      invoice.beneficiaryId !== beneficiary.id ||
      invoice.beneficiaryType !== beneficiary.type ||
      invoice.expectedPayerAddress !==
        this.runtime.config.xrplRuntimePayerAddress ||
      invoice.paymentMode !== "runtime-managed" ||
      invoice.titleId !== movie.id ||
      invoice.amount !== expected.amount ||
      invoice.network !== beneficiary.network
    ) {
      throw new Error(
        "No Runtime-managed payment invoice exists for this guest and title."
      );
    }
    return invoice;
  }

  async recover(
    movie: Movie,
    transactionId: string,
    principal: ManagedPaymentPrincipal,
    correlationId: string
  ) {
    return withPaymentLock(
      principal,
      this.runtime.store,
      async () => {
        const beneficiary = managedBeneficiary(principal);
        if (!/^[A-F0-9]{64}$/i.test(transactionId)) {
          throw new Error(
            "Provide a valid XRPL transaction hash."
          );
        }
        const existing = await this.entitlements.get(
          principal,
          movie.id
        );
        if (
          existing?.transactionId.toUpperCase() ===
          transactionId.toUpperCase()
        ) {
          return this.entitlements.transaction(movie, existing);
        }
        const budget =
          await this.entitlements.budget(principal);
        if (movie.price > budget.remaining) {
          this.runtime.emitEvent({
            event: "payment.policy.denied",
            correlationId,
            principalHash:
              await this.runtime.hashPrincipal(beneficiary.id),
            network: beneficiary.network,
            resourceId: movie.id,
            amount: String(
              Math.round(movie.price * 1_000_000)
            ),
            reason: "payment limit exceeded"
          });
          throw new Error(
            `This payment exceeds the session's ${budget.remaining.toFixed(2)} XRP remaining budget.`
          );
        }
        const invoice = await this.existingPurchaseInvoice(
          principal,
          movie
        );
        const settlementId =
          this.runtime.settlementIdForInvoice(invoice);
        await this.advanceSettlement(
          settlementId,
          "SUBMITTED",
          {
            transactionId: transactionId.toUpperCase()
          }
        );
        this.runtime.emitEvent({
          event: "payment.transaction.submitted",
          correlationId,
          settlementId,
          transactionId: transactionId.toUpperCase(),
          principalHash:
            await this.runtime.hashPrincipal(beneficiary.id),
          network: beneficiary.network,
          resourceId: movie.id,
          amount: String(Math.round(movie.price * 1_000_000)),
          state: "SUBMITTED"
        });

        const settlement =
          await this.runtime.store.getSettlement(settlementId);
        if (!settlement) {
          throw new Error(
            "The payment settlement record was not found."
          );
        }
        const inspection = await inspectSettlement(
          settlement,
          this.runtime.settlementRpc
        );
        if (inspection.status === "pending") {
          throw new Error(
            "The XRPL transaction has not reached validated ledger state yet."
          );
        }
        if (inspection.status === "invalid") {
          const failureReason =
            inspection.errors?.join("; ") ||
            "The ledger transaction did not match the settlement.";
          await this.runtime.store.transitionSettlement(
            settlementId,
            "FAILED",
            { failureReason }
          );
          throw new Error(
            "The XRPL transaction is not a validated payment for this title."
          );
        }

        const validatedTransactionId = (
          inspection.transaction?.hash || transactionId
        ).toUpperCase();
        await this.advanceSettlement(
          settlementId,
          "VALIDATED",
          {
            transactionId: validatedTransactionId
          }
        );
        this.runtime.emitEvent({
          event: "payment.transaction.validated",
          correlationId,
          settlementId,
          transactionId: validatedTransactionId,
          principalHash:
            await this.runtime.hashPrincipal(beneficiary.id),
          network: beneficiary.network,
          resourceId: movie.id,
          amount: settlement.amount,
          state: "VALIDATED"
        });
        const recovered = await this.entitlements.persist(
          movie,
          validatedTransactionId,
          beneficiary,
          invoice.expectedPayerAddress,
          invoice,
          this.runtime.now().toISOString(),
          settlementId,
          correlationId
        );
        this.runtime.emitEvent({
          event: "payment.recovery.completed",
          correlationId,
          settlementId,
          transactionId: validatedTransactionId,
          principalHash:
            await this.runtime.hashPrincipal(beneficiary.id),
          network: beneficiary.network,
          resourceId: movie.id,
          amount: settlement.amount,
          state: "GRANTED"
        });
        return recovered;
      }
    );
  }

  async settle(
    signature: string,
    movie: Movie,
    principal: ManagedPaymentPrincipal,
    correlationId: string
  ): Promise<PaymentServiceResult<Transaction>> {
    return withPaymentLock(
      principal,
      this.runtime.store,
      async () => {
        const beneficiary = managedBeneficiary(principal);
        const budget =
          await this.entitlements.budget(principal);
        if (movie.price > budget.remaining) {
          this.runtime.emitEvent({
            event: "payment.policy.denied",
            correlationId,
            principalHash:
              await this.runtime.hashPrincipal(beneficiary.id),
            network: beneficiary.network,
            resourceId: movie.id,
            amount: String(
              Math.round(movie.price * 1_000_000)
            ),
            reason: "payment limit exceeded"
          });
          return {
            ok: false,
            status: 409,
            body: {
              error: "payment_limit_exceeded",
              message: `This ${movie.price.toFixed(2)} XRP payment exceeds the session's ${budget.remaining.toFixed(2)} XRP remaining budget.`
            },
            includeSession: true
          };
        }

        const merchant = await this.runtime.merchant();
        let decodedPayment: ReturnType<
          XrplMerchantSettlement["decodePayment"]
        >;
        try {
          decodedPayment = merchant.decodePayment(signature);
        } catch (error) {
          return {
            ok: false,
            status: 402,
            body: {
              error: "invalid_xrpl_payment",
              message:
                error instanceof Error
                  ? error.message
                  : "The XRPL payment payload is invalid."
            }
          };
        }
        const {
          payload: paymentPayload,
          signedTxBlob,
          transaction: signedTransaction
        } = decodedPayment;
        const invoiceId =
          typeof signedTransaction.InvoiceID === "string"
            ? signedTransaction.InvoiceID.toUpperCase()
            : undefined;
        const invoice = invoiceId
          ? await this.runtime.store.getHotelInvoice(invoiceId)
          : undefined;
        const bindingError = validateManagedPaymentBinding({
          beneficiary,
          configuredPayerAddress:
            this.runtime.config.xrplRuntimePayerAddress,
          signedPayerAddress: signedTransaction.Account,
          invoice,
          titleId: movie.id,
          amount:
            typeof signedTransaction.Amount === "string"
              ? signedTransaction.Amount
              : ""
        });
        if (bindingError) {
          return {
            ok: false,
            status:
              bindingError.error ===
              "runtime_payer_not_configured"
                ? 503
                : 403,
            body: bindingError
          };
        }
        const authorizedInvoice = invoice!;
        const challenge =
          await this.challenges.createXrplChallenge(
            movie,
            this.runtime.config.xrplMerchantAddress!,
            authorizedInvoice.invoiceId
          );
        const settlementRecord =
          await this.ensureSettlement(
            authorizedInvoice,
            movie
          );
        const settlementId = settlementRecord.settlementId;
        const transactionId =
          await signedXrplTransactionHash(signedTxBlob);
        await this.advanceSettlement(settlementId, "SIGNED", {
          transactionId
        });
        this.runtime.emitEvent({
          event: "payment.transaction.signed",
          correlationId,
          settlementId,
          transactionId,
          principalHash:
            await this.runtime.hashPrincipal(beneficiary.id),
          network: beneficiary.network,
          resourceId: movie.id,
          amount: settlementRecord.amount,
          state: "SIGNED"
        });
        const requirements = merchant.findRequirements(
          challenge as PaymentRequired,
          paymentPayload
        );
        if (!requirements) {
          await this.runtime.store.transitionSettlement(
            settlementId,
            "FAILED",
            {
              failureReason: "payment requirements mismatch"
            }
          );
          return {
            ok: false,
            status: 402,
            body: {
              error: "payment_requirements_mismatch",
              message:
                "The signed XRPL payment does not match this resource."
            }
          };
        }

        const verification = await merchant.verify(
          paymentPayload,
          requirements
        );
        if (!verification.isValid) {
          await this.runtime.store.transitionSettlement(
            settlementId,
            "FAILED",
            {
              failureReason:
                verification.invalidReason ||
                "payment verification failed"
            }
          );
          return {
            ok: false,
            status: 402,
            body: {
              error:
                verification.invalidReason ||
                "payment_verification_failed",
              message:
                verification.invalidMessage ||
                "The XRPL payment could not be verified."
            }
          };
        }

        await this.advanceSettlement(
          settlementId,
          "SUBMITTED",
          { transactionId }
        );
        this.runtime.emitEvent({
          event: "payment.transaction.submitted",
          correlationId,
          settlementId,
          transactionId,
          principalHash:
            await this.runtime.hashPrincipal(beneficiary.id),
          network: beneficiary.network,
          resourceId: movie.id,
          amount: settlementRecord.amount,
          state: "SUBMITTED"
        });
        const settlementResult = await merchant.settle(
          paymentPayload,
          requirements
        );
        if (!settlementResult.success) {
          await this.runtime.store.transitionSettlement(
            settlementId,
            "FAILED",
            {
              failureReason:
                settlementResult.errorReason ||
                settlementResult.errorMessage ||
                "payment settlement failed"
            }
          );
          return {
            ok: false,
            status: 402,
            body: {
              error:
                settlementResult.errorReason ||
                "payment_settlement_failed",
              message:
                settlementResult.errorMessage ||
                "The XRPL payment could not be settled."
            }
          };
        }
        if (
          settlementResult.transaction.toUpperCase() !==
          transactionId.toUpperCase()
        ) {
          await this.runtime.store.transitionSettlement(
            settlementId,
            "FAILED",
            {
              failureReason:
                "settlement transaction hash mismatch"
            }
          );
          return {
            ok: false,
            status: 502,
            body: {
              error: "payment_transaction_mismatch",
              message:
                "The facilitator returned a different transaction hash."
            }
          };
        }

        const validatedTransactionId =
          settlementResult.transaction.toUpperCase();
        await this.advanceSettlement(
          settlementId,
          "VALIDATED",
          {
            transactionId: validatedTransactionId
          }
        );
        this.runtime.emitEvent({
          event: "payment.transaction.validated",
          correlationId,
          settlementId,
          transactionId: validatedTransactionId,
          principalHash:
            await this.runtime.hashPrincipal(beneficiary.id),
          network: beneficiary.network,
          resourceId: movie.id,
          amount: settlementRecord.amount,
          state: "VALIDATED"
        });
        const transaction = await this.entitlements.persist(
          movie,
          validatedTransactionId,
          beneficiary,
          authorizedInvoice.expectedPayerAddress,
          authorizedInvoice,
          this.runtime.now().toISOString(),
          settlementId,
          correlationId
        );
        return { ok: true, value: transaction };
      }
    );
  }

  async reconcile(catalog: Movie[], correlationId: string) {
    if (
      this.runtime.config.backend !== "xrpl" ||
      this.runtime.config.asset !== "XRP" ||
      !this.runtime.config.xrplMerchantAddress
    ) {
      return [];
    }
    const results = await reconcileSettlementBatch({
      store: this.runtime.store,
      rpc: this.runtime.settlementRpc,
      grant: async (settlement, transactionId) => {
        const movie = catalog.find(
          (candidate) =>
            candidate.id === settlement.resourceId
        );
        const invoice = settlement.invoiceId
          ? await this.runtime.store.getHotelInvoice(
              settlement.invoiceId
            )
          : undefined;
        if (
          !movie ||
          !invoice ||
          invoice.expectedPayerAddress !== settlement.payer ||
          invoice.paymentMode !== "runtime-managed" ||
          invoice.titleId !== settlement.resourceId ||
          invoice.network !== settlement.network ||
          invoice.amount !== settlement.amount
        ) {
          throw new Error(
            "The settlement application binding could not be restored."
          );
        }
        await this.entitlements.persist(
          movie,
          transactionId,
          {
            id: invoice.beneficiaryId,
            type: invoice.beneficiaryType,
            network: settlement.network
          },
          settlement.payer,
          invoice,
          this.runtime.now().toISOString(),
          settlement.settlementId,
          correlationId
        );
      }
    });
    for (const result of results) {
      if (result.status === "pending") {
        this.runtime.emitEvent({
          event: "payment.reconciliation.pending",
          correlationId,
          settlementId: result.settlementId,
          reason: result.reason
        });
      } else if (result.status === "failed") {
        this.runtime.emitEvent({
          event: "payment.reconciliation.failed",
          correlationId,
          settlementId: result.settlementId,
          reason: result.reason
        });
      }
    }
    return results;
  }
}
