// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import {
  transitionSettlementRecord,
  type SettlementRecord,
  type SettlementState
} from "../packages/agentcore-xrpl-settlement/src";

export interface WalletChallenge {
  id: string;
  address: string;
  publicKey: string;
  network: string;
  message: string;
  expiresAt: number;
}

export interface WalletSession {
  tokenHash: string;
  address: string;
  network: string;
  expiresAt: number;
}

export interface GuestSession {
  tokenHash: string;
  beneficiaryId: string;
  network: string;
  expiresAt: number;
}

export interface SandboxSession {
  tokenHash: string;
  limit: number;
  spent: number;
  transactions: Array<{
    id: string;
    titleId: string;
    merchant: string;
    amount: number;
    currency: string;
    network: string;
    status: string;
    createdAt: string;
  }>;
  proofs: Record<string, { titleId: string; transactionId: string }>;
  expiresAt: number;
}

export interface PaymentDelegation {
  tokenHash: string;
  principalType: "wallet" | "guest" | "sandbox";
  principalId: string;
  expiresAt: number;
}

export interface EntitlementRecord {
  beneficiaryId: string;
  beneficiaryType: "guest-session" | "wallet";
  payerAddress: string;
  paymentMode: "runtime-managed" | "consumer-wallet";
  network: string;
  titleId: string;
  transactionId: string;
  amount: number;
  currency: string;
  createdAt: string;
  expiresAt: number;
  stayRef?: string;
  ledgerInvoiceId?: string;
}

export interface HotelStayRecord {
  propertyId: string;
  propertyName: string;
  roomNumber: string;
  stayRef: string;
  beneficiaryId: string;
  beneficiaryType: "guest-session" | "wallet";
  network: string;
  linkedAt: string;
  checkoutAt: string;
  expiresAt: number;
}

export interface HotelInvoiceRecord {
  ledgerInvoiceId: string;
  invoiceId: string;
  stayRef: string;
  titleId: string;
  beneficiaryId: string;
  beneficiaryType: "guest-session" | "wallet";
  expectedPayerAddress: string;
  paymentMode: "runtime-managed" | "consumer-wallet";
  amount: string;
  network: string;
  channel: "agentcore";
  createdAt: string;
  expiresAt: number;
}

export interface EntitlementStore {
  putChallenge(challenge: WalletChallenge): Promise<void>;
  consumeChallenge(id: string): Promise<WalletChallenge | undefined>;
  putSession(session: WalletSession): Promise<void>;
  getSession(tokenHash: string): Promise<WalletSession | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
  putGuestSession(session: GuestSession): Promise<void>;
  getGuestSession(tokenHash: string): Promise<GuestSession | undefined>;
  deleteGuestSession(tokenHash: string): Promise<void>;
  putSandboxSession(session: SandboxSession): Promise<void>;
  getSandboxSession(tokenHash: string): Promise<SandboxSession | undefined>;
  deleteSandboxSession(tokenHash: string): Promise<void>;
  putPaymentDelegation(delegation: PaymentDelegation): Promise<void>;
  getPaymentDelegation(tokenHash: string): Promise<PaymentDelegation | undefined>;
  acquirePaymentLock(
    principalId: string,
    owner: string,
    expiresAt: number
  ): Promise<boolean>;
  releasePaymentLock(principalId: string, owner: string): Promise<void>;
  getEntitlement(
    beneficiaryId: string,
    network: string,
    titleId: string
  ): Promise<EntitlementRecord | undefined>;
  listEntitlements(
    beneficiaryId: string,
    network: string
  ): Promise<EntitlementRecord[]>;
  putEntitlement(
    entitlement: EntitlementRecord,
    settlementId?: string
  ): Promise<void>;
  ensureSettlement(
    settlement: SettlementRecord
  ): Promise<SettlementRecord>;
  getSettlement(
    settlementId: string
  ): Promise<SettlementRecord | undefined>;
  transitionSettlement(
    settlementId: string,
    nextState: SettlementState,
    changes?: Partial<
      Pick<
        SettlementRecord,
        "transactionId" | "failureReason" | "expiresAt"
      >
    >
  ): Promise<SettlementRecord>;
  listPendingSettlements(limit?: number): Promise<SettlementRecord[]>;
  claimHotelStay(stay: HotelStayRecord): Promise<boolean>;
  listOccupiedHotelRooms(
    propertyId: string,
    now: Date
  ): Promise<string[]>;
  getActiveHotelStay(
    beneficiaryId: string,
    network: string
  ): Promise<HotelStayRecord | undefined>;
  clearActiveHotelStay(beneficiaryId: string, network: string): Promise<void>;
  getHotelStay(stayRef: string): Promise<HotelStayRecord | undefined>;
  putHotelInvoice(invoice: HotelInvoiceRecord): Promise<void>;
  getHotelInvoice(
    ledgerInvoiceId: string
  ): Promise<HotelInvoiceRecord | undefined>;
}

const beneficiaryKey = (beneficiaryId: string, network: string) =>
  `BENEFICIARY#${network}#${beneficiaryId}`;
const legacyWalletKey = (walletAddress: string, network: string) =>
  `WALLET#${network}#${walletAddress}`;
const hotelRoomKey = (propertyId: string, roomNumber: string) =>
  `${propertyId}#${roomNumber}`;
const settlementKey = (settlementId: string) =>
  `SETTLEMENT#${settlementId}`;
const SETTLEMENT_STATE_INDEX = "settlement-state-updated";

function normalizeEntitlementRecord(
  item: Record<string, unknown> | undefined
): EntitlementRecord | undefined {
  if (!item) return undefined;
  if (
    typeof item.beneficiaryId === "string" &&
    (item.beneficiaryType === "guest-session" ||
      item.beneficiaryType === "wallet")
  ) {
    return item as unknown as EntitlementRecord;
  }
  if (typeof item.walletAddress !== "string") return undefined;
  return {
    ...item,
    beneficiaryId: item.walletAddress,
    beneficiaryType: "wallet",
    payerAddress: item.walletAddress,
    paymentMode: "consumer-wallet"
  } as unknown as EntitlementRecord;
}

function normalizeHotelStayRecord(
  item: Record<string, unknown> | undefined
): HotelStayRecord | undefined {
  if (!item) return undefined;
  if (
    typeof item.beneficiaryId === "string" &&
    (item.beneficiaryType === "guest-session" ||
      item.beneficiaryType === "wallet")
  ) {
    return item as unknown as HotelStayRecord;
  }
  if (typeof item.walletAddress !== "string") return undefined;
  return {
    ...item,
    beneficiaryId: item.walletAddress,
    beneficiaryType: "wallet"
  } as unknown as HotelStayRecord;
}

class MemoryEntitlementStore implements EntitlementStore {
  private readonly challenges = new Map<string, WalletChallenge>();
  private readonly sessions = new Map<string, WalletSession>();
  private readonly guestSessions = new Map<string, GuestSession>();
  private readonly sandboxSessions = new Map<string, SandboxSession>();
  private readonly delegations = new Map<string, PaymentDelegation>();
  private readonly paymentLocks = new Map<
    string,
    { owner: string; expiresAt: number }
  >();
  private readonly entitlements = new Map<string, EntitlementRecord>();
  private readonly transactions = new Map<string, EntitlementRecord>();
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly activeHotelStays = new Map<string, HotelStayRecord>();
  private readonly occupiedHotelRooms = new Map<string, HotelStayRecord>();
  private readonly hotelStays = new Map<string, HotelStayRecord>();
  private readonly hotelInvoices = new Map<string, HotelInvoiceRecord>();

  async putChallenge(challenge: WalletChallenge) {
    this.challenges.set(challenge.id, challenge);
  }

  async consumeChallenge(id: string) {
    const challenge = this.challenges.get(id);
    this.challenges.delete(id);
    return challenge;
  }

  async putSession(session: WalletSession) {
    this.sessions.set(session.tokenHash, session);
  }

  async getSession(tokenHash: string) {
    return this.sessions.get(tokenHash);
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async putGuestSession(session: GuestSession) {
    this.guestSessions.set(session.tokenHash, structuredClone(session));
  }

  async getGuestSession(tokenHash: string) {
    const session = this.guestSessions.get(tokenHash);
    return session ? structuredClone(session) : undefined;
  }

  async deleteGuestSession(tokenHash: string) {
    this.guestSessions.delete(tokenHash);
  }

  async putSandboxSession(session: SandboxSession) {
    this.sandboxSessions.set(session.tokenHash, structuredClone(session));
  }

  async getSandboxSession(tokenHash: string) {
    const session = this.sandboxSessions.get(tokenHash);
    return session ? structuredClone(session) : undefined;
  }

  async deleteSandboxSession(tokenHash: string) {
    this.sandboxSessions.delete(tokenHash);
  }

  async putPaymentDelegation(delegation: PaymentDelegation) {
    this.delegations.set(delegation.tokenHash, delegation);
  }

  async getPaymentDelegation(tokenHash: string) {
    return this.delegations.get(tokenHash);
  }

  async acquirePaymentLock(
    principalId: string,
    owner: string,
    expiresAt: number
  ) {
    const existing = this.paymentLocks.get(principalId);
    const now = Math.floor(Date.now() / 1000);
    if (existing && existing.expiresAt > now) return false;
    this.paymentLocks.set(principalId, { owner, expiresAt });
    return true;
  }

  async releasePaymentLock(principalId: string, owner: string) {
    if (this.paymentLocks.get(principalId)?.owner === owner) {
      this.paymentLocks.delete(principalId);
    }
  }

  async getEntitlement(
    beneficiaryId: string,
    network: string,
    titleId: string
  ) {
    return this.entitlements.get(
      `${beneficiaryKey(beneficiaryId, network)}#${titleId}`
    );
  }

  async listEntitlements(beneficiaryId: string, network: string) {
    const prefix = `${beneficiaryKey(beneficiaryId, network)}#`;
    return [...this.entitlements.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entitlement]) => entitlement);
  }

  async putEntitlement(
    entitlement: EntitlementRecord,
    settlementId?: string
  ) {
    const claimed = this.transactions.get(entitlement.transactionId);
    if (
      claimed &&
      (claimed.beneficiaryId !== entitlement.beneficiaryId ||
        claimed.titleId !== entitlement.titleId)
    ) {
      throw new Error("This XRPL transaction has already been claimed.");
    }
    this.transactions.set(entitlement.transactionId, entitlement);
    this.entitlements.set(
      `${beneficiaryKey(entitlement.beneficiaryId, entitlement.network)}#${entitlement.titleId}`,
      entitlement
    );
    if (settlementId) {
      await this.transitionSettlement(settlementId, "GRANTED", {
        transactionId: entitlement.transactionId
      });
    }
  }

  async ensureSettlement(settlement: SettlementRecord) {
    const existing = this.settlements.get(settlement.settlementId);
    if (existing) return structuredClone(existing);
    this.settlements.set(
      settlement.settlementId,
      structuredClone(settlement)
    );
    return structuredClone(settlement);
  }

  async getSettlement(settlementId: string) {
    const settlement = this.settlements.get(settlementId);
    return settlement ? structuredClone(settlement) : undefined;
  }

  async transitionSettlement(
    settlementId: string,
    nextState: SettlementState,
    changes: Partial<
      Pick<
        SettlementRecord,
        "transactionId" | "failureReason" | "expiresAt"
      >
    > = {}
  ) {
    const current = this.settlements.get(settlementId);
    if (!current) {
      throw new Error(`Settlement ${settlementId} does not exist.`);
    }
    const updated = transitionSettlementRecord(
      current,
      nextState,
      changes
    );
    this.settlements.set(settlementId, structuredClone(updated));
    return structuredClone(updated);
  }

  async listPendingSettlements(limit = 25) {
    return [...this.settlements.values()]
      .filter((settlement) =>
        ["SIGNED", "SUBMITTED", "VALIDATED"].includes(
          settlement.state
        )
      )
      .sort((left, right) =>
        left.updatedAt.localeCompare(right.updatedAt)
      )
      .slice(0, limit)
      .map((settlement) => structuredClone(settlement));
  }

  async claimHotelStay(stay: HotelStayRecord) {
    const activeWalletStay = this.activeHotelStays.get(
      beneficiaryKey(stay.beneficiaryId, stay.network)
    );
    const activeRoomStay = this.occupiedHotelRooms.get(
      hotelRoomKey(stay.propertyId, stay.roomNumber)
    );
    const linkedAt = Date.parse(stay.linkedAt);
    if (
      (activeWalletStay &&
        Date.parse(activeWalletStay.checkoutAt) > linkedAt) ||
      (activeRoomStay && Date.parse(activeRoomStay.checkoutAt) > linkedAt)
    ) {
      return false;
    }

    const storedStay = structuredClone(stay);
    this.activeHotelStays.set(
      beneficiaryKey(stay.beneficiaryId, stay.network),
      storedStay
    );
    this.occupiedHotelRooms.set(
      hotelRoomKey(stay.propertyId, stay.roomNumber),
      storedStay
    );
    this.hotelStays.set(stay.stayRef, structuredClone(stay));
    return true;
  }

  async listOccupiedHotelRooms(propertyId: string, now: Date) {
    return [...this.occupiedHotelRooms.values()]
      .filter(
        (stay) =>
          stay.propertyId === propertyId &&
          Date.parse(stay.checkoutAt) > now.getTime()
      )
      .map((stay) => stay.roomNumber);
  }

  async getActiveHotelStay(beneficiaryId: string, network: string) {
    const stay = this.activeHotelStays.get(
      beneficiaryKey(beneficiaryId, network)
    );
    return stay ? structuredClone(stay) : undefined;
  }

  async clearActiveHotelStay(beneficiaryId: string, network: string) {
    const key = beneficiaryKey(beneficiaryId, network);
    const stay = this.activeHotelStays.get(key);
    this.activeHotelStays.delete(key);
    if (
      stay &&
      this.occupiedHotelRooms.get(
        hotelRoomKey(stay.propertyId, stay.roomNumber)
      )?.stayRef === stay.stayRef
    ) {
      this.occupiedHotelRooms.delete(
        hotelRoomKey(stay.propertyId, stay.roomNumber)
      );
    }
  }

  async getHotelStay(stayRef: string) {
    const stay = this.hotelStays.get(stayRef);
    return stay ? structuredClone(stay) : undefined;
  }

  async putHotelInvoice(invoice: HotelInvoiceRecord) {
    this.hotelInvoices.set(invoice.ledgerInvoiceId, structuredClone(invoice));
  }

  async getHotelInvoice(ledgerInvoiceId: string) {
    const invoice = this.hotelInvoices.get(ledgerInvoiceId);
    return invoice ? structuredClone(invoice) : undefined;
  }
}

class DynamoEntitlementStore implements EntitlementStore {
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    documentClient?: DynamoDBDocumentClient
  ) {
    this.documentClient =
      documentClient ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async putChallenge(challenge: WalletChallenge) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `CHALLENGE#${challenge.id}`,
          sk: "CHALLENGE",
          type: "challenge",
          ...challenge
        }
      })
    );
  }

  async consumeChallenge(id: string) {
    const response = await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: `CHALLENGE#${id}`, sk: "CHALLENGE" },
        ReturnValues: "ALL_OLD"
      })
    );
    return response.Attributes as WalletChallenge | undefined;
  }

  async putSession(session: WalletSession) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `SESSION#${session.tokenHash}`,
          sk: "SESSION",
          type: "session",
          ...session
        }
      })
    );
  }

  async getSession(tokenHash: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `SESSION#${tokenHash}`, sk: "SESSION" }
      })
    );
    return response.Item as WalletSession | undefined;
  }

  async deleteSession(tokenHash: string) {
    await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: `SESSION#${tokenHash}`, sk: "SESSION" }
      })
    );
  }

  async putGuestSession(session: GuestSession) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `GUEST#${session.tokenHash}`,
          sk: "SESSION",
          type: "guest-session",
          ...session
        }
      })
    );
  }

  async getGuestSession(tokenHash: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `GUEST#${tokenHash}`, sk: "SESSION" }
      })
    );
    return response.Item as GuestSession | undefined;
  }

  async deleteGuestSession(tokenHash: string) {
    await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: `GUEST#${tokenHash}`, sk: "SESSION" }
      })
    );
  }

  async putSandboxSession(session: SandboxSession) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `SANDBOX#${session.tokenHash}`,
          sk: "SESSION",
          type: "sandbox-session",
          ...session
        }
      })
    );
  }

  async getSandboxSession(tokenHash: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `SANDBOX#${tokenHash}`, sk: "SESSION" }
      })
    );
    return response.Item as SandboxSession | undefined;
  }

  async deleteSandboxSession(tokenHash: string) {
    await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: `SANDBOX#${tokenHash}`, sk: "SESSION" }
      })
    );
  }

  async putPaymentDelegation(delegation: PaymentDelegation) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `DELEGATION#${delegation.tokenHash}`,
          sk: "PAYMENT",
          type: "payment-delegation",
          ...delegation
        }
      })
    );
  }

  async getPaymentDelegation(tokenHash: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `DELEGATION#${tokenHash}`, sk: "PAYMENT" }
      })
    );
    return response.Item as PaymentDelegation | undefined;
  }

  async acquirePaymentLock(
    principalId: string,
    owner: string,
    expiresAt: number
  ) {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: `PAYMENT_LOCK#${principalId}`,
            sk: "LOCK",
            type: "payment-lock",
            owner,
            expiresAt
          },
          ConditionExpression:
            "attribute_not_exists(pk) OR expiresAt < :now",
          ExpressionAttributeValues: {
            ":now": Math.floor(Date.now() / 1000)
          }
        })
      );
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ConditionalCheckFailedException"
      ) {
        return false;
      }
      throw error;
    }
  }

  async releasePaymentLock(principalId: string, owner: string) {
    try {
      await this.documentClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: `PAYMENT_LOCK#${principalId}`, sk: "LOCK" },
          ConditionExpression: "#owner = :owner",
          ExpressionAttributeNames: { "#owner": "owner" },
          ExpressionAttributeValues: { ":owner": owner }
        })
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ConditionalCheckFailedException"
      ) {
        return;
      }
      throw error;
    }
  }

  async getEntitlement(
    beneficiaryId: string,
    network: string,
    titleId: string
  ) {
    const current = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: beneficiaryKey(beneficiaryId, network),
          sk: `ENTITLEMENT#${titleId}`
        }
      })
    );
    const currentRecord = normalizeEntitlementRecord(current.Item);
    if (currentRecord) return currentRecord;

    const legacy = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: legacyWalletKey(beneficiaryId, network),
          sk: `ENTITLEMENT#${titleId}`
        }
      })
    );
    return normalizeEntitlementRecord(legacy.Item);
  }

  async listEntitlements(beneficiaryId: string, network: string) {
    const queryEntitlements = async (pk: string) =>
      this.documentClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": pk,
            ":sk": "ENTITLEMENT#"
          }
        })
      );
    const [current, legacy] = await Promise.all([
      queryEntitlements(beneficiaryKey(beneficiaryId, network)),
      queryEntitlements(legacyWalletKey(beneficiaryId, network))
    ]);
    const records = new Map<string, EntitlementRecord>();
    for (const item of legacy.Items ?? []) {
      const record = normalizeEntitlementRecord(item);
      if (record) records.set(record.titleId, record);
    }
    for (const item of current.Items ?? []) {
      const record = normalizeEntitlementRecord(item);
      if (record) records.set(record.titleId, record);
    }
    return [...records.values()];
  }

  async putEntitlement(
    entitlement: EntitlementRecord,
    settlementId?: string
  ) {
    const existing = await this.getEntitlement(
      entitlement.beneficiaryId,
      entitlement.network,
      entitlement.titleId
    );
    if (existing?.transactionId === entitlement.transactionId) return;

    const transactItems: ConstructorParameters<
      typeof TransactWriteCommand
    >[0]["TransactItems"] = [
      {
        Put: {
          TableName: this.tableName,
          Item: {
            pk: `TRANSACTION#${entitlement.transactionId}`,
            sk: "CLAIM",
            type: "transaction-claim",
            beneficiaryId: entitlement.beneficiaryId,
            beneficiaryType: entitlement.beneficiaryType,
            payerAddress: entitlement.payerAddress,
            network: entitlement.network,
            titleId: entitlement.titleId,
            expiresAt: entitlement.expiresAt
          },
          ConditionExpression: "attribute_not_exists(pk)"
        }
      },
      {
        Put: {
          TableName: this.tableName,
          Item: {
            pk: beneficiaryKey(
              entitlement.beneficiaryId,
              entitlement.network
            ),
            sk: `ENTITLEMENT#${entitlement.titleId}`,
            type: "entitlement",
            ...entitlement
          }
        }
      }
    ];
    if (settlementId) {
      transactItems.push({
        Update: {
          TableName: this.tableName,
          Key: {
            pk: settlementKey(settlementId),
            sk: "STATE"
          },
          UpdateExpression:
            "SET #state = :granted, updatedAt = :updatedAt, transactionId = :transactionId REMOVE failureReason",
          ConditionExpression: "#state = :validated",
          ExpressionAttributeNames: {
            "#state": "state"
          },
          ExpressionAttributeValues: {
            ":validated": "VALIDATED",
            ":granted": "GRANTED",
            ":updatedAt": new Date().toISOString(),
            ":transactionId": entitlement.transactionId
          }
        }
      });
    }

    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems
      })
    );
  }

  async ensureSettlement(settlement: SettlementRecord) {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: settlementKey(settlement.settlementId),
            sk: "STATE",
            type: "xrpl-settlement",
            ...settlement
          },
          ConditionExpression: "attribute_not_exists(pk)"
        })
      );
      return settlement;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ConditionalCheckFailedException"
      ) {
        const existing = await this.getSettlement(
          settlement.settlementId
        );
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getSettlement(settlementId: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: settlementKey(settlementId),
          sk: "STATE"
        }
      })
    );
    return response.Item as SettlementRecord | undefined;
  }

  async transitionSettlement(
    settlementId: string,
    nextState: SettlementState,
    changes: Partial<
      Pick<
        SettlementRecord,
        "transactionId" | "failureReason" | "expiresAt"
      >
    > = {}
  ) {
    const current = await this.getSettlement(settlementId);
    if (!current) {
      throw new Error(`Settlement ${settlementId} does not exist.`);
    }
    const updated = transitionSettlementRecord(
      current,
      nextState,
      changes
    );
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: settlementKey(settlementId),
            sk: "STATE",
            type: "xrpl-settlement",
            ...updated
          },
          ConditionExpression: "#state = :expectedState",
          ExpressionAttributeNames: {
            "#state": "state"
          },
          ExpressionAttributeValues: {
            ":expectedState": current.state
          }
        })
      );
      return updated;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ConditionalCheckFailedException"
      ) {
        const latest = await this.getSettlement(settlementId);
        if (
          latest &&
          (latest.state === nextState ||
            latest.state === "GRANTED")
        ) {
          return latest;
        }
      }
      throw error;
    }
  }

  async listPendingSettlements(limit = 25) {
    const responses = await Promise.all(
      (["SIGNED", "SUBMITTED", "VALIDATED"] as const).map(
        (state) =>
          this.documentClient.send(
            new QueryCommand({
              TableName: this.tableName,
              IndexName: SETTLEMENT_STATE_INDEX,
              KeyConditionExpression: "#state = :state",
              ExpressionAttributeNames: {
                "#state": "state"
              },
              ExpressionAttributeValues: {
                ":state": state
              },
              ScanIndexForward: true,
              Limit: limit
            })
          )
      )
    );
    return responses
      .flatMap(
        (response) =>
          (response.Items ?? []) as SettlementRecord[]
      )
      .sort((left, right) =>
        left.updatedAt.localeCompare(right.updatedAt)
      )
      .slice(0, limit);
  }

  async claimHotelStay(stay: HotelStayRecord) {
    const legacyWalletCondition =
      stay.beneficiaryType === "wallet"
        ? [
            {
              ConditionCheck: {
                TableName: this.tableName,
                Key: {
                  pk: legacyWalletKey(stay.beneficiaryId, stay.network),
                  sk: "STAY#ACTIVE"
                },
                ConditionExpression:
                  "attribute_not_exists(pk) OR checkoutAt <= :linkedAt",
                ExpressionAttributeValues: {
                  ":linkedAt": stay.linkedAt
                }
              }
            }
          ]
        : [];
    try {
      await this.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            ...legacyWalletCondition,
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  pk: beneficiaryKey(stay.beneficiaryId, stay.network),
                  sk: "STAY#ACTIVE",
                  type: "active-hotel-stay",
                  ...stay
                },
                ConditionExpression:
                  "attribute_not_exists(pk) OR checkoutAt <= :linkedAt",
                ExpressionAttributeValues: {
                  ":linkedAt": stay.linkedAt
                }
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  pk: `HOTEL#${stay.propertyId}`,
                  sk: `ROOM#${stay.roomNumber}`,
                  type: "occupied-hotel-room",
                  ...stay,
                  expiresAt: Math.floor(
                    Date.parse(stay.checkoutAt) / 1000
                  )
                },
                ConditionExpression:
                  "attribute_not_exists(pk) OR checkoutAt <= :linkedAt",
                ExpressionAttributeValues: {
                  ":linkedAt": stay.linkedAt
                }
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  pk: `STAY#${stay.stayRef}`,
                  sk: "STAY",
                  type: "hotel-stay",
                  ...stay
                }
              }
            }
          ]
        })
      );
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "TransactionCanceledException"
      ) {
        return false;
      }
      throw error;
    }
  }

  async listOccupiedHotelRooms(propertyId: string, now: Date) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :room)",
        FilterExpression: "checkoutAt > :now",
        ExpressionAttributeValues: {
          ":pk": `HOTEL#${propertyId}`,
          ":room": "ROOM#",
          ":now": now.toISOString()
        },
        ProjectionExpression: "roomNumber"
      })
    );
    return (response.Items ?? []).flatMap((item) =>
      typeof item.roomNumber === "string" ? [item.roomNumber] : []
    );
  }

  async getActiveHotelStay(beneficiaryId: string, network: string) {
    const current = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: beneficiaryKey(beneficiaryId, network),
          sk: "STAY#ACTIVE"
        }
      })
    );
    const currentStay = normalizeHotelStayRecord(current.Item);
    if (currentStay) return currentStay;

    const legacy = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: legacyWalletKey(beneficiaryId, network),
          sk: "STAY#ACTIVE"
        }
      })
    );
    return normalizeHotelStayRecord(legacy.Item);
  }

  async clearActiveHotelStay(beneficiaryId: string, network: string) {
    const stay = await this.getActiveHotelStay(beneficiaryId, network);
    if (!stay) return;

    const keys = [
      {
        pk: beneficiaryKey(beneficiaryId, network),
        sk: "STAY#ACTIVE"
      },
      ...(stay.beneficiaryType === "wallet"
        ? [
            {
              pk: legacyWalletKey(beneficiaryId, network),
              sk: "STAY#ACTIVE"
            }
          ]
        : []),
      {
        pk: `HOTEL#${stay.propertyId}`,
        sk: `ROOM#${stay.roomNumber}`
      }
    ];
    for (const key of keys) {
      try {
        await this.documentClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: key,
            ConditionExpression: "stayRef = :stayRef",
            ExpressionAttributeValues: {
              ":stayRef": stay.stayRef
            }
          })
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "name" in error &&
          error.name === "ConditionalCheckFailedException"
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  async getHotelStay(stayRef: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `STAY#${stayRef}`, sk: "STAY" }
      })
    );
    return normalizeHotelStayRecord(response.Item);
  }

  async putHotelInvoice(invoice: HotelInvoiceRecord) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `INVOICE#${invoice.ledgerInvoiceId}`,
          sk: "RECEIPT",
          type: "hotel-ledger-receipt",
          ...invoice
        }
      })
    );
  }

  async getHotelInvoice(ledgerInvoiceId: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `INVOICE#${ledgerInvoiceId}`,
          sk: "RECEIPT"
        }
      })
    );
    return response.Item as HotelInvoiceRecord | undefined;
  }
}

let store: EntitlementStore | undefined;

export function createMemoryEntitlementStore(): EntitlementStore {
  return new MemoryEntitlementStore();
}

export function createDynamoEntitlementStore(
  tableName: string,
  documentClient?: DynamoDBDocumentClient
): EntitlementStore {
  return new DynamoEntitlementStore(tableName, documentClient);
}

export function entitlementStore() {
  if (!store) {
    store = process.env.ENTITLEMENTS_TABLE_NAME
      ? createDynamoEntitlementStore(process.env.ENTITLEMENTS_TABLE_NAME)
      : createMemoryEntitlementStore();
  }
  return store;
}
