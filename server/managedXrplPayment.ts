// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { HotelInvoiceRecord } from "./entitlementStore";

export interface ManagedPaymentBeneficiary {
  id: string;
  type: "guest-session" | "wallet";
  network: string;
}

export type ManagedPaymentBindingError =
  | "runtime_payer_not_configured"
  | "runtime_payer_mismatch"
  | "managed_payment_authorization_mismatch";

/**
 * Runtime-managed XRPL payments have two identities by design:
 *
 * 1. The beneficiary is the guest session that receives playback access.
 * 2. The payer is the Runtime-controlled XRPL account that funds the purchase.
 *
 * Treating these identities as the same account recreates the broken
 * wallet_payment_mismatch path that followed removal of the browser wallet
 * adapter. This validator keeps the identities separate while binding both to
 * one short-lived invoice. The server must never grant an entitlement from a
 * payment that lacks this binding.
 */
export function validateManagedPaymentBinding(input: {
  beneficiary: ManagedPaymentBeneficiary;
  configuredPayerAddress?: string;
  signedPayerAddress: string;
  invoice?: HotelInvoiceRecord;
  titleId: string;
  amount: string;
  now?: number;
}): { error: ManagedPaymentBindingError; message: string } | undefined {
  if (!input.configuredPayerAddress) {
    return {
      error: "runtime_payer_not_configured",
      message:
        "XRPL_RUNTIME_PAYER_ADDRESS must identify the Runtime-managed payer."
    };
  }
  if (
    input.signedPayerAddress !== input.configuredPayerAddress
  ) {
    return {
      error: "runtime_payer_mismatch",
      message:
        "The signed XRPL account does not match the configured Runtime-managed payer."
    };
  }
  if (!input.invoice) {
    return {
      error: "managed_payment_authorization_mismatch",
      message:
        "The payment invoice does not authorize this Runtime payer to purchase this title for this guest."
    };
  }
  if (
    input.invoice.expectedPayerAddress !== input.configuredPayerAddress
  ) {
    return {
      error: "runtime_payer_mismatch",
      message:
        "The payment invoice does not name the configured Runtime-managed payer."
    };
  }
  if (
    input.invoice.paymentMode !== "runtime-managed" ||
    input.invoice.beneficiaryId !== input.beneficiary.id ||
    input.invoice.beneficiaryType !== input.beneficiary.type ||
    input.invoice.network !== input.beneficiary.network ||
    input.invoice.titleId !== input.titleId ||
    input.invoice.amount !== input.amount ||
    input.invoice.expiresAt <=
      (input.now ?? Math.floor(Date.now() / 1000))
  ) {
    return {
      error: "managed_payment_authorization_mismatch",
      message:
        "The payment invoice does not authorize this Runtime payer to purchase this title for this guest."
    };
  }
  return undefined;
}
