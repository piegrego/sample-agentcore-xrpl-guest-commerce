// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { App } from "aws-cdk-lib";
import {
  assertRuntimePayerAddress,
  xrpAtomicPaymentLimit,
  xrplHttpEndpoint
} from "../agent/src/index";
import { loadConfiguration } from "../infra/cdk/lib/config";
import {
  createSettledPlaybackResponse,
  createXrplPaymentChallenge
} from "../server";
import { signedXrplTransactionHash } from "../packages/agentcore-xrpl-settlement/src/hash";
import { BrowserExactXrplScheme } from "../src/lib/browserXrplScheme";
import type { Movie } from "../src/types";
import { invoiceIdToInvoiceIdField } from "@x402/xrpl";
import { Wallet } from "xrpl";
import {
  createTestAccountId,
  createTestCommitSha,
  createTestSecretArn,
  createTestXrplAddress
} from "./fixtures";
import {
  paymentNetworkLabel,
  SANDBOX_USDC_PAY_TO,
  resolveUsdcPayTo
} from "../shared/paymentConfiguration";

const movie: Movie = {
  id: "afterlight",
  title: "Afterlight",
  tagline: "Some signals arrive too late.",
  year: 2026,
  rating: "PG-13",
  runtime: "1h 47m",
  genre: "Sci-fi drama",
  price: 0.65,
  currency: "XRP",
  accent: "violet",
  description: "Test title"
};

describe("XRPL payment configuration", () => {
  test("converts the Runtime XRP cap to drops", () => {
    expect(xrpAtomicPaymentLimit(0.65)).toBe("650000");
    expect(xrpAtomicPaymentLimit(2)).toBe("2000000");
  });

  test("requires the Runtime secret to match the configured payer", () => {
    const configured = createTestXrplAddress();
    expect(() =>
      assertRuntimePayerAddress(configured, configured)
    ).not.toThrow();
    expect(() =>
      assertRuntimePayerAddress(createTestXrplAddress(), configured)
    ).toThrow("does not match XRPL_RUNTIME_PAYER_ADDRESS");
  });

  test("uses the XRPL Testnet HTTP endpoint for Runtime preparation", () => {
    expect(xrplHttpEndpoint("xrpl:1")).toBe(
      "https://s.altnet.rippletest.net:51234/"
    );
  });

  test("calculates a browser-compatible XRPL signed transaction hash", async () => {
    const wallet = Wallet.generate();
    const signed = wallet.sign({
      TransactionType: "Payment",
      Account: wallet.classicAddress,
      Destination: Wallet.generate().classicAddress,
      Amount: "1",
      Fee: "10",
      Sequence: 1,
      LastLedgerSequence: 100
    });

    expect(await signedXrplTransactionHash(signed.tx_blob)).toBe(signed.hash);
  });

  test("creates invoice-bound XRPL payloads without Node crypto", async () => {
    const wallet = Wallet.generate();
    const invoiceId = "ledger-lodge:v1:browser-payment:afterlight";
    let transactionToSign: Record<string, unknown> | undefined;
    const scheme = new BrowserExactXrplScheme(
      {
        classicAddress: wallet.classicAddress,
        sign(transaction) {
          transactionToSign = transaction;
          return { signedTxBlob: "ABCD" };
        }
      },
      async (transaction) => ({
        ...transaction,
        Fee: "12",
        Sequence: 7,
        LastLedgerSequence: 12345
      })
    );

    const payload = await scheme.createPaymentPayload(2, {
      scheme: "exact",
      network: "xrpl:1",
      asset: "XRP",
      amount: "650000",
      payTo: Wallet.generate().classicAddress,
      maxTimeoutSeconds: 60,
      extra: {
        areFeesSponsored: false,
        invoiceId
      }
    });

    expect(payload).toEqual({
      x402Version: 2,
      payload: { signedTxBlob: "ABCD" }
    });
    expect(transactionToSign?.InvoiceID).toBe(
      invoiceIdToInvoiceIdField(invoiceId)
    );
  });

  test("returns settled playback without the rejected payment-response header", async () => {
    const response = createSettledPlaybackResponse(
      movie,
      "A".repeat(64)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/json"
    );
    expect(response.headers.get("payment-response")).toBeNull();
    expect(await response.json()).toMatchObject({
      access: "granted",
      entitlement: {
        transactionId: "A".repeat(64)
      }
    });
  });

  test("builds an official x402 XRP requirement in drops", async () => {
    const merchantAddress = createTestXrplAddress();
    const challenge = await createXrplPaymentChallenge(
      movie,
      merchantAddress
    );

    expect(challenge.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "xrpl:1",
      asset: "XRP",
      amount: "650000",
      extra: {
        areFeesSponsored: false
      }
    });
  });

  test("binds the x402 payment to an opaque hotel invoice", async () => {
    const merchantAddress = createTestXrplAddress();
    const challenge = await createXrplPaymentChallenge(
      movie,
      merchantAddress,
      "ledger-lodge:v1:stay_example:afterlight"
    );

    expect(challenge.accepts[0].extra).toMatchObject({
      areFeesSponsored: false,
      invoiceId: "ledger-lodge:v1:stay_example:afterlight"
    });
  });

  test("requires a merchant and Secrets Manager wallet for live XRPL", () => {
    const app = new App({
      context: {
        paymentBackend: "xrpl",
        paymentAsset: "XRP"
      }
    });

    expect(() => loadConfiguration(app)).toThrow(
      'CDK context "xrplMerchantAddress" is required'
    );
  });

  test("requires an explicit recipient for live AgentCore USDC", () => {
    const app = new App({
      context: {
        enablePayments: true,
        paymentBackend: "agentcore",
        paymentAsset: "USDC"
      }
    });

    expect(() => loadConfiguration(app)).toThrow(
      'CDK context "usdcPayTo" is required'
    );
  });

  test("fails fast in live runtime mode and uses a full sandbox recipient", () => {
    expect(() =>
      resolveUsdcPayTo("agentcore", "USDC")
    ).toThrow("USDC_PAY_TO is required");
    expect(resolveUsdcPayTo("sandbox", "USDC")).toBe(
      SANDBOX_USDC_PAY_TO
    );
    expect(SANDBOX_USDC_PAY_TO).toMatch(/^0x[0-9a-f]{40}$/i);
  });

  test("accepts configurable live USDC payment settings", () => {
    const usdcPayTo =
      "0x2222222222222222222222222222222222222222";
    const app = new App({
      context: {
        enablePayments: true,
        paymentBackend: "agentcore",
        paymentAsset: "USDC",
        paymentMaxAmount: "1.25",
        paymentSessionLimit: "3.5",
        usdcNetwork: "eip155:84532",
        usdcAsset:
          "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        usdcPayTo,
        xrplMaxFeeDrops: "1500",
        xrplReconciliationIntervalSeconds: "45"
      }
    });

    expect(loadConfiguration(app)).toMatchObject({
      paymentMaxAmount: "1.25",
      paymentSessionLimit: "3.5",
      usdcNetwork: "eip155:84532",
      usdcPayTo,
      xrplMaxFeeDrops: "1500",
      xrplReconciliationIntervalSeconds: 45
    });
  });

  test("labels configured payment networks without assuming Base Sepolia", () => {
    expect(
      paymentNetworkLabel("USDC", "xrpl:1", "eip155:84532")
    ).toBe("Base Sepolia");
    expect(
      paymentNetworkLabel("USDC", "xrpl:1", "eip155:8453")
    ).toBe("Base");
    expect(
      paymentNetworkLabel("USDC", "xrpl:1", "eip155:999999")
    ).toBe("eip155:999999");
    expect(
      paymentNetworkLabel("XRP", "xrpl:2", "eip155:84532")
    ).toBe("XRPL Devnet");
  });

  test("rejects truncated or zero USDC addresses", () => {
    for (const usdcPayTo of [
      "0x7A0d...91F2",
      "0x0000000000000000000000000000000000000000"
    ]) {
      const app = new App({
        context: {
          enablePayments: true,
          paymentBackend: "agentcore",
          paymentAsset: "USDC",
          usdcPayTo
        }
      });

      expect(() => loadConfiguration(app)).toThrow(
        'CDK context "usdcPayTo" must be a nonzero 20-byte EVM address'
      );
    }
  });

  test("requires an HTTPS endpoint for custom XRPL networks", () => {
    const account = createTestAccountId();
    const context = {
      paymentBackend: "xrpl",
      paymentAsset: "XRP",
      xrplNetwork: "xrpl:999",
      xrplMerchantAddress: createTestXrplAddress(),
      xrplRuntimePayerAddress: createTestXrplAddress(),
      xrplWalletSeedSecretArn: createTestSecretArn(account)
    };

    expect(() => loadConfiguration(new App({ context }))).toThrow(
      'CDK context "xrplHttpUrl" is required'
    );
    expect(
      loadConfiguration(
        new App({
          context: {
            ...context,
            xrplHttpUrl: "https://xrpl.example.test/"
          }
        })
      ).xrplHttpUrl
    ).toBe("https://xrpl.example.test/");
  });

  test("requires an explicit Runtime payer for live XRPL", () => {
    const account = createTestAccountId();
    const app = new App({
      context: {
        paymentBackend: "xrpl",
        paymentAsset: "XRP",
        xrplMerchantAddress: createTestXrplAddress(),
        xrplWalletSeedSecretArn: createTestSecretArn(account)
      }
    });

    expect(() => loadConfiguration(app)).toThrow(
      'CDK context "xrplRuntimePayerAddress" is required'
    );
  });

  test("accepts a complete live XRPL configuration", () => {
    const account = createTestAccountId();
    const sourceCommitSha = createTestCommitSha();
    const runtimePayerAddress = createTestXrplAddress();
    const app = new App({
      context: {
        paymentBackend: "xrpl",
        paymentAsset: "XRP",
        sourceCommitSha,
        xrplMerchantAddress: createTestXrplAddress(),
        xrplRuntimePayerAddress: runtimePayerAddress,
        xrplWalletSeedSecretArn: createTestSecretArn(account)
      }
    });

    expect(loadConfiguration(app)).toMatchObject({
      enablePayments: false,
      paymentBackend: "xrpl",
      paymentAsset: "XRP",
      xrplNetwork: "xrpl:1",
      xrplRuntimePayerAddress: runtimePayerAddress,
      sourceCommitSha
    });
  });

  test("rejects an invalid deployment provenance commit", () => {
    const app = new App({
      context: {
        sourceCommitSha: "not-a-git-commit"
      }
    });

    expect(() => loadConfiguration(app)).toThrow(
      'CDK context "sourceCommitSha" must be a 7-64 character hexadecimal Git commit SHA.'
    );
  });

  test("parses and deduplicates comma-separated IPv6 viewer CIDRs", () => {
    const app = new App({
      context: {
        allowedIpv6Cidrs:
          "2001:db8::/32, 2001:db8:1234::/48,2001:db8::/32"
      }
    });

    expect(loadConfiguration(app).allowedIpv6Cidrs).toEqual([
      "2001:db8::/32",
      "2001:db8:1234::/48"
    ]);
  });
});
