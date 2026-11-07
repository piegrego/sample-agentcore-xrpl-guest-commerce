// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { sign } from "ripple-keypairs";
import { Wallet } from "xrpl";
import { invoiceIdToInvoiceIdField } from "@x402/xrpl";
import { handleRequest } from "../server";
import {
  HOTEL_ROOM_NUMBERS,
  availableHotelRooms,
  createHotelInvoice,
  createHotelStay,
  activeHotelStay,
  nextHotelCheckout,
  readHotelDashboard,
  truncateWallet,
  verifyDemoRoomPin
} from "../server/hotel";
import { entitlementStore } from "../server/entitlementStore";
import { createCatalog } from "../server/catalog";
import { createTestXrplAddress } from "./fixtures";

async function connectWallet(wallet: Wallet) {
  const challengeResponse = await handleRequest(
    new Request("http://localhost/api/wallet/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: wallet.classicAddress,
        publicKey: wallet.publicKey
      })
    })
  );
  const challenge = await challengeResponse.json();
  const signature = sign(
    Buffer.from(challenge.message, "utf8").toString("hex"),
    wallet.privateKey
  );
  const verifyResponse = await handleRequest(
    new Request("http://localhost/api/wallet/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature
      })
    })
  );
  return verifyResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
}

describe("Ledger Lodge Proof of Stay", () => {
  test("provides exactly 400 hotel rooms", () => {
    expect(HOTEL_ROOM_NUMBERS).toHaveLength(400);
    expect(new Set(HOTEL_ROOM_NUMBERS).size).toBe(400);
    expect(HOTEL_ROOM_NUMBERS[0]).toBe("101");
    expect(HOTEL_ROOM_NUMBERS.at(-1)).toBe("500");
    expect(availableHotelRooms(HOTEL_ROOM_NUMBERS)).toEqual([]);
  });

  test("accepts only configured demo room and PIN pairs", () => {
    expect(verifyDemoRoomPin("402", "0402")).toBe(true);
    expect(verifyDemoRoomPin("402", "4040")).toBe(false);
    expect(verifyDemoRoomPin("999", "0402")).toBe(false);
  });

  test("checks out at 11 AM hotel time on the following day", () => {
    expect(
      nextHotelCheckout(
        new Date("2026-10-14T12:00:00.000Z")
      ).toISOString()
    ).toBe("2026-10-15T15:00:00.000Z");
  });

  test("keeps 11 AM checkout across daylight-saving changes", () => {
    expect(
      nextHotelCheckout(
        new Date("2026-10-31T16:00:00.000Z")
      ).toISOString()
    ).toBe("2026-11-01T16:00:00.000Z");
  });

  test("expires Proof of Stay at the scheduled checkout time", () => {
    const stay = createHotelStay(
      Wallet.generate().classicAddress,
      "wallet",
      "xrpl:1",
      "402",
      new Date("2026-10-14T12:00:00.000Z")
    );

    expect(
      activeHotelStay(stay, new Date("2026-10-15T14:59:59.999Z"))
    ).toBeDefined();
    expect(
      activeHotelStay(stay, new Date("2026-10-15T15:00:00.000Z"))
    ).toBeUndefined();
  });

  test("binds a title to an opaque XRPL invoice identifier", () => {
    const wallet = Wallet.generate();
    const stay = createHotelStay(
      wallet.classicAddress,
      "wallet",
      "xrpl:1",
      "402",
      new Date("2026-10-14T12:00:00.000Z")
    );
    const invoice = createHotelInvoice(
      stay,
      "afterlight",
      wallet.classicAddress,
      "650000",
      new Date("2026-10-14T12:01:00.000Z")
    );

    expect(invoice.invoiceId).toContain(stay.stayRef);
    expect(invoice.ledgerInvoiceId).toMatch(/^[A-F0-9]{64}$/);
    expect(invoice.ledgerInvoiceId).toBe(
      invoiceIdToInvoiceIdField(invoice.invoiceId)
    );
    expect(invoice.ledgerInvoiceId).not.toBe(invoice.invoiceId);
    expect(invoice.titleId).toBe("afterlight");
    expect(invoice.paymentMode).toBe("runtime-managed");
    expect(invoice.beneficiaryId).toBe(wallet.classicAddress);
    expect(invoice.expectedPayerAddress).toBe(wallet.classicAddress);
    expect(invoice.expiresAt).toBe(
      Math.floor(new Date("2026-10-14T12:01:00.000Z").getTime() / 1000) +
        5 * 60
    );
  });

  test("links a signed-in wallet to a room without returning its PIN", async () => {
    const wallet = Wallet.generate();
    const cookie = await connectWallet(wallet);
    const response = await handleRequest(
      new Request("http://localhost/api/hotel/stays/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({ roomNumber: "402", pin: "0402" })
      })
    );
    const session = await response.json();

    expect(response.status).toBe(200);
    expect(session.proofOfStay).toMatchObject({
      propertyId: "ledger-lodge",
      propertyName: "Ledger Lodge",
      roomNumber: "402"
    });
    expect(JSON.stringify(session)).not.toContain("0402");
    expect(session.walletAddress).toBe(wallet.classicAddress);

    await handleRequest(
      new Request("http://localhost/api/wallet/logout", {
        method: "POST",
        headers: { cookie }
      })
    );
  });

  test("lists available rooms without exposing their PINs", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/hotel/rooms/available")
    );
    const availability = await response.json();

    expect(response.status).toBe(200);
    expect(availability.totalRooms).toBe(400);
    expect(availability.availableRooms).toHaveLength(400);
    expect(availability.availableRooms).toContain("402");
    expect(JSON.stringify(availability)).not.toContain("0402");
  });

  test("creates a managed guest session for kiosk room assignment", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/hotel/check-in", {
        method: "POST"
      })
    );

    const session = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "agentcore_xrpl_guest_session"
    );
    expect(session.identityType).toBe("guest-session");
    expect(session.walletAddress).toBeUndefined();
    expect(session.proofOfStay?.roomNumber).toMatch(/^\d{3}$/);
  });

  test("requires an existing guest session before clearing a kiosk", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/wallet/handoff", {
        method: "POST"
      })
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe(
      "guest_session_required"
    );
  });

  test("atomically assigns one available room to a signed-in wallet", async () => {
    const wallet = Wallet.generate();
    const cookie = await connectWallet(wallet);
    const firstResponse = await handleRequest(
      new Request("http://localhost/api/hotel/check-in", {
        method: "POST",
        headers: { cookie }
      })
    );
    const firstSession = await firstResponse.json();
    const secondResponse = await handleRequest(
      new Request("http://localhost/api/hotel/check-in", {
        method: "POST",
        headers: { cookie }
      })
    );
    const secondSession = await secondResponse.json();
    const availabilityResponse = await handleRequest(
      new Request("http://localhost/api/hotel/rooms/available")
    );
    const availability = await availabilityResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstSession.proofOfStay.roomNumber).toMatch(/^\d{3}$/);
    expect(firstSession.proofOfStay.roomNumber).toBe(
      secondSession.proofOfStay.roomNumber
    );
    expect(firstSession.walletAddress).toBe(wallet.classicAddress);
    expect(JSON.stringify(firstSession)).not.toContain("pin");
    expect(availability.availableRooms).not.toContain(
      firstSession.proofOfStay.roomNumber
    );

    await handleRequest(
      new Request("http://localhost/api/wallet/logout", {
        method: "POST",
        headers: { cookie }
      })
    );
  });

  test("clears the kiosk device while preserving the room for TV login", async () => {
    const wallet = Wallet.generate();
    const kioskCookie = await connectWallet(wallet);
    const checkInResponse = await handleRequest(
      new Request("http://localhost/api/hotel/check-in", {
        method: "POST",
        headers: { cookie: kioskCookie }
      })
    );
    const checkedInSession = await checkInResponse.json();
    const handoffResponse = await handleRequest(
      new Request("http://localhost/api/wallet/handoff", {
        method: "POST",
        headers: { cookie: kioskCookie }
      })
    );
    const handoffSession = await handoffResponse.json();

    expect(handoffResponse.status).toBe(200);
    expect(handoffResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(handoffSession.authenticated).toBe(false);

    const tvCookie = await connectWallet(wallet);
    const tvResponse = await handleRequest(
      new Request("http://localhost/api/session", {
        headers: { cookie: tvCookie }
      })
    );
    const tvSession = await tvResponse.json();

    expect(tvSession.authenticated).toBe(true);
    expect(tvSession.walletAddress).toBe(wallet.classicAddress);
    expect(tvSession.proofOfStay).toMatchObject({
      roomNumber: checkedInSession.proofOfStay.roomNumber,
      stayRef: checkedInSession.proofOfStay.stayRef
    });

    await handleRequest(
      new Request("http://localhost/api/wallet/logout", {
        method: "POST",
        headers: { cookie: tvCookie }
      })
    );
  });

  test("requires a wallet to check out before checking into another room", async () => {
    const wallet = Wallet.generate();
    const cookie = await connectWallet(wallet);
    const firstResponse = await handleRequest(
      new Request("http://localhost/api/hotel/stays/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({ roomNumber: "401", pin: "0401" })
      })
    );
    const secondResponse = await handleRequest(
      new Request("http://localhost/api/hotel/stays/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({ roomNumber: "403", pin: "0403" })
      })
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect((await secondResponse.json()).error).toBe(
      "wallet_already_checked_in"
    );

    await handleRequest(
      new Request("http://localhost/api/wallet/logout", {
        method: "POST",
        headers: { cookie }
      })
    );
  });

  test("removes occupied rooms from availability and rejects a second guest", async () => {
    const firstWallet = Wallet.generate();
    const secondWallet = Wallet.generate();
    const firstCookie = await connectWallet(firstWallet);
    const secondCookie = await connectWallet(secondWallet);
    const linkResponse = await handleRequest(
      new Request("http://localhost/api/hotel/stays/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: firstCookie
        },
        body: JSON.stringify({ roomNumber: "405", pin: "0405" })
      })
    );
    const availabilityResponse = await handleRequest(
      new Request("http://localhost/api/hotel/rooms/available")
    );
    const availability = await availabilityResponse.json();
    const conflictResponse = await handleRequest(
      new Request("http://localhost/api/hotel/stays/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: secondCookie
        },
        body: JSON.stringify({ roomNumber: "405", pin: "0405" })
      })
    );

    expect(linkResponse.status).toBe(200);
    expect(availability.availableRooms).not.toContain("405");
    expect(conflictResponse.status).toBe(409);
    expect((await conflictResponse.json()).error).toBe(
      "hotel_room_unavailable"
    );

    for (const cookie of [firstCookie, secondCookie]) {
      await handleRequest(
        new Request("http://localhost/api/wallet/logout", {
          method: "POST",
          headers: { cookie }
        })
      );
    }
  });

  test("rejects an invalid room PIN", async () => {
    const wallet = Wallet.generate();
    const cookie = await connectWallet(wallet);
    const response = await handleRequest(
      new Request("http://localhost/api/hotel/stays/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({ roomNumber: "402", pin: "9999" })
      })
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe(
      "proof_of_stay_invalid"
    );
  });

  test("disconnects the active room so reconnect requests Proof of Stay again", async () => {
    const wallet = Wallet.generate();
    const firstCookie = await connectWallet(wallet);
    const linkResponse = await handleRequest(
      new Request("http://localhost/api/hotel/stays/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: firstCookie
        },
        body: JSON.stringify({ roomNumber: "402", pin: "0402" })
      })
    );
    const linkedSession = await linkResponse.json();

    const logoutResponse = await handleRequest(
      new Request("http://localhost/api/wallet/logout", {
        method: "POST",
        headers: { cookie: firstCookie }
      })
    );
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");

    const secondCookie = await connectWallet(wallet);
    const reconnectedResponse = await handleRequest(
      new Request("http://localhost/api/session", {
        headers: { cookie: secondCookie }
      })
    );
    const reconnectedSession = await reconnectedResponse.json();

    expect(reconnectedSession.authenticated).toBe(true);
    expect(reconnectedSession.walletAddress).toBe(wallet.classicAddress);
    expect(reconnectedSession.proofOfStay).toBeUndefined();
    expect(
      await entitlementStore().getHotelStay(linkedSession.proofOfStay.stayRef)
    ).toBeDefined();
  });

  test("truncates wallet identities for operator displays", () => {
    const address = createTestXrplAddress();
    expect(truncateWallet(address)).toBe(
      `${address.slice(0, 7)}…${address.slice(-6)}`
    );
  });

  test("joins validated ledger receipts to private room mappings", async () => {
    const store = entitlementStore();
    const wallet = Wallet.generate();
    const merchantAddress = createTestXrplAddress();
    const stay = createHotelStay(
      wallet.classicAddress,
      "wallet",
      "xrpl:1",
      "402"
    );
    const invoice = createHotelInvoice(
      stay,
      "afterlight",
      wallet.classicAddress,
      "650000"
    );
    expect(await store.claimHotelStay(stay)).toBe(true);
    await store.putHotelInvoice(invoice);

    const dashboard = await readHotelDashboard({
      store,
      catalog: createCatalog("XRP"),
      merchantAddress,
      network: "xrpl:1",
      networkLabel: "XRPL Testnet",
      rpc: async () =>
        ({
          transactions: [
            {
              hash: "A".repeat(64),
              validated: true,
              close_time_iso: "2026-10-14T12:00:00.000Z",
              tx_json: {
                TransactionType: "Payment",
                Account: wallet.classicAddress,
                Destination: merchantAddress,
                Amount: "650000",
                InvoiceID: invoice.ledgerInvoiceId
              },
              meta: { TransactionResult: "tesSUCCESS" }
            }
          ]
        }) as never
    });

    expect(dashboard.stats).toMatchObject({
      totalPurchases: 1,
      revenue: 0.65,
      occupiedRooms: 1,
      topTitle: "Afterlight"
    });
    expect(dashboard.purchases[0]).toMatchObject({
      roomNumber: "402",
      titleId: "afterlight",
      walletDisplay: truncateWallet(wallet.classicAddress)
    });
    expect(JSON.stringify(dashboard)).not.toContain(wallet.classicAddress);
  });
});
