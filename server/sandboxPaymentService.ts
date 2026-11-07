// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Movie, Transaction } from "../src/types";
import type { SandboxSession } from "./entitlementStore";
import {
  withPaymentLock,
  type PaymentPrincipal
} from "./paymentContext";
import { PaymentRuntime } from "./paymentRuntime";
import {
  MERCHANT_NAME,
  money,
  type PaymentServiceResult,
  type SandboxPaymentResult
} from "./paymentServiceTypes";

export class SandboxPaymentService {
  constructor(private readonly runtime: PaymentRuntime) {}

  async currentSession(
    principal: Extract<PaymentPrincipal, { type: "sandbox" }>
  ) {
    return (
      (await this.runtime.store.getSandboxSession(principal.id)) ??
      principal.session
    );
  }

  async resolve(
    principal: Extract<PaymentPrincipal, { type: "sandbox" }>,
    movie: Movie
  ): Promise<PaymentServiceResult<SandboxPaymentResult>> {
    return withPaymentLock(
      principal,
      this.runtime.store,
      async () => {
        const latest = await this.currentSession(principal);
        const remaining = money(latest.limit - latest.spent);
        if (movie.price > remaining) {
          return {
            ok: false,
            status: 409,
            body: {
              error: "payment_limit_exceeded",
              message: `This ${movie.price.toFixed(2)} ${this.runtime.config.asset} payment exceeds the session's ${remaining.toFixed(2)} ${this.runtime.config.asset} remaining budget.`
            },
            includeSession: true
          };
        }

        const proof =
          `x402_demo_${this.runtime.randomUuid()}`;
        const transactionId =
          `0x${this.runtime.randomUuid().replace(/-/g, "")}`;
        const transaction = this.recordTransaction(
          latest,
          movie,
          transactionId
        );
        latest.proofs[proof] = {
          titleId: movie.id,
          transactionId
        };
        await this.runtime.store.putSandboxSession(latest);
        return {
          ok: true,
          value: { proof, transaction, session: latest }
        };
      }
    );
  }

  private recordTransaction(
    session: SandboxSession,
    movie: Movie,
    transactionId: string
  ) {
    const existing = session.transactions.find(
      (transaction) => transaction.id === transactionId
    );
    if (existing) return existing;

    const transaction: Transaction = {
      id: transactionId,
      titleId: movie.id,
      merchant: MERCHANT_NAME,
      amount: movie.price,
      currency: this.runtime.config.asset,
      network:
        this.runtime.config.asset === "XRP"
          ? this.runtime.config.xrplNetwork
          : this.runtime.config.usdcNetwork,
      status: "settled",
      createdAt: this.runtime.now().toISOString()
    };
    session.spent = money(session.spent + movie.price);
    session.transactions.unshift(transaction);
    return transaction;
  }
}
