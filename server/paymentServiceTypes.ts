// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Network } from "@x402/core/types";
import type { XrplMerchantSettlement, XrplRpcClient } from "../packages/agentcore-xrpl-settlement/src";
import type {
  Movie,
  PaymentAsset,
  Transaction
} from "../src/types";
import type {
  EntitlementRecord,
  EntitlementStore,
  SandboxSession
} from "./entitlementStore";
import type {
  ManagedPaymentBeneficiary
} from "./managedXrplPayment";
import type { PaymentPrincipal } from "./paymentContext";
import type { PaymentEvent } from "./paymentTelemetry";

export const MERCHANT_NAME = "Ledger Lodge Media";

export type ManagedPaymentPrincipal = Extract<
  PaymentPrincipal,
  { type: "guest" | "wallet" }
>;

export interface PaymentServiceConfig {
  readonly backend: "sandbox" | "agentcore" | "xrpl";
  readonly asset: PaymentAsset;
  readonly xrplNetwork: Network;
  readonly xrplMerchantAddress?: string;
  readonly xrplRuntimePayerAddress?: string;
  readonly sandboxXrplAddress: string;
  readonly usdcNetwork: string;
  readonly usdcAsset: string;
  readonly usdcPayTo: string;
  readonly entitlementSeconds: number;
  readonly sessionLimit: number;
}

export interface PaymentServiceDependencies {
  readonly store: EntitlementStore;
  readonly settlementRpc: XrplRpcClient;
  readonly merchantFactory?: (
    network: Network
  ) => Promise<XrplMerchantSettlement>;
  readonly emitEvent?: (
    event: Omit<PaymentEvent, "timestamp">
  ) => void;
  readonly hashPrincipal?: (value: string) => Promise<string>;
  readonly now?: () => Date;
  readonly randomUuid?: () => string;
}

export interface PaymentServiceFailure {
  readonly ok: false;
  readonly status: number;
  readonly body: {
    readonly error: string;
    readonly message: string;
  };
  readonly includeSession?: boolean;
}

export interface PaymentServiceSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type PaymentServiceResult<T> =
  | PaymentServiceSuccess<T>
  | PaymentServiceFailure;

export interface ManagedPaymentBudget {
  readonly records: EntitlementRecord[];
  readonly spent: number;
  readonly remaining: number;
}

export interface SandboxPaymentResult {
  readonly proof: string;
  readonly transaction: Transaction;
  readonly session: SandboxSession;
}

export function managedBeneficiary(
  principal: ManagedPaymentPrincipal
): ManagedPaymentBeneficiary {
  return principal.type === "wallet"
    ? {
        id: principal.session.address,
        type: "wallet",
        network: principal.session.network
      }
    : {
        id: principal.session.beneficiaryId,
        type: "guest-session",
        network: principal.session.network
      };
}

export function playbackResponse(
  movie: Movie,
  transactionId: string
) {
  return {
    access: "granted" as const,
    title: movie,
    entitlement: {
      id: `ent_${transactionId.slice(-8)}`,
      expiresIn: "47h 59m",
      transactionId
    },
    playback: {
      type: "demo" as const,
      manifest: `agentcore-xrpl-demo://stream/${movie.id}`,
      message: "Playback entitlement verified"
    }
  };
}

export const money = (value: number) =>
  Number(value.toFixed(2));
