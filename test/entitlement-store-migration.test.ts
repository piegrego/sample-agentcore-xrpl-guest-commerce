// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import {
  DeleteCommand,
  GetCommand,
  type DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";
import {
  createDynamoEntitlementStore,
  type EntitlementRecord
} from "../server/entitlementStore";

interface CommandInput {
  Key?: { pk?: string; sk?: string };
  ExpressionAttributeValues?: Record<string, unknown>;
}

interface FakeCommand {
  input: CommandInput;
}

function fakeDocumentClient(
  send: (command: FakeCommand) => Promise<Record<string, unknown>>
) {
  return { send } as unknown as DynamoDBDocumentClient;
}

describe("entitlement store schema migration", () => {
  test("reads and normalizes a legacy wallet entitlement", async () => {
    const walletAddress = "rLegacyWallet";
    const legacyItem = {
      walletAddress,
      network: "xrpl:1",
      titleId: "afterlight",
      transactionId: "A".repeat(64),
      amount: 0.65,
      currency: "XRP",
      createdAt: "2026-11-05T12:00:00.000Z",
      expiresAt: 1_800_000_000
    };
    const requestedKeys: string[] = [];
    const client = fakeDocumentClient(async (command) => {
      const pk = command.input.Key?.pk ?? "";
      requestedKeys.push(pk);
      return pk.startsWith("WALLET#") ? { Item: legacyItem } : {};
    });
    const store = createDynamoEntitlementStore("table", client);

    expect(
      await store.getEntitlement(walletAddress, "xrpl:1", "afterlight")
    ).toMatchObject({
      beneficiaryId: walletAddress,
      beneficiaryType: "wallet",
      payerAddress: walletAddress,
      paymentMode: "consumer-wallet",
      transactionId: legacyItem.transactionId
    });
    expect(requestedKeys).toEqual([
      `BENEFICIARY#xrpl:1#${walletAddress}`,
      `WALLET#xrpl:1#${walletAddress}`
    ]);
  });

  test("merges legacy and current entitlements with current records winning", async () => {
    const walletAddress = "rLegacyWallet";
    const legacy = {
      walletAddress,
      network: "xrpl:1",
      titleId: "afterlight",
      transactionId: "A".repeat(64),
      amount: 0.65,
      currency: "XRP",
      createdAt: "2026-11-05T12:00:00.000Z",
      expiresAt: 1_800_000_000
    };
    const current: EntitlementRecord = {
      beneficiaryId: walletAddress,
      beneficiaryType: "wallet",
      payerAddress: "rRuntimePayer",
      paymentMode: "runtime-managed",
      network: "xrpl:1",
      titleId: "afterlight",
      transactionId: "B".repeat(64),
      amount: 0.65,
      currency: "XRP",
      createdAt: "2026-11-05T13:00:00.000Z",
      expiresAt: 1_800_000_000
    };
    const client = fakeDocumentClient(async (command) => {
      const pk = String(command.input.ExpressionAttributeValues?.[":pk"]);
      return pk.startsWith("BENEFICIARY#")
        ? { Items: [current] }
        : { Items: [legacy] };
    });
    const store = createDynamoEntitlementStore("table", client);

    expect(await store.listEntitlements(walletAddress, "xrpl:1")).toEqual([
      current
    ]);
  });

  test("finds and clears a legacy active hotel stay", async () => {
    const walletAddress = "rLegacyWallet";
    const legacyStay = {
      propertyId: "ledger-lodge",
      propertyName: "Ledger Lodge",
      roomNumber: "402",
      stayRef: "stay_legacy",
      walletAddress,
      network: "xrpl:1",
      linkedAt: "2026-11-05T12:00:00.000Z",
      checkoutAt: "2026-11-06T16:00:00.000Z",
      expiresAt: 1_800_000_000
    };
    const deletedKeys: string[] = [];
    const client = fakeDocumentClient(async (command) => {
      const pk = command.input.Key?.pk ?? "";
      if (
        command instanceof GetCommand &&
        command.input.Key?.sk === "STAY#ACTIVE"
      ) {
        if (pk.startsWith("WALLET#")) return { Item: legacyStay };
        if (pk.startsWith("BENEFICIARY#")) return {};
      }
      if (command instanceof DeleteCommand && command.input.Key) {
        deletedKeys.push(pk);
      }
      return {};
    });
    const store = createDynamoEntitlementStore("table", client);

    expect(
      await store.getActiveHotelStay(walletAddress, "xrpl:1")
    ).toMatchObject({
      beneficiaryId: walletAddress,
      beneficiaryType: "wallet",
      stayRef: "stay_legacy"
    });
    await store.clearActiveHotelStay(walletAddress, "xrpl:1");
    expect(deletedKeys).toContain(`WALLET#xrpl:1#${walletAddress}`);
    expect(deletedKeys).toContain("HOTEL#ledger-lodge");
  });
});
