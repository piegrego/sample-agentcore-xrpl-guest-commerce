// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  inspectSettlement,
  type SettlementRecord,
  type XrplRpcClient
} from "../packages/agentcore-xrpl-settlement/src";
import type { EntitlementStore } from "./entitlementStore";

export interface ReconciliationResult {
  settlementId: string;
  status: "pending" | "granted" | "failed";
  reason?: string;
}

interface ReconcileSettlementBatchOptions {
  store: EntitlementStore;
  rpc: XrplRpcClient;
  grant(
    settlement: SettlementRecord,
    transactionId: string
  ): Promise<void>;
  limit?: number;
}

export async function reconcileSettlementBatch({
  store,
  rpc,
  grant,
  limit = 25
}: ReconcileSettlementBatchOptions): Promise<ReconciliationResult[]> {
  const pending = await store.listPendingSettlements(limit);
  return Promise.all(
    pending.map(async (settlement): Promise<ReconciliationResult> => {
      try {
        if (
          settlement.state === "VALIDATED" &&
          settlement.transactionId
        ) {
          await grant(settlement, settlement.transactionId);
          return {
            settlementId: settlement.settlementId,
            status: "granted"
          };
        }

        const inspection = await inspectSettlement(settlement, rpc);
        if (inspection.status === "pending") {
          return {
            settlementId: settlement.settlementId,
            status: "pending"
          };
        }
        if (inspection.status === "invalid") {
          const reason = inspection.errors?.join("; ") ||
            "Ledger invariants did not match.";
          await store.transitionSettlement(
            settlement.settlementId,
            "FAILED",
            { failureReason: reason }
          );
          return {
            settlementId: settlement.settlementId,
            status: "failed",
            reason
          };
        }

        const transactionId = (
          inspection.transaction?.hash ||
          settlement.transactionId
        )?.toUpperCase();
        if (!transactionId) {
          return {
            settlementId: settlement.settlementId,
            status: "pending"
          };
        }
        await store.transitionSettlement(
          settlement.settlementId,
          "VALIDATED",
          { transactionId }
        );
        await grant(
          {
            ...settlement,
            state: "VALIDATED",
            transactionId
          },
          transactionId
        );
        return {
          settlementId: settlement.settlementId,
          status: "granted"
        };
      } catch (error) {
        return {
          settlementId: settlement.settlementId,
          status: "pending",
          reason:
            error instanceof Error ? error.message : "Unknown error"
        };
      }
    })
  );
}
