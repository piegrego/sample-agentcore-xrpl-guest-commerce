// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { sign } from "ripple-keypairs";
import { Wallet } from "xrpl";
import { entitlementStore } from "../server/entitlementStore";
import { verifyWalletSignature } from "../server";

describe("wallet-owned entitlements", () => {
  test("verifies XRPL message signatures against the address", () => {
    const wallet = Wallet.generate();
    const otherWallet = Wallet.generate();
    const message = "Sign in to AgentCore XRPL Guest Commerce\nNonce: test";
    const signature = sign(
      Buffer.from(message, "utf8").toString("hex"),
      wallet.privateKey
    );

    expect(
      verifyWalletSignature(
        message,
        signature,
        wallet.publicKey,
        wallet.classicAddress
      )
    ).toBe(true);
    expect(
      verifyWalletSignature(
        message,
        signature,
        wallet.publicKey,
        otherWallet.classicAddress
      )
    ).toBe(false);
  });

  test("does not expose one wallet's entitlement to another wallet", async () => {
    const store = entitlementStore();
    const firstWallet = Wallet.generate().classicAddress;
    const secondWallet = Wallet.generate().classicAddress;
    const transactionId = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");

    await store.putEntitlement({
      beneficiaryId: firstWallet,
      beneficiaryType: "wallet",
      payerAddress: firstWallet,
      paymentMode: "consumer-wallet",
      network: "xrpl:1",
      titleId: "wild-signal",
      transactionId,
      amount: 0.2,
      currency: "XRP",
      createdAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });

    expect(
      await store.getEntitlement(
        firstWallet,
        "xrpl:1",
        "wild-signal"
      )
    ).toMatchObject({ transactionId });
    expect(
      await store.getEntitlement(
        secondWallet,
        "xrpl:1",
        "wild-signal"
      )
    ).toBeUndefined();
  });
});
