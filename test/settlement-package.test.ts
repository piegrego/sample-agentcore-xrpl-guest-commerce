// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { PaymentRequirements } from "@x402/core/types";
import type { ClientXrplSigner } from "@x402/xrpl";
import { Wallet, type Payment } from "xrpl";
import {
  createXrplPayer,
  inspectSettlement,
  prepareXrplPaymentTransaction,
  signedXrplTransactionHash,
  transitionSettlementRecord,
  validateXrplPayment,
  type SettlementRecord,
  type XrplRpcClient
} from "../packages/agentcore-xrpl-settlement/src";

function fixture() {
  const payer = Wallet.generate().classicAddress;
  const destination = Wallet.generate().classicAddress;
  const amount = String(randomInt(1, 1_000_000));
  const invoiceId = randomBytes(32).toString("hex").toUpperCase();
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: "xrpl:1",
    asset: "XRP",
    amount,
    payTo: destination,
    maxTimeoutSeconds: randomInt(30, 300),
    extra: {
      areFeesSponsored: false,
      invoiceId
    }
  };
  const transaction: Payment = {
    TransactionType: "Payment",
    Account: payer,
    Destination: destination,
    Amount: amount
  };
  return {
    amount,
    destination,
    invoiceId,
    payer,
    requirements,
    transaction
  };
}

function settlement(
  values: ReturnType<typeof fixture>,
  changes: Partial<SettlementRecord> = {}
): SettlementRecord {
  const now = new Date();
  return {
    settlementId: `xrpl:1:${randomUUID()}`,
    state: "CHALLENGED",
    network: "xrpl:1",
    resourceId: randomUUID(),
    payer: values.payer,
    destination: values.destination,
    amount: values.amount,
    asset: "XRP",
    invoiceId: values.invoiceId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + randomInt(60, 600),
    ...changes
  };
}

describe("agentcore XRPL settlement package", () => {
  test("rejects an invalid payer network or drop limit", () => {
    const values = fixture();
    const signer: ClientXrplSigner = {
      classicAddress: values.payer,
      async sign() {
        return { signedTxBlob: randomBytes(32).toString("hex") };
      }
    };
    expect(() =>
      createXrplPayer({
        network: "eip155:84532",
        signer,
        maxAmountPerPayment: values.amount,
        async preparePaymentTransaction(candidate) {
          return candidate;
        }
      })
    ).toThrow("requires an XRPL network");
    expect(() =>
      createXrplPayer({
        network: "xrpl:1",
        signer,
        maxAmountPerPayment: "0.65",
        async preparePaymentTransaction(candidate) {
          return candidate;
        }
      })
    ).toThrow("integer drops");
  });

  test("prepares a bounded transaction through an injected RPC client", async () => {
    const values = fixture();
    const calls: string[] = [];
    const sequence = randomInt(1, 100_000);
    const fee = randomInt(1, 100);
    const ledger = randomInt(1_000, 1_000_000);
    const rpc: XrplRpcClient = {
      async request<T>(
        _network: string,
        method: string,
        _parameters: Record<string, unknown>
      ) {
        calls.push(method);
        if (method === "account_info") {
          return { account_data: { Sequence: sequence } } as T;
        }
        if (method === "fee") {
          return { drops: { open_ledger_fee: String(fee) } } as T;
        }
        return { ledger_index: ledger } as T;
      }
    };

    const prepared = await prepareXrplPaymentTransaction(
      values.transaction,
      values.requirements,
      { rpc, feeLimitDrops: String(fee + 1) }
    );

    expect(new Set(calls)).toEqual(
      new Set(["account_info", "fee", "ledger"])
    );
    expect(prepared).toMatchObject({
      Sequence: sequence,
      Fee: String(fee)
    });
    expect(prepared.LastLedgerSequence).toBeGreaterThan(ledger);
  });

  test("rejects an unbounded network fee", async () => {
    const values = fixture();
    const feeLimit = randomInt(1, 1_000);
    const rpc: XrplRpcClient = {
      async request<T>(
        _network: string,
        method: string,
        _parameters: Record<string, unknown>
      ) {
        if (method === "account_info") {
          return { account_data: { Sequence: randomInt(1, 100_000) } } as T;
        }
        if (method === "fee") {
          return { drops: { open_ledger_fee: String(feeLimit + 1) } } as T;
        }
        return { ledger_index: randomInt(1_000, 1_000_000) } as T;
      }
    };

    expect(
      prepareXrplPaymentTransaction(values.transaction, values.requirements, {
        rpc,
        feeLimitDrops: String(feeLimit)
      })
    ).rejects.toThrow("exceeds the configured");
  });

  test("calculates the canonical transaction hash", async () => {
    const values = fixture();
    const wallet = Wallet.generate();
    const signed = wallet.sign({
      ...values.transaction,
      Account: wallet.classicAddress,
      Sequence: randomInt(1, 100_000),
      Fee: String(randomInt(1, 100)),
      LastLedgerSequence: randomInt(100_001, 1_000_000)
    });

    expect(await signedXrplTransactionHash(signed.tx_blob)).toBe(
      signed.hash
    );
  });

  test("enforces forward settlement transitions", () => {
    const values = fixture();
    const signed = transitionSettlementRecord(
      settlement(values),
      "SIGNED",
      { transactionId: randomBytes(32).toString("hex").toUpperCase() }
    );
    const submitted = transitionSettlementRecord(signed, "SUBMITTED");
    const validated = transitionSettlementRecord(submitted, "VALIDATED");
    const granted = transitionSettlementRecord(validated, "GRANTED");

    expect(granted.state).toBe("GRANTED");
    expect(() =>
      transitionSettlementRecord(granted, "SUBMITTED")
    ).toThrow("cannot transition");
  });

  test("reports every settlement invariant violation", () => {
    const values = fixture();
    expect(
      validateXrplPayment(
        {
          TransactionType: "Payment",
          Account: values.payer,
          Destination: values.destination,
          Amount: String(BigInt(values.amount) + 1n),
          validated: true,
          meta: { TransactionResult: "tesSUCCESS" },
          InvoiceID: randomBytes(32).toString("hex").toUpperCase()
        },
        {
          network: "xrpl:1",
          payer: values.payer,
          destination: values.destination,
          amount: values.amount,
          invoiceId: values.invoiceId
        }
      )
    ).toEqual(["amount does not match", "invoice does not match"]);
  });

  test("reconciliation validates a submitted transaction", async () => {
    const values = fixture();
    const transactionId = randomBytes(32).toString("hex").toUpperCase();
    const record = settlement(values, {
      state: "SUBMITTED",
      transactionId
    });
    const rpc: XrplRpcClient = {
      async request<T>() {
        return {
          TransactionType: "Payment",
          Account: values.payer,
          Destination: values.destination,
          Amount: values.amount,
          InvoiceID: values.invoiceId,
          hash: transactionId,
          validated: true,
          meta: { TransactionResult: "tesSUCCESS" }
        } as T;
      }
    };

    expect(await inspectSettlement(record, rpc)).toMatchObject({
      status: "validated"
    });
  });
});
