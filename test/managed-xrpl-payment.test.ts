// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { Wallet } from "xrpl";
import {
  createMemoryEntitlementStore,
  type HotelInvoiceRecord
} from "../server/entitlementStore";
import {
  createPaymentDelegation,
  resolvePaymentContext
} from "../server/paymentContext";
import { validateManagedPaymentBinding } from "../server/managedXrplPayment";

function invoice(input: {
  beneficiaryId: string;
  payerAddress: string;
}): HotelInvoiceRecord {
  return {
    ledgerInvoiceId: "A".repeat(64),
    invoiceId: "ledger-lodge:v1:stay_test:afterlight",
    stayRef: "stay_test",
    titleId: "afterlight",
    beneficiaryId: input.beneficiaryId,
    beneficiaryType: "guest-session",
    expectedPayerAddress: input.payerAddress,
    paymentMode: "runtime-managed",
    amount: "650000",
    network: "xrpl:1",
    channel: "agentcore",
    createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + 600
  };
}

describe("Runtime-managed XRPL authorization", () => {
  test("applies injected network and session-limit settings", async () => {
    const store = createMemoryEntitlementStore();
    const guest = await resolvePaymentContext(
      new Request("https://example.com/api/session"),
      store,
      "managed",
      { xrplNetwork: "xrpl:2", sessionLimit: 3.5 }
    );
    const sandbox = await resolvePaymentContext(
      new Request("https://example.com/api/session"),
      store,
      "sandbox",
      { xrplNetwork: "xrpl:2", sessionLimit: 3.5 }
    );

    expect(
      guest.principal?.type === "guest"
        ? guest.principal.session.network
        : undefined
    ).toBe("xrpl:2");
    expect(
      sandbox.principal?.type === "sandbox"
        ? sandbox.principal.session.limit
        : undefined
    ).toBe(3.5);
  });

  test("restores one opaque guest beneficiary through payment delegation", async () => {
    const store = createMemoryEntitlementStore();
    const first = await resolvePaymentContext(
      new Request("https://example.com/api/session"),
      store,
      "managed"
    );
    expect(first.principal?.type).toBe("guest");
    expect(first.setCookie).toContain("agentcore_xrpl_guest_session");

    const delegation = await createPaymentDelegation(first.principal!, store);
    const delegated = await resolvePaymentContext(
      new Request("https://storefront.internal/stream", {
        headers: { "x-payment-delegation": delegation }
      }),
      store,
      "managed"
    );

    expect(delegated.principal).toEqual(first.principal);
  });

  test("accepts the configured Runtime payer for the bound guest invoice", () => {
    const payerAddress = Wallet.generate().classicAddress;
    const beneficiaryId = `guest_${crypto.randomUUID().replace(/-/g, "")}`;

    expect(
      validateManagedPaymentBinding({
        beneficiary: {
          id: beneficiaryId,
          type: "guest-session",
          network: "xrpl:1"
        },
        configuredPayerAddress: payerAddress,
        signedPayerAddress: payerAddress,
        invoice: invoice({ beneficiaryId, payerAddress }),
        titleId: "afterlight",
        amount: "650000"
      })
    ).toBeUndefined();
  });

  test("rejects a signer that is not the configured Runtime payer", () => {
    const payerAddress = Wallet.generate().classicAddress;
    const beneficiaryId = `guest_${crypto.randomUUID().replace(/-/g, "")}`;

    expect(
      validateManagedPaymentBinding({
        beneficiary: {
          id: beneficiaryId,
          type: "guest-session",
          network: "xrpl:1"
        },
        configuredPayerAddress: payerAddress,
        signedPayerAddress: Wallet.generate().classicAddress,
        invoice: invoice({ beneficiaryId, payerAddress }),
        titleId: "afterlight",
        amount: "650000"
      })
    ).toMatchObject({ error: "runtime_payer_mismatch" });
  });

  test("rejects a payment without a beneficiary invoice", () => {
    const payerAddress = Wallet.generate().classicAddress;
    const beneficiaryId = `guest_${crypto.randomUUID().replace(/-/g, "")}`;

    expect(
      validateManagedPaymentBinding({
        beneficiary: {
          id: beneficiaryId,
          type: "guest-session",
          network: "xrpl:1"
        },
        configuredPayerAddress: payerAddress,
        signedPayerAddress: payerAddress,
        titleId: "afterlight",
        amount: "650000"
      })
    ).toMatchObject({
      error: "managed_payment_authorization_mismatch"
    });
  });

  test("rejects a valid Runtime payment bound to another guest", () => {
    const payerAddress = Wallet.generate().classicAddress;
    const beneficiaryId = `guest_${crypto.randomUUID().replace(/-/g, "")}`;

    expect(
      validateManagedPaymentBinding({
        beneficiary: {
          id: beneficiaryId,
          type: "guest-session",
          network: "xrpl:1"
        },
        configuredPayerAddress: payerAddress,
        signedPayerAddress: payerAddress,
        invoice: invoice({
          beneficiaryId: `guest_${crypto.randomUUID().replace(/-/g, "")}`,
          payerAddress
        }),
        titleId: "afterlight",
        amount: "650000"
      })
    ).toMatchObject({
      error: "managed_payment_authorization_mismatch"
    });
  });

  test("rejects an expired managed-payment invoice", () => {
    const payerAddress = Wallet.generate().classicAddress;
    const beneficiaryId = `guest_${crypto.randomUUID().replace(/-/g, "")}`;
    const expiredInvoice = invoice({ beneficiaryId, payerAddress });
    expiredInvoice.expiresAt = 100;

    expect(
      validateManagedPaymentBinding({
        beneficiary: {
          id: beneficiaryId,
          type: "guest-session",
          network: "xrpl:1"
        },
        configuredPayerAddress: payerAddress,
        signedPayerAddress: payerAddress,
        invoice: expiredInvoice,
        titleId: "afterlight",
        amount: "650000",
        now: 101
      })
    ).toMatchObject({
      error: "managed_payment_authorization_mismatch"
    });
  });
});
