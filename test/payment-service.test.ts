// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import type { Network } from "@x402/core/types";
import {
  createMemoryEntitlementStore,
  type SandboxSession
} from "../server/entitlementStore";
import {
  createPaymentRouteHandler
} from "../server/paymentRoutes";
import { ManagedEntitlementService } from "../server/managedEntitlementService";
import { PaymentChallengeService } from "../server/paymentChallengeService";
import { PaymentRuntime } from "../server/paymentRuntime";
import { SandboxPaymentService } from "../server/sandboxPaymentService";
import {
  PaymentService,
  managedBeneficiary,
  type PaymentServiceConfig
} from "../server/paymentService";
import type { PaymentPrincipal } from "../server/paymentContext";
import type { Movie } from "../src/types";

const movie: Movie = {
  id: "afterlight",
  title: "Afterlight",
  tagline: "Some signals arrive too late.",
  year: 2026,
  rating: "PG-13",
  runtime: "1h 47m",
  genre: "Sci-fi drama",
  price: 0.65,
  currency: "USDC",
  accent: "violet",
  description: "Test title"
};

function config(
  overrides: Partial<PaymentServiceConfig> = {}
): PaymentServiceConfig {
  return {
    backend: "sandbox",
    asset: "USDC",
    xrplNetwork: "xrpl:1" as Network,
    sandboxXrplAddress: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    usdcNetwork: "eip155:84532",
    usdcAsset: "0x1111111111111111111111111111111111111111",
    usdcPayTo: "0x2222222222222222222222222222222222222222",
    entitlementSeconds: 48 * 60 * 60,
    sessionLimit: 2,
    ...overrides
  };
}

function service(
  paymentConfig: PaymentServiceConfig,
  store = createMemoryEntitlementStore()
) {
  return new PaymentService(
    paymentConfig,
    dependencies(store)
  );
}

function dependencies(
  store = createMemoryEntitlementStore()
) {
  return {
    store,
    settlementRpc: {
      async request<T>() {
        return {} as T;
      }
    },
    randomUuid: () => "00000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-11-05T12:00:00.000Z"),
    emitEvent: () => {}
  };
}

function sandboxSession(): SandboxSession {
  return {
    tokenHash: "sandbox-token",
    limit: 2,
    spent: 0,
    transactions: [],
    proofs: {},
    expiresAt: Math.floor(Date.now() / 1000) + 600
  };
}

describe("reusable payment service", () => {
  test("uses injected USDC settings without requiring an XRPL merchant", async () => {
    const paymentService = service(
      config({
        usdcNetwork: "eip155:1",
        usdcAsset: "0x3333333333333333333333333333333333333333",
        usdcPayTo: "0x4444444444444444444444444444444444444444"
      })
    );

    const challenge = await paymentService.createChallenge(movie);

    expect(challenge.accepts[0]).toMatchObject({
      network: "eip155:1",
      asset: "0x3333333333333333333333333333333333333333",
      payTo: "0x4444444444444444444444444444444444444444",
      amount: "650000"
    });
  });

  test("isolates state across independently injected stores", async () => {
    const firstStore = createMemoryEntitlementStore();
    const secondStore = createMemoryEntitlementStore();
    const first = service(config(), firstStore);
    const second = service(config(), secondStore);
    const session = sandboxSession();
    const principal = {
      type: "sandbox",
      id: session.tokenHash,
      session
    } satisfies PaymentPrincipal;

    const result = await first.resolveSandboxPayment(principal, movie);

    expect(result.ok).toBe(true);
    expect(await firstStore.getSandboxSession(session.tokenHash)).toMatchObject({
      spent: 0.65
    });
    expect(
      await secondStore.getSandboxSession(session.tokenHash)
    ).toBeUndefined();
    expect(second.config.sessionLimit).toBe(2);
  });

  test("normalizes wallet and guest beneficiaries at the service boundary", () => {
    expect(
      managedBeneficiary({
        type: "wallet",
        id: "wallet-token",
        session: {
          tokenHash: "wallet-token",
          address: "rWallet",
          network: "xrpl:1",
          expiresAt: 1
        }
      })
    ).toEqual({
      id: "rWallet",
      type: "wallet",
      network: "xrpl:1"
    });
    expect(
      managedBeneficiary({
        type: "guest",
        id: "guest-token",
        session: {
          tokenHash: "guest-token",
          beneficiaryId: "guest-123",
          network: "xrpl:1",
          expiresAt: 1
        }
      })
    ).toEqual({
      id: "guest-123",
      type: "guest-session",
      network: "xrpl:1"
    });
  });

  test("mounts payment routes independently of the application server", async () => {
    const paymentService = service(config());
    const session = sandboxSession();
    const principal = {
      type: "sandbox",
      id: session.tokenHash,
      session
    } satisfies PaymentPrincipal;
    const handlePaymentRoute = createPaymentRouteHandler({
      service: paymentService,
      catalog: [movie],
      resolveContext: async () => ({ principal }),
      sessionView: async (current) => ({
        remaining:
          current?.type === "sandbox"
            ? current.session.limit - current.session.spent
            : 0
      })
    });

    const response = await handlePaymentRoute(
      new Request("https://example.com/api/payments/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titleId: movie.id })
      })
    );
    const unrelated = await handlePaymentRoute(
      new Request("https://example.com/health")
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      status: "settled",
      transaction: {
        titleId: movie.id,
        amount: movie.price
      }
    });
    expect(unrelated).toBeUndefined();
  });

  test("allows focused workflow components to be reused without the facade", async () => {
    const runtime = new PaymentRuntime(
      config(),
      dependencies()
    );
    const challenges = new PaymentChallengeService(runtime);
    const sandbox = new SandboxPaymentService(runtime);
    const entitlements =
      new ManagedEntitlementService(runtime);
    const session = sandboxSession();
    const sandboxPrincipal = {
      type: "sandbox",
      id: session.tokenHash,
      session
    } satisfies PaymentPrincipal;
    const guestPrincipal = {
      type: "guest",
      id: "guest-token",
      session: {
        tokenHash: "guest-token",
        beneficiaryId: "guest-123",
        network: "xrpl:1",
        expiresAt: Math.floor(Date.now() / 1000) + 600
      }
    } satisfies PaymentPrincipal;

    const challenge = challenges.createUsdcChallenge(movie);
    const payment = await sandbox.resolve(
      sandboxPrincipal,
      movie
    );
    const budget = await entitlements.budget(guestPrincipal);

    expect(challenge.accepts[0]?.payTo).toBe(
      "0x2222222222222222222222222222222222222222"
    );
    expect(payment).toMatchObject({
      ok: true,
      value: {
        transaction: {
          titleId: movie.id
        }
      }
    });
    expect(budget).toEqual({
      records: [],
      spent: 0,
      remaining: 2
    });
  });
});
