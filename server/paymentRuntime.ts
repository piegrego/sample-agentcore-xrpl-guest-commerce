// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Network } from "@x402/core/types";
import { XrplMerchantSettlement } from "../packages/agentcore-xrpl-settlement/src";
import type { HotelInvoiceRecord } from "./entitlementStore";
import {
  emitPaymentEvent,
  principalHash
} from "./paymentTelemetry";
import type {
  PaymentServiceConfig,
  PaymentServiceDependencies
} from "./paymentServiceTypes";

export class PaymentRuntime {
  private merchantPromise?: Promise<XrplMerchantSettlement>;
  readonly store;
  readonly settlementRpc;
  readonly emitEvent: NonNullable<
    PaymentServiceDependencies["emitEvent"]
  >;
  readonly hashPrincipal: NonNullable<
    PaymentServiceDependencies["hashPrincipal"]
  >;
  readonly now: NonNullable<PaymentServiceDependencies["now"]>;
  readonly randomUuid: NonNullable<
    PaymentServiceDependencies["randomUuid"]
  >;

  constructor(
    readonly config: PaymentServiceConfig,
    dependencies: PaymentServiceDependencies
  ) {
    this.store = dependencies.store;
    this.settlementRpc = dependencies.settlementRpc;
    this.emitEvent = dependencies.emitEvent ?? emitPaymentEvent;
    this.hashPrincipal =
      dependencies.hashPrincipal ?? principalHash;
    this.now = dependencies.now ?? (() => new Date());
    this.randomUuid =
      dependencies.randomUuid ?? (() => crypto.randomUUID());
    this.merchantFactory =
      dependencies.merchantFactory ??
      ((network: Network) =>
        XrplMerchantSettlement.create(network));
  }

  private readonly merchantFactory: (
    network: Network
  ) => Promise<XrplMerchantSettlement>;

  merchant() {
    if (!this.merchantPromise) {
      this.merchantPromise = this.merchantFactory(
        this.config.xrplNetwork
      );
    }
    return this.merchantPromise;
  }

  settlementIdForInvoice(invoice: HotelInvoiceRecord) {
    return `${invoice.network}:${invoice.ledgerInvoiceId}`;
  }
}
