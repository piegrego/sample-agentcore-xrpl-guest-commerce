// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Movie, Transaction } from "../src/types";
import type {
  EntitlementRecord,
  HotelInvoiceRecord
} from "./entitlementStore";
import type {
  ManagedPaymentBeneficiary
} from "./managedXrplPayment";
import { epochSeconds } from "./paymentContext";
import { PaymentRuntime } from "./paymentRuntime";
import {
  MERCHANT_NAME,
  managedBeneficiary,
  money,
  type ManagedPaymentBudget,
  type ManagedPaymentPrincipal
} from "./paymentServiceTypes";

export class ManagedEntitlementService {
  constructor(private readonly runtime: PaymentRuntime) {}

  async budget(
    principal: ManagedPaymentPrincipal
  ): Promise<ManagedPaymentBudget> {
    const beneficiary = managedBeneficiary(principal);
    const records = (
      await this.runtime.store.listEntitlements(
        beneficiary.id,
        beneficiary.network
      )
    ).filter(
      (entitlement) => entitlement.expiresAt > epochSeconds()
    );
    const spent = money(
      records.reduce(
        (total, entitlement) => total + entitlement.amount,
        0
      )
    );
    return {
      records,
      spent,
      remaining: money(
        this.runtime.config.sessionLimit - spent
      )
    };
  }

  async get(
    principal: ManagedPaymentPrincipal,
    titleId: string
  ) {
    const beneficiary = managedBeneficiary(principal);
    return this.runtime.store.getEntitlement(
      beneficiary.id,
      beneficiary.network,
      titleId
    );
  }

  transaction(
    movie: Movie,
    entitlement: EntitlementRecord
  ): Transaction {
    return {
      id: entitlement.transactionId,
      titleId: movie.id,
      merchant: MERCHANT_NAME,
      amount: entitlement.amount,
      currency: entitlement.currency,
      network: entitlement.network,
      status: "settled",
      createdAt: entitlement.createdAt
    };
  }

  async persist(
    movie: Movie,
    transactionId: string,
    beneficiary: ManagedPaymentBeneficiary,
    payerAddress: string,
    invoice?: HotelInvoiceRecord,
    createdAt = this.runtime.now().toISOString(),
    settlementId?: string,
    correlationId?: string
  ) {
    const entitlement: EntitlementRecord = {
      beneficiaryId: beneficiary.id,
      beneficiaryType: beneficiary.type,
      payerAddress,
      paymentMode: "runtime-managed",
      network: beneficiary.network,
      titleId: movie.id,
      transactionId: transactionId.toUpperCase(),
      amount: movie.price,
      currency: this.runtime.config.asset,
      createdAt,
      expiresAt:
        epochSeconds() +
        this.runtime.config.entitlementSeconds,
      stayRef: invoice?.stayRef,
      ledgerInvoiceId: invoice?.ledgerInvoiceId
    };
    await this.runtime.store.putEntitlement(
      entitlement,
      settlementId
    );
    if (settlementId && correlationId) {
      this.runtime.emitEvent({
        event: "payment.grant.created",
        correlationId,
        settlementId,
        transactionId: entitlement.transactionId,
        principalHash:
          await this.runtime.hashPrincipal(beneficiary.id),
        network: beneficiary.network,
        resourceId: movie.id,
        amount: String(Math.round(movie.price * 1_000_000)),
        state: "GRANTED"
      });
    }
    return this.transaction(movie, entitlement);
  }
}
