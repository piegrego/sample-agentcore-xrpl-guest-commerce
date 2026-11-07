// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Wallet } from "xrpl";
import type {
  SettlementRecord,
  XrplRpcClient
} from "../packages/agentcore-xrpl-settlement/src";
import {
  createMemoryEntitlementStore,
  type EntitlementRecord
} from "../server/entitlementStore";
import { reconcileSettlementBatch } from "../server/reconciliation";

function fixture() {
  const now = new Date();
  const transactionId = randomBytes(32).toString("hex").toUpperCase();
  const amount = String(randomInt(1, 1_000_000));
  const settlement: SettlementRecord = {
    settlementId: `xrpl:1:${randomUUID()}`,
    state: "CHALLENGED",
    network: "xrpl:1",
    resourceId: randomUUID(),
    payer: Wallet.generate().classicAddress,
    destination: Wallet.generate().classicAddress,
    amount,
    asset: "XRP",
    invoiceId: randomBytes(32).toString("hex").toUpperCase(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + randomInt(60, 600)
  };
  const entitlement: EntitlementRecord = {
    beneficiaryId: randomUUID(),
    beneficiaryType: "guest-session",
    payerAddress: settlement.payer,
    paymentMode: "runtime-managed",
    network: settlement.network,
    titleId: settlement.resourceId,
    transactionId,
    amount: Number(amount) / 1_000_000,
    currency: "XRP",
    createdAt: now.toISOString(),
    expiresAt: settlement.expiresAt,
    ledgerInvoiceId: settlement.invoiceId
  };
  return { entitlement, settlement, transactionId };
}

describe("durable XRPL settlement store", () => {
  test("grants an entitlement and advances its settlement atomically", async () => {
    const { entitlement, settlement, transactionId } = fixture();
    const store = createMemoryEntitlementStore();
    await store.ensureSettlement(settlement);
    await store.transitionSettlement(
      settlement.settlementId,
      "SIGNED",
      { transactionId }
    );
    await store.transitionSettlement(
      settlement.settlementId,
      "SUBMITTED"
    );
    await store.transitionSettlement(
      settlement.settlementId,
      "VALIDATED"
    );

    await store.putEntitlement(
      entitlement,
      settlement.settlementId
    );
    await store.putEntitlement(
      entitlement,
      settlement.settlementId
    );

    expect(
      await store.getEntitlement(
        entitlement.beneficiaryId,
        entitlement.network,
        entitlement.titleId
      )
    ).toEqual(entitlement);
    expect(
      await store.getSettlement(settlement.settlementId)
    ).toMatchObject({
      state: "GRANTED",
      transactionId
    });
  });

  test("rejects reuse of a transaction for another grant", async () => {
    const { entitlement } = fixture();
    const store = createMemoryEntitlementStore();
    await store.putEntitlement(entitlement);

    expect(
      store.putEntitlement({
        ...entitlement,
        titleId: randomUUID()
      })
    ).rejects.toThrow("already been claimed");
  });

  test("reconciles a submitted ledger transaction into one grant", async () => {
    const { entitlement, settlement, transactionId } = fixture();
    const store = createMemoryEntitlementStore();
    await store.ensureSettlement({
      ...settlement,
      state: "SUBMITTED",
      transactionId
    });
    const rpc: XrplRpcClient = {
      async request<T>() {
        return {
          TransactionType: "Payment",
          Account: settlement.payer,
          Destination: settlement.destination,
          Amount: settlement.amount,
          InvoiceID: settlement.invoiceId,
          hash: transactionId,
          validated: true,
          meta: { TransactionResult: "tesSUCCESS" }
        } as T;
      }
    };

    const results = await reconcileSettlementBatch({
      store,
      rpc,
      async grant(record, reconciledTransactionId) {
        await store.putEntitlement(
          {
            ...entitlement,
            transactionId: reconciledTransactionId
          },
          record.settlementId
        );
      }
    });

    expect(results).toEqual([
      {
        settlementId: settlement.settlementId,
        status: "granted"
      }
    ]);
    expect(
      await store.getSettlement(settlement.settlementId)
    ).toMatchObject({
      state: "GRANTED"
    });
  });

  test("marks a validated transaction with mismatched invariants as failed", async () => {
    const { settlement, transactionId } = fixture();
    const store = createMemoryEntitlementStore();
    await store.ensureSettlement({
      ...settlement,
      state: "SUBMITTED",
      transactionId
    });
    const rpc: XrplRpcClient = {
      async request<T>() {
        return {
          TransactionType: "Payment",
          Account: settlement.payer,
          Destination: settlement.destination,
          Amount: String(BigInt(settlement.amount) + 1n),
          InvoiceID: settlement.invoiceId,
          hash: transactionId,
          validated: true,
          meta: { TransactionResult: "tesSUCCESS" }
        } as T;
      }
    };

    const results = await reconcileSettlementBatch({
      store,
      rpc,
      async grant() {
        throw new Error("Invalid settlements must not grant.");
      }
    });

    expect(results[0]).toMatchObject({
      status: "failed",
      reason: "amount does not match"
    });
    expect(
      await store.getSettlement(settlement.settlementId)
    ).toMatchObject({
      state: "FAILED",
      failureReason: "amount does not match"
    });
  });
});
