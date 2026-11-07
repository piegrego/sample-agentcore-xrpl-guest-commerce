// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { PaymentRequirements } from "@x402/core/types";
import type { Payment } from "xrpl";
import type {
  Movie,
  PaymentChallenge,
  Transaction
} from "../src/types";
import type { WalletSession } from "./entitlementStore";
import { ManagedEntitlementService } from "./managedEntitlementService";
import { ManagedXrplSettlementService } from "./managedXrplSettlementService";
import { PaymentChallengeService } from "./paymentChallengeService";
import type { PaymentPrincipal } from "./paymentContext";
import { PaymentRuntime } from "./paymentRuntime";
import { SandboxPaymentService } from "./sandboxPaymentService";
import type {
  ManagedPaymentBudget,
  ManagedPaymentPrincipal,
  PaymentServiceConfig,
  PaymentServiceDependencies,
  PaymentServiceResult,
  SandboxPaymentResult
} from "./paymentServiceTypes";

export {
  managedBeneficiary,
  playbackResponse
} from "./paymentServiceTypes";
export type {
  ManagedPaymentBudget,
  ManagedPaymentPrincipal,
  PaymentServiceConfig,
  PaymentServiceDependencies,
  PaymentServiceFailure,
  PaymentServiceResult,
  PaymentServiceSuccess,
  SandboxPaymentResult
} from "./paymentServiceTypes";

/**
 * Stable payment API used by the HTTP routes and application server.
 *
 * The facade owns dependency injection and delegates each workflow to a
 * focused component so challenge, sandbox, entitlement, and XRPL settlement
 * logic can be reused and tested independently.
 */
export class PaymentService {
  private readonly challenges: PaymentChallengeService;
  private readonly entitlements: ManagedEntitlementService;
  private readonly xrplSettlements: ManagedXrplSettlementService;
  private readonly sandbox: SandboxPaymentService;

  constructor(
    readonly config: PaymentServiceConfig,
    dependencies: PaymentServiceDependencies
  ) {
    const runtime = new PaymentRuntime(config, dependencies);
    this.challenges = new PaymentChallengeService(runtime);
    this.entitlements = new ManagedEntitlementService(runtime);
    this.xrplSettlements =
      new ManagedXrplSettlementService(
        runtime,
        this.challenges,
        this.entitlements
      );
    this.sandbox = new SandboxPaymentService(runtime);
  }

  managedBudget(
    principal: ManagedPaymentPrincipal
  ): Promise<ManagedPaymentBudget> {
    return this.entitlements.budget(principal);
  }

  getEntitlement(
    principal: ManagedPaymentPrincipal,
    titleId: string
  ) {
    return this.entitlements.get(principal, titleId);
  }

  currentSandboxSession(
    principal: Extract<
      PaymentPrincipal,
      { type: "sandbox" }
    >
  ) {
    return this.sandbox.currentSession(principal);
  }

  recordApprovalRequested(
    movie: Movie,
    challenge: PaymentChallenge,
    principal: ManagedPaymentPrincipal | undefined,
    correlationId: string
  ) {
    return this.challenges.recordApprovalRequested(
      movie,
      challenge,
      principal,
      correlationId
    );
  }

  createXrplChallenge(
    movie: Movie,
    payTo: string,
    invoiceId?: string
  ): Promise<PaymentChallenge> {
    return this.challenges.createXrplChallenge(
      movie,
      payTo,
      invoiceId
    );
  }

  async createChallenge(
    movie: Movie,
    principal?: PaymentPrincipal,
    correlationId?: string
  ): Promise<PaymentChallenge> {
    if (this.config.asset !== "XRP") {
      return this.challenges.createUsdcChallenge(movie);
    }

    const payTo =
      this.config.xrplMerchantAddress ||
      (this.config.backend === "sandbox"
        ? this.config.sandboxXrplAddress
        : undefined);
    if (!payTo) {
      throw new Error(
        "XRPL_MERCHANT_ADDRESS is required for direct XRPL payments."
      );
    }
    const invoice =
      this.config.backend === "xrpl" &&
      (principal?.type === "wallet" ||
        principal?.type === "guest")
        ? await this.xrplSettlements.createPurchaseInvoice(
            principal,
            movie,
            correlationId
          )
        : undefined;
    return this.challenges.createXrplChallenge(
      movie,
      payTo,
      invoice?.invoiceId
    );
  }

  prepareWalletPayment(
    transaction: Payment | undefined,
    requirements: PaymentRequirements | undefined,
    wallet: WalletSession,
    correlationId: string
  ): Promise<PaymentServiceResult<Payment>> {
    return this.challenges.prepareWalletPayment(
      transaction,
      requirements,
      wallet,
      correlationId
    );
  }

  recover(
    movie: Movie,
    transactionId: string,
    principal: ManagedPaymentPrincipal,
    correlationId: string
  ) {
    return this.xrplSettlements.recover(
      movie,
      transactionId,
      principal,
      correlationId
    );
  }

  settle(
    signature: string,
    movie: Movie,
    principal: ManagedPaymentPrincipal,
    correlationId: string
  ): Promise<PaymentServiceResult<Transaction>> {
    return this.xrplSettlements.settle(
      signature,
      movie,
      principal,
      correlationId
    );
  }

  resolveSandboxPayment(
    principal: Extract<
      PaymentPrincipal,
      { type: "sandbox" }
    >,
    movie: Movie
  ): Promise<PaymentServiceResult<SandboxPaymentResult>> {
    return this.sandbox.resolve(principal, movie);
  }

  reconcile(catalog: Movie[], correlationId: string) {
    return this.xrplSettlements.reconcile(
      catalog,
      correlationId
    );
  }
}
