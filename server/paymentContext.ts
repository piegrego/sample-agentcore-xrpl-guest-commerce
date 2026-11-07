// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  EntitlementStore,
  GuestSession,
  SandboxSession,
  WalletSession
} from "./entitlementStore";
import {
  DEFAULT_PAYMENT_SESSION_LIMIT,
  validatedPositiveAmount
} from "../shared/paymentConfiguration";

const WALLET_SESSION_COOKIE = "agentcore_xrpl_wallet_session";
const GUEST_SESSION_COOKIE = "agentcore_xrpl_guest_session";
const SANDBOX_SESSION_COOKIE = "agentcore_xrpl_demo_session";
const GUEST_SESSION_SECONDS = 24 * 60 * 60;
const SANDBOX_SESSION_SECONDS = 24 * 60 * 60;
const PAYMENT_DELEGATION_SECONDS = 5 * 60;

export type PaymentPrincipal =
  | { type: "wallet"; id: string; session: WalletSession }
  | { type: "guest"; id: string; session: GuestSession }
  | { type: "sandbox"; id: string; session: SandboxSession };

export type PaymentContextMode =
  | "wallet"
  | "managed"
  | "managed-existing"
  | "sandbox";

export interface PaymentContext {
  principal?: PaymentPrincipal;
  setCookie?: string;
}

export interface PaymentContextOptions {
  readonly xrplNetwork?: string;
  readonly sessionLimit?: number;
}

export const epochSeconds = () => Math.floor(Date.now() / 1000);

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Buffer.from(digest).toString("hex");
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [cookieName, ...value] = cookie.trim().split("=");
    if (cookieName === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function secureCookie(name: string, token: string, maxAge: number) {
  return [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; ");
}

export const walletCookie = (token: string, maxAge: number) =>
  secureCookie(WALLET_SESSION_COOKIE, token, maxAge);

export const clearWalletCookie = () => walletCookie("", 0);

export const guestCookie = (token: string, maxAge: number) =>
  secureCookie(GUEST_SESSION_COOKIE, token, maxAge);

export const clearGuestCookie = () => guestCookie("", 0);

async function delegatedPrincipal(
  request: Request,
  store: EntitlementStore
): Promise<PaymentPrincipal | undefined> {
  const token = request.headers.get("x-payment-delegation");
  if (!token) return undefined;
  const delegation = await store.getPaymentDelegation(await sha256(token));
  if (!delegation || delegation.expiresAt <= epochSeconds()) return undefined;
  if (delegation.principalType === "wallet") {
    const session = await store.getSession(delegation.principalId);
    return session && session.expiresAt > epochSeconds()
      ? { type: "wallet", id: session.tokenHash, session }
      : undefined;
  }
  if (delegation.principalType === "guest") {
    const session = await store.getGuestSession(delegation.principalId);
    return session && session.expiresAt > epochSeconds()
      ? { type: "guest", id: session.tokenHash, session }
      : undefined;
  }
  const session = await store.getSandboxSession(delegation.principalId);
  return session && session.expiresAt > epochSeconds()
    ? { type: "sandbox", id: session.tokenHash, session }
    : undefined;
}

export async function resolvePaymentContext(
  request: Request,
  store: EntitlementStore,
  mode: PaymentContextMode,
  options: PaymentContextOptions = {}
): Promise<PaymentContext> {
  const sessionLimit = Number(
    validatedPositiveAmount(
      String(options.sessionLimit ?? DEFAULT_PAYMENT_SESSION_LIMIT),
      "Payment session limit"
    )
  );
  const delegated = await delegatedPrincipal(request, store);
  if (
    delegated &&
    (mode === "managed" || mode === "managed-existing"
      ? delegated.type === "guest" || delegated.type === "wallet"
      : delegated.type === mode)
  ) {
    return { principal: delegated };
  }

  const walletToken = cookieValue(request, WALLET_SESSION_COOKIE);
  if (walletToken) {
    const session = await store.getSession(await sha256(walletToken));
    if (session && session.expiresAt > epochSeconds()) {
      return {
        principal: { type: "wallet", id: session.tokenHash, session }
      };
    }
  }
  if (mode === "wallet") return {};

  if (mode === "managed" || mode === "managed-existing") {
    const guestToken = cookieValue(request, GUEST_SESSION_COOKIE);
    if (guestToken) {
      const session = await store.getGuestSession(await sha256(guestToken));
      if (session && session.expiresAt > epochSeconds()) {
        return {
          principal: { type: "guest", id: session.tokenHash, session }
        };
      }
    }
    if (mode === "managed-existing") return {};

    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const session: GuestSession = {
      tokenHash: await sha256(token),
      beneficiaryId: `guest_${crypto.randomUUID().replace(/-/g, "")}`,
      network: options.xrplNetwork ?? "xrpl:1",
      expiresAt: epochSeconds() + GUEST_SESSION_SECONDS
    };
    await store.putGuestSession(session);
    return {
      principal: { type: "guest", id: session.tokenHash, session },
      setCookie: guestCookie(token, GUEST_SESSION_SECONDS)
    };
  }

  const sandboxToken = cookieValue(request, SANDBOX_SESSION_COOKIE);
  if (sandboxToken) {
    const session = await store.getSandboxSession(await sha256(sandboxToken));
    if (session && session.expiresAt > epochSeconds()) {
      return {
        principal: { type: "sandbox", id: session.tokenHash, session }
      };
    }
  }

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const session: SandboxSession = {
    tokenHash: await sha256(token),
    limit: sessionLimit,
    spent: 0,
    transactions: [],
    proofs: {},
    expiresAt: epochSeconds() + SANDBOX_SESSION_SECONDS
  };
  await store.putSandboxSession(session);
  return {
    principal: { type: "sandbox", id: session.tokenHash, session },
    setCookie: secureCookie(
      SANDBOX_SESSION_COOKIE,
      token,
      SANDBOX_SESSION_SECONDS
    )
  };
}

export async function createPaymentDelegation(
  principal: PaymentPrincipal,
  store: EntitlementStore
) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  await store.putPaymentDelegation({
    tokenHash: await sha256(token),
    principalType: principal.type,
    principalId: principal.id,
    expiresAt: epochSeconds() + PAYMENT_DELEGATION_SECONDS
  });
  return token;
}

export async function withPaymentLock<T>(
  principal: PaymentPrincipal,
  store: EntitlementStore,
  operation: () => Promise<T>
) {
  const lockId =
    principal.type === "wallet"
      ? `${principal.session.network}:${principal.session.address}`
      : principal.type === "guest"
        ? `${principal.session.network}:${principal.session.beneficiaryId}`
      : principal.id;
  const owner = crypto.randomUUID();
  const acquired = await store.acquirePaymentLock(
    lockId,
    owner,
    epochSeconds() + 120
  );
  if (!acquired) {
    throw new Error(
      "Another payment is being processed for this session. Try again shortly."
    );
  }
  try {
    return await operation();
  } finally {
    await store.releasePaymentLock(lockId, owner);
  }
}
