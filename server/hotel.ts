// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { invoiceIdToInvoiceIdField } from "@x402/xrpl";
import type {
  EntitlementStore,
  HotelInvoiceRecord,
  HotelStayRecord
} from "./entitlementStore";
import type {
  HotelDashboard,
  HotelPurchase,
  Movie
} from "../src/types";

export const HOTEL_PROPERTY = {
  id: "ledger-lodge",
  name: "Ledger Lodge",
  tagline: "Check in. Chain out.",
  timeZone: "America/New_York"
} as const;

export const HOTEL_ROOM_NUMBERS = Array.from(
  { length: 400 },
  (_, index) => String(index + 101)
);

export const DEMO_ROOM_CREDENTIALS = new Map(
  HOTEL_ROOM_NUMBERS.map((roomNumber) => [
    roomNumber,
    roomNumber.padStart(4, "0")
  ])
);

const PRIVATE_MAPPING_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const MANAGED_PAYMENT_AUTHORIZATION_SECONDS = 5 * 60;

interface HotelDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function hotelDateParts(date: Date, timeZone: string): HotelDateParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return values as unknown as HotelDateParts;
}

function localTimeAsUtc(parts: HotelDateParts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

export function nextHotelCheckout(
  now = new Date(),
  timeZone = HOTEL_PROPERTY.timeZone
) {
  const localNow = hotelDateParts(now, timeZone);
  const followingDay = new Date(
    Date.UTC(localNow.year, localNow.month - 1, localNow.day + 1)
  );
  const desiredLocalTime = Date.UTC(
    followingDay.getUTCFullYear(),
    followingDay.getUTCMonth(),
    followingDay.getUTCDate(),
    11
  );
  let checkoutTime = desiredLocalTime;

  // Convert the hotel's wall-clock time to UTC. Iterating also handles
  // daylight-saving offset changes between check-in and checkout.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    checkoutTime +=
      desiredLocalTime -
      localTimeAsUtc(hotelDateParts(new Date(checkoutTime), timeZone));
  }

  return new Date(checkoutTime);
}

export function verifyDemoRoomPin(roomNumber: string, pin: string) {
  return DEMO_ROOM_CREDENTIALS.get(roomNumber.trim()) === pin.trim();
}

export function availableHotelRooms(occupiedRooms: Iterable<string>) {
  const occupied = new Set(occupiedRooms);
  return HOTEL_ROOM_NUMBERS.filter((roomNumber) => !occupied.has(roomNumber));
}

export function createHotelStay(
  beneficiaryId: string,
  beneficiaryType: "guest-session" | "wallet",
  network: string,
  roomNumber: string,
  now = new Date()
): HotelStayRecord {
  const linkedAt = now.toISOString();
  const checkoutAt = nextHotelCheckout(now).toISOString();
  return {
    propertyId: HOTEL_PROPERTY.id,
    propertyName: HOTEL_PROPERTY.name,
    roomNumber: roomNumber.trim(),
    stayRef: `stay_${crypto.randomUUID().replace(/-/g, "")}`,
    beneficiaryId,
    beneficiaryType,
    network,
    linkedAt,
    checkoutAt,
    expiresAt:
      Math.floor(now.getTime() / 1000) +
      PRIVATE_MAPPING_RETENTION_SECONDS
  };
}

export function activeHotelStay(
  stay: HotelStayRecord | undefined,
  now = new Date()
) {
  return stay && Date.parse(stay.checkoutAt) > now.getTime()
    ? stay
    : undefined;
}

export async function assignAvailableHotelRoom(
  store: EntitlementStore,
  beneficiaryId: string,
  beneficiaryType: "guest-session" | "wallet",
  network: string,
  now = new Date()
) {
  const existingStay = activeHotelStay(
    await store.getActiveHotelStay(beneficiaryId, network),
    now
  );
  if (existingStay) return existingStay;

  const occupiedRooms = await store.listOccupiedHotelRooms(
    HOTEL_PROPERTY.id,
    now
  );
  for (const roomNumber of availableHotelRooms(occupiedRooms)) {
    const stay = createHotelStay(
      beneficiaryId,
      beneficiaryType,
      network,
      roomNumber,
      now
    );
    if (await store.claimHotelStay(stay)) return stay;

    const concurrentlyAssignedStay = activeHotelStay(
      await store.getActiveHotelStay(beneficiaryId, network),
      now
    );
    if (concurrentlyAssignedStay) return concurrentlyAssignedStay;
  }

  return undefined;
}

export function createHotelInvoice(
  stay: HotelStayRecord,
  titleId: string,
  expectedPayerAddress: string,
  amount: string,
  now = new Date()
): HotelInvoiceRecord {
  const invoiceId = `ledger-lodge:v1:${stay.stayRef}:${titleId}`;
  const expiresAt = Math.min(
    Math.floor(Date.parse(stay.checkoutAt) / 1000),
    Math.floor(now.getTime() / 1000) +
      MANAGED_PAYMENT_AUTHORIZATION_SECONDS
  );
  return {
    ledgerInvoiceId: invoiceIdToInvoiceIdField(invoiceId),
    invoiceId,
    stayRef: stay.stayRef,
    titleId,
    beneficiaryId: stay.beneficiaryId,
    beneficiaryType: stay.beneficiaryType,
    expectedPayerAddress,
    paymentMode: "runtime-managed",
    amount,
    network: stay.network,
    channel: "agentcore",
    createdAt: now.toISOString(),
    expiresAt
  };
}

export function proofOfStayView(stay: HotelStayRecord) {
  return {
    propertyId: stay.propertyId,
    propertyName: stay.propertyName,
    roomNumber: stay.roomNumber,
    stayRef: stay.stayRef,
    linkedAt: stay.linkedAt,
    checkoutAt: stay.checkoutAt
  };
}

export function truncateWallet(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 7)}…${address.slice(-6)}`;
}

export function shortReference(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

export function xrplTimeToIso(value: unknown) {
  if (typeof value !== "number") return undefined;
  const xrplEpochMilliseconds = Date.UTC(2000, 0, 1);
  return new Date(xrplEpochMilliseconds + value * 1000).toISOString();
}

interface LedgerPayment {
  Account?: string;
  Amount?: string | object;
  Destination?: string;
  InvoiceID?: string;
  TransactionType?: string;
  hash?: string;
  date?: number;
  meta?: {
    TransactionResult?: string;
  };
}

interface AccountTransaction {
  hash?: string;
  close_time_iso?: string;
  validated?: boolean;
  tx?: LedgerPayment;
  tx_json?: LedgerPayment;
  meta?: { TransactionResult?: string } | string;
}

interface HotelDashboardOptions {
  store: EntitlementStore;
  catalog: Movie[];
  merchantAddress: string;
  network: string;
  networkLabel: string;
  rpc: <T>(
    network: string,
    method: string,
    parameters: Record<string, unknown>
  ) => Promise<T>;
}

export async function readHotelDashboard({
  store,
  catalog,
  merchantAddress,
  network,
  networkLabel,
  rpc
}: HotelDashboardOptions): Promise<HotelDashboard> {
  const result = await rpc<{
    transactions?: AccountTransaction[];
  }>(network, "account_tx", {
    account: merchantAddress,
    ledger_index_min: -1,
    ledger_index_max: -1,
    limit: 100,
    forward: false
  });

  const purchases = (
    await Promise.all(
      (result.transactions ?? []).map(
        async (entry): Promise<
          (HotelPurchase & { walletKey: string }) | undefined
        > => {
          const transaction = entry.tx_json ?? entry.tx;
          const ledgerInvoiceId =
            typeof transaction?.InvoiceID === "string"
              ? transaction.InvoiceID.toUpperCase()
              : undefined;
          const transactionResult =
            typeof entry.meta === "object"
              ? entry.meta.TransactionResult
              : transaction?.meta?.TransactionResult;
          if (
            !transaction ||
            entry.validated !== true ||
            transaction.TransactionType !== "Payment" ||
            transaction.Destination !== merchantAddress ||
            typeof transaction.Account !== "string" ||
            typeof transaction.Amount !== "string" ||
            !/^\d+$/.test(transaction.Amount) ||
            !ledgerInvoiceId ||
            transactionResult !== "tesSUCCESS"
          ) {
            return undefined;
          }
          const invoice = await store.getHotelInvoice(ledgerInvoiceId);
          if (
            !invoice ||
            invoice.expectedPayerAddress !== transaction.Account ||
            invoice.amount !== transaction.Amount
          ) {
            return undefined;
          }
          const stay = await store.getHotelStay(invoice.stayRef);
          const movie = catalog.find(
            (item) => item.id === invoice.titleId
          );
          if (!stay || !movie) return undefined;
          return {
            transactionId:
              entry.hash || transaction.hash || ledgerInvoiceId,
            invoiceId: shortReference(ledgerInvoiceId),
            roomNumber: stay.roomNumber,
            stayReference: shortReference(stay.stayRef),
            titleId: movie.id,
            title: movie.title,
            amount: Number(transaction.Amount) / 1_000_000,
            currency: "XRP",
            network: networkLabel,
            status: "settled",
            createdAt:
              entry.close_time_iso ||
              xrplTimeToIso(transaction.date) ||
              invoice.createdAt,
            walletDisplay: truncateWallet(transaction.Account),
            walletKey: transaction.Account,
            channel: invoice.channel
          };
        }
      )
    )
  )
    .filter(
      (
        purchase
      ): purchase is HotelPurchase & { walletKey: string } =>
        Boolean(purchase)
    )
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );

  const titleCounts = new Map<string, number>();
  for (const purchase of purchases) {
    titleCounts.set(
      purchase.title,
      (titleCounts.get(purchase.title) ?? 0) + 1
    );
  }
  const topTitle = [...titleCounts.entries()].sort(
    (left, right) => right[1] - left[1]
  )[0]?.[0];

  return {
    propertyId: HOTEL_PROPERTY.id,
    propertyName: HOTEL_PROPERTY.name,
    tagline: HOTEL_PROPERTY.tagline,
    generatedAt: new Date().toISOString(),
    source: "xrpl",
    merchantWalletDisplay: truncateWallet(merchantAddress),
    stats: {
      totalPurchases: purchases.length,
      revenue: Number(
        purchases
          .reduce((total, purchase) => total + purchase.amount, 0)
          .toFixed(2)
      ),
      occupiedRooms: new Set(
        purchases.map((purchase) => purchase.roomNumber)
      ).size,
      uniqueWallets: new Set(
        purchases.map((purchase) => purchase.walletKey)
      ).size,
      topTitle
    },
    purchases: purchases.map(
      ({ walletKey: _walletKey, ...purchase }) => purchase
    )
  };
}
