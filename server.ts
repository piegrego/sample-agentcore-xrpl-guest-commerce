// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import appHtml from "./src/index.html";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand
} from "@aws-sdk/client-bedrock-agentcore";
import type { Network } from "@x402/core/types";
import { isValidClassicAddress } from "xrpl";
import { deriveAddress, verify } from "ripple-keypairs";
import {
  entitlementStore,
  type GuestSession,
  type WalletSession
} from "./server/entitlementStore";
import {
  HOTEL_PROPERTY,
  HOTEL_ROOM_NUMBERS,
  activeHotelStay,
  assignAvailableHotelRoom,
  availableHotelRooms,
  createHotelInvoice,
  createHotelStay,
  proofOfStayView,
  readHotelDashboard,
  verifyDemoRoomPin
} from "./server/hotel";
import {
  clearGuestCookie,
  clearWalletCookie,
  createPaymentDelegation,
  epochSeconds,
  resolvePaymentContext,
  sha256,
  walletCookie,
  type PaymentContextMode,
  type PaymentPrincipal
} from "./server/paymentContext";
import { createCatalog } from "./server/catalog";
import { xrplRpc } from "./shared/xrpl";
import {
  AGENT_MODES,
  parseAgentInvocation,
  type AgentInvocation
} from "./shared/contracts";
import {
  DEFAULT_PAYMENT_SESSION_LIMIT,
  DEFAULT_USDC_ASSET,
  DEFAULT_USDC_NETWORK,
  paymentNetworkLabel,
  resolveUsdcPayTo,
  validatedEip155Network,
  validatedEvmAddress,
  validatedPositiveAmount
} from "./shared/paymentConfiguration";
import type {
  Movie,
  PaymentAsset,
  PaymentBackend
} from "./src/types";
import { jsonResponse as json } from "./server/http";
import {
  PaymentService,
  managedBeneficiary,
  type ManagedPaymentPrincipal
} from "./server/paymentService";
import {
  createPaymentRouteHandler
} from "./server/paymentRoutes";

export {
  createSettledPlaybackResponse
} from "./server/paymentRoutes";

const PORT = Number(process.env.PORT || 4173);
const PAYMENT_BACKEND = paymentBackend(
  process.env.PAYMENT_BACKEND || process.env.PAYMENT_MODE || "sandbox"
);
const PAYMENT_ASSET = paymentAsset(process.env.PAYMENT_ASSET || "USDC");
const XRPL_NETWORK = (process.env.XRPL_NETWORK || "xrpl:1") as Network;
const XRPL_MERCHANT_ADDRESS = process.env.XRPL_MERCHANT_ADDRESS;
const XRPL_RUNTIME_PAYER_ADDRESS =
  process.env.XRPL_RUNTIME_PAYER_ADDRESS;
const WALLET_SESSION_SECONDS = 7 * 24 * 60 * 60;
const WALLET_CHALLENGE_SECONDS = 5 * 60;
const ENTITLEMENT_SECONDS = 48 * 60 * 60;
const PAYMENT_SESSION_LIMIT = Number(
  validatedPositiveAmount(
    process.env.PAYMENT_SESSION_LIMIT || DEFAULT_PAYMENT_SESSION_LIMIT,
    "PAYMENT_SESSION_LIMIT"
  )
);
const SANDBOX_XRPL_ADDRESS = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe"; // pragma: allowlist secret -- public XRPL test address
const USDC_NETWORK = validatedEip155Network(
  process.env.USDC_NETWORK || DEFAULT_USDC_NETWORK,
  "USDC_NETWORK"
);
const USDC_ASSET = validatedEvmAddress(
  process.env.USDC_ASSET || DEFAULT_USDC_ASSET,
  "USDC_ASSET"
);
const USDC_PAY_TO = resolveUsdcPayTo(
  PAYMENT_BACKEND,
  PAYMENT_ASSET,
  process.env.USDC_PAY_TO
);
const PAYMENT_CONTEXT_OPTIONS = {
  xrplNetwork: XRPL_NETWORK,
  sessionLimit: PAYMENT_SESSION_LIMIT
} as const;
const agentcore = new BedrockAgentCoreClient({
  region: process.env.AWS_REGION
});
const entitlements = entitlementStore();
const resolveServerPaymentContext = (
  request: Request,
  mode: PaymentContextMode
) =>
  resolvePaymentContext(
    request,
    entitlements,
    mode,
    PAYMENT_CONTEXT_OPTIONS
  );
const settlementRpc = {
  request: xrplRpc
};

function paymentBackend(value: string): PaymentBackend {
  if (
    value === "sandbox" ||
    value === "agentcore" ||
    value === "xrpl" ||
    value === "auto"
  ) {
    return value;
  }
  throw new Error(
    'PAYMENT_BACKEND must be one of "sandbox", "agentcore", "xrpl", or "auto".'
  );
}

function paymentAsset(value: string): PaymentAsset {
  const normalized = value.toUpperCase();
  if (normalized === "USDC" || normalized === "XRP") return normalized;
  throw new Error('PAYMENT_ASSET must be either "USDC" or "XRP".');
}

function activeBackend(): Exclude<PaymentBackend, "auto"> {
  if (PAYMENT_BACKEND !== "auto") return PAYMENT_BACKEND;
  return PAYMENT_ASSET === "XRP" ? "xrpl" : "agentcore";
}

function activeNetwork() {
  return paymentNetworkLabel(
    PAYMENT_ASSET,
    XRPL_NETWORK,
    USDC_NETWORK
  );
}

const catalog: Movie[] = createCatalog(PAYMENT_ASSET);
const paymentService = new PaymentService(
  {
    backend: activeBackend(),
    asset: PAYMENT_ASSET,
    xrplNetwork: XRPL_NETWORK,
    xrplMerchantAddress: XRPL_MERCHANT_ADDRESS,
    xrplRuntimePayerAddress: XRPL_RUNTIME_PAYER_ADDRESS,
    sandboxXrplAddress: SANDBOX_XRPL_ADDRESS,
    usdcNetwork: USDC_NETWORK,
    usdcAsset: USDC_ASSET,
    usdcPayTo: USDC_PAY_TO,
    entitlementSeconds: ENTITLEMENT_SECONDS,
    sessionLimit: PAYMENT_SESSION_LIMIT
  },
  {
    store: entitlements,
    settlementRpc
  }
);

const money = (value: number) => Number(value.toFixed(2));

interface AuthenticatedWallet {
  session: WalletSession;
}

async function authenticatedWallet(
  request: Request
): Promise<AuthenticatedWallet | undefined> {
  const context = await resolveServerPaymentContext(request, "wallet");
  return context.principal?.type === "wallet"
    ? { session: context.principal.session }
    : undefined;
}

export function verifyWalletSignature(
  message: string,
  signature: string,
  publicKey: string,
  address: string
) {
  try {
    return (
      deriveAddress(publicKey) === address &&
      verify(
        Buffer.from(message, "utf8").toString("hex"),
        signature,
        publicKey
      )
    );
  } catch {
    return false;
  }
}

function supportedApprovalModes() {
  return ["runtime"] as const;
}

async function sessionView(principal?: PaymentPrincipal) {
  if (
    principal?.type === "wallet" ||
    principal?.type === "guest" ||
    activeBackend() === "xrpl"
  ) {
    const beneficiary =
      principal?.type === "wallet" || principal?.type === "guest"
        ? managedBeneficiary(principal)
        : undefined;
    const stay = beneficiary
      ? activeHotelStay(
          await entitlements.getActiveHotelStay(
            beneficiary.id,
            beneficiary.network
          )
        )
      : undefined;
    const budget =
      principal?.type === "wallet" || principal?.type === "guest"
        ? await paymentService.managedBudget(principal)
        : { records: [], spent: 0, remaining: PAYMENT_SESSION_LIMIT };
    const { records, spent, remaining } = budget;
    return {
      id: beneficiary
        ? `${beneficiary.type === "wallet" ? "wallet" : "guest"}_${beneficiary.id.slice(-8)}`
        : "guest_disconnected",
      currency: PAYMENT_ASSET,
      backend: activeBackend(),
      network: activeNetwork(),
      identityType: beneficiary?.type,
      beneficiaryId: beneficiary?.id,
      walletAddress:
        principal?.type === "wallet" ? principal.session.address : undefined,
      authenticated: Boolean(beneficiary),
      approvalModes: supportedApprovalModes(),
      limit: PAYMENT_SESSION_LIMIT,
      spent,
      remaining,
      expiresInMinutes: principal
        ? Math.max(
            0,
            Math.ceil((principal.session.expiresAt - epochSeconds()) / 60)
          )
        : 0,
      transactions: records
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((entitlement) => ({
          id: entitlement.transactionId,
          titleId: entitlement.titleId,
          merchant: "Ledger Lodge Media",
          amount: entitlement.amount,
          currency: entitlement.currency,
          network: entitlement.network,
          status: "settled",
          createdAt: entitlement.createdAt
        })),
      proofOfStay: stay ? proofOfStayView(stay) : undefined
    };
  }

  const sandbox =
    principal?.type === "sandbox" ? principal.session : undefined;
  return {
    id: sandbox ? `ps_${sandbox.tokenHash.slice(0, 12)}` : "ps_demo",
    currency: PAYMENT_ASSET,
    backend: activeBackend(),
    network: activeNetwork(),
    authenticated: true,
    approvalModes: supportedApprovalModes(),
    limit: sandbox?.limit ?? 2,
    spent: money(sandbox?.spent ?? 0),
    remaining: money((sandbox?.limit ?? 2) - (sandbox?.spent ?? 0)),
    expiresInMinutes: 28,
    transactions: sandbox?.transactions ?? []
  };
}

async function disconnectedManagedView() {
  const view = await sessionView();
  return {
    ...view,
    id: "guest_disconnected",
    identityType: undefined,
    beneficiaryId: undefined,
    walletAddress: undefined,
    authenticated: false,
    expiresInMinutes: 0,
    proofOfStay: undefined
  };
}

export async function createXrplPaymentChallenge(
  movie: Movie,
  payTo: string,
  invoiceId?: string
) {
  return paymentService.createXrplChallenge(movie, payTo, invoiceId);
}

const handlePaymentRoute = createPaymentRouteHandler({
  service: paymentService,
  catalog,
  resolveContext: resolveServerPaymentContext,
  sessionView
});

async function hotelDashboard() {
  if (!XRPL_MERCHANT_ADDRESS) {
    throw new Error("The Ledger Lodge merchant wallet is not configured.");
  }
  return readHotelDashboard({
    store: entitlements,
    catalog,
    merchantAddress: XRPL_MERCHANT_ADDRESS,
    network: XRPL_NETWORK,
    networkLabel: activeNetwork(),
    rpc: xrplRpc
  });
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/health") {
    return json(200, { status: "ok", service: "agentcore-xrpl-demo" });
  }

  if (req.method === "POST" && pathname === "/api/wallet/challenge") {
    let body: { address?: string; publicKey?: string };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid_json" });
    }
    if (
      !body.address ||
      !body.publicKey ||
      !isValidClassicAddress(body.address) ||
      (() => {
        try {
          return deriveAddress(body.publicKey) !== body.address;
        } catch {
          return true;
        }
      })()
    ) {
      return json(400, {
        error: "invalid_wallet_identity",
        message: "The wallet adapter returned an invalid XRPL address or public key."
      });
    }

    const id = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    const expiresAt = epochSeconds() + WALLET_CHALLENGE_SECONDS;
    const message = [
      "Sign in to AgentCore XRPL Guest Commerce",
      `Origin: ${url.origin}`,
      `Network: ${XRPL_NETWORK}`,
      `Wallet: ${body.address}`,
      `Nonce: ${id}`,
      `Issued at: ${issuedAt}`,
      "This request does not submit a transaction or spend XRP."
    ].join("\n");
    await entitlements.putChallenge({
      id,
      address: body.address,
      publicKey: body.publicKey,
      network: XRPL_NETWORK,
      message,
      expiresAt
    });
    return json(200, { challengeId: id, message, expiresAt });
  }

  if (req.method === "POST" && pathname === "/api/wallet/verify") {
    let body: { challengeId?: string; signature?: string };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid_json" });
    }
    if (!body.challengeId || !body.signature) {
      return json(400, {
        error: "invalid_wallet_proof",
        message: "A challenge and XRPL wallet signature are required."
      });
    }

    const challenge = await entitlements.consumeChallenge(body.challengeId);
    if (
      !challenge ||
      challenge.expiresAt <= epochSeconds() ||
      !verifyWalletSignature(
        challenge.message,
        body.signature,
        challenge.publicKey,
        challenge.address
      )
    ) {
      return json(401, {
        error: "wallet_signature_invalid",
        message: "The wallet signature is invalid or has expired."
      });
    }

    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const walletSession: WalletSession = {
      tokenHash: await sha256(token),
      address: challenge.address,
      network: challenge.network,
      expiresAt: epochSeconds() + WALLET_SESSION_SECONDS
    };
    await entitlements.putSession(walletSession);
    return json(
      200,
      await sessionView({
        type: "wallet",
        id: walletSession.tokenHash,
        session: walletSession
      }),
      {
      "set-cookie": walletCookie(token, WALLET_SESSION_SECONDS)
      }
    );
  }

  if (req.method === "POST" && pathname === "/api/wallet/logout") {
    const wallet = await authenticatedWallet(req);
    if (wallet) {
      await entitlements.clearActiveHotelStay(
        wallet.session.address,
        wallet.session.network
      );
      await entitlements.deleteSession(wallet.session.tokenHash);
    }
    return json(200, await sessionView(), {
      "set-cookie": clearWalletCookie()
    });
  }

  if (
    req.method === "POST" &&
    (pathname === "/api/session/handoff" ||
      pathname === "/api/wallet/handoff")
  ) {
    const context = await resolveServerPaymentContext(
      req,
      "managed-existing"
    );
    if (
      context.principal?.type !== "guest" &&
      context.principal?.type !== "wallet"
    ) {
      return json(401, {
        error: "guest_session_required",
        message: "An active guest session is required to finish the kiosk."
      });
    }
    if (context.principal.type === "guest") {
      await entitlements.deleteGuestSession(context.principal.id);
    } else {
      await entitlements.deleteSession(context.principal.id);
    }
    return json(200, await disconnectedManagedView(), {
      "set-cookie":
        context.principal.type === "guest"
          ? clearGuestCookie()
          : clearWalletCookie()
    });
  }

  if (req.method === "POST" && pathname === "/api/hotel/check-in") {
    const context = await resolveServerPaymentContext(req, "managed");
    const principal = context.principal as ManagedPaymentPrincipal;
    const beneficiary = managedBeneficiary(principal);

    const stay = await assignAvailableHotelRoom(
      entitlements,
      beneficiary.id,
      beneficiary.type,
      beneficiary.network
    );
    if (!stay) {
      return json(409, {
        error: "hotel_full",
        message: "No rooms are currently available. Please try again later."
      });
    }

    return json(
      200,
      await sessionView(principal),
      context.setCookie ? { "set-cookie": context.setCookie } : undefined
    );
  }

  if (req.method === "POST" && pathname === "/api/hotel/stays/link") {
    const context = await resolveServerPaymentContext(req, "managed");
    const principal = context.principal as ManagedPaymentPrincipal;
    const beneficiary = managedBeneficiary(principal);
    const existingStay = activeHotelStay(
      await entitlements.getActiveHotelStay(
        beneficiary.id,
        beneficiary.network
      )
    );
    if (existingStay) {
      return json(409, {
        error:
          beneficiary.type === "wallet"
            ? "wallet_already_checked_in"
            : "guest_already_checked_in",
        message: `This ${beneficiary.type === "wallet" ? "wallet" : "guest session"} is already checked into room ${existingStay.roomNumber}. Check out before selecting another room.`
      });
    }
    let body: { roomNumber?: string; pin?: string };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid_json" });
    }
    if (
      !body.roomNumber ||
      !body.pin ||
      !verifyDemoRoomPin(body.roomNumber, body.pin)
    ) {
      return json(401, {
        error: "proof_of_stay_invalid",
        message:
          "That room and PIN do not match the Ledger Lodge guest list."
      });
    }
    const stay = createHotelStay(
      beneficiary.id,
      beneficiary.type,
      beneficiary.network,
      body.roomNumber
    );
    const claimed = await entitlements.claimHotelStay(stay);
    if (!claimed) {
      const activeWalletStay = activeHotelStay(
        await entitlements.getActiveHotelStay(
          beneficiary.id,
          beneficiary.network
        )
      );
      if (activeWalletStay) {
        return json(409, {
          error:
            beneficiary.type === "wallet"
              ? "wallet_already_checked_in"
              : "guest_already_checked_in",
          message: `This ${beneficiary.type === "wallet" ? "wallet" : "guest session"} is already checked into room ${activeWalletStay.roomNumber}. Check out before selecting another room.`
        });
      }
      return json(409, {
        error: "hotel_room_unavailable",
        message:
          "That room was just taken. Choose another available room."
      });
    }
    return json(
      200,
      await sessionView(principal),
      context.setCookie ? { "set-cookie": context.setCookie } : undefined
    );
  }

  if (
    req.method === "GET" &&
    pathname === "/api/hotel/rooms/available"
  ) {
    const occupiedRooms = await entitlements.listOccupiedHotelRooms(
      HOTEL_PROPERTY.id,
      new Date()
    );
    const availableRooms = availableHotelRooms(occupiedRooms);
    return json(200, {
      propertyId: HOTEL_PROPERTY.id,
      totalRooms: HOTEL_ROOM_NUMBERS.length,
      availableRooms
    });
  }

  if (req.method === "GET" && pathname === "/api/hotel/dashboard") {
    try {
      return json(200, await hotelDashboard());
    } catch (error) {
      console.error(error);
      return json(502, {
        error: "hotel_ledger_unavailable",
        message:
          error instanceof Error
            ? error.message
            : "The Ledger Lodge ledger could not be read."
      });
    }
  }

  if (req.method === "POST" && pathname === "/api/agent") {
    const paymentContext = await resolveServerPaymentContext(
      req,
      activeBackend() === "xrpl" ? "managed" : "sandbox"
    );
    const principal = paymentContext.principal;
    const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
    if (!agentRuntimeArn) {
      return json(503, {
        error: "agent_runtime_not_configured",
        message:
          "Deploy the CDK stack or set AGENT_RUNTIME_ARN before invoking the concierge."
      });
    }

    let body: AgentInvocation;
    try {
      body = parseAgentInvocation(await req.json());
    } catch (error) {
      return json(400, {
        error: "invalid_invocation",
        message: error instanceof Error ? error.message : "Invalid invocation."
      });
    }
    const agentMode = body.agentMode || "concierge";
    if (!AGENT_MODES.includes(agentMode)) {
      return json(400, {
        error: "invalid_agent_mode",
        message:
          'Agent mode must be "concierge", "devops", or "security".'
      });
    }
    if (
      agentMode === "concierge" &&
      activeBackend() === "xrpl" &&
      (principal?.type === "wallet" || principal?.type === "guest") &&
      !activeHotelStay(
        await entitlements.getActiveHotelStay(
          managedBeneficiary(principal).id,
          managedBeneficiary(principal).network
        )
      )
    ) {
      return json(428, {
        error: "proof_of_stay_required",
        message:
          "Complete Proof of Stay at Ledger Lodge before using the concierge."
      });
    }
    if (agentMode !== "concierge" && body.approvePayment) {
      return json(400, {
        error: "payment_not_allowed",
        message: "Operations specialist requests cannot approve payments."
      });
    }

    const runtimeSessionId =
      body.sessionId && body.sessionId.length >= 33
        ? body.sessionId
        : `agentcore-xrpl-session-${crypto.randomUUID()}`;
    const runtimeActorId =
      principal?.type === "wallet" || principal?.type === "guest"
        ? `beneficiary:${managedBeneficiary(principal).network}:${managedBeneficiary(principal).id}`
        : `anonymous:${runtimeSessionId}`;
    const paymentDelegationToken =
      agentMode === "concierge" && principal
        ? await createPaymentDelegation(principal, entitlements)
        : undefined;
    const invocation: AgentInvocation = {
      prompt: body.prompt,
      agentMode,
      actorId: runtimeActorId,
      sessionId: runtimeSessionId,
      includeMemoryDetails:
        principal?.type === "wallet" || principal?.type === "guest",
      approvePayment: body.approvePayment === true,
      paymentSessionId: body.paymentSessionId,
      paymentInstrumentId: body.paymentInstrumentId,
      paymentDelegationToken
    };
    try {
      const invocationStartedAt = performance.now();
      const response = await agentcore.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn,
          qualifier: process.env.AGENT_RUNTIME_QUALIFIER || "live",
          runtimeSessionId,
          runtimeUserId: runtimeActorId,
          contentType: "application/json",
          accept: "application/json",
          payload: new TextEncoder().encode(
            JSON.stringify({
              ...invocation
            })
          )
        })
      );

      if (!response.response) {
        return json(502, {
          error: "empty_agent_response"
        });
      }

      const bytes = await response.response.transformToByteArray();
      const result = JSON.parse(new TextDecoder().decode(bytes));
      return json(
        response.statusCode || 200,
        {
          ...result,
          runtimeSessionId: response.runtimeSessionId || runtimeSessionId,
          traceId: response.traceId,
          runtimeDurationMs: Math.max(
            0,
            Math.round(performance.now() - invocationStartedAt)
          )
        },
        paymentContext.setCookie
          ? { "set-cookie": paymentContext.setCookie }
          : undefined
      );
    } catch (error) {
      console.error(error);
      return json(502, {
        error: "agent_invocation_failed",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  if (req.method === "GET" && pathname === "/api/catalog") {
    return json(200, { catalog });
  }

  if (req.method === "GET" && pathname === "/api/session") {
    const context = await resolveServerPaymentContext(
      req,
      activeBackend() === "xrpl" ? "managed" : "sandbox"
    );
    return json(
      200,
      await sessionView(context.principal),
      context.setCookie ? { "set-cookie": context.setCookie } : undefined
    );
  }

  if (req.method === "POST" && pathname === "/api/session/reset") {
    const context = await resolveServerPaymentContext(
      req,
      activeBackend() === "xrpl" ? "managed" : "sandbox"
    );
    if (activeBackend() === "xrpl") {
      if (
        context.principal?.type === "wallet" ||
        context.principal?.type === "guest"
      ) {
        const beneficiary = managedBeneficiary(context.principal);
        await entitlements.clearActiveHotelStay(
          beneficiary.id,
          beneficiary.network
        );
        if (context.principal.type === "guest") {
          await entitlements.deleteGuestSession(context.principal.id);
        } else {
          await entitlements.deleteSession(context.principal.id);
        }
      }
      const replacement = await resolveServerPaymentContext(
        new Request(req.url),
        "managed"
      );
      return json(
        200,
        await sessionView(replacement.principal),
        replacement.setCookie
          ? { "set-cookie": replacement.setCookie }
          : undefined
      );
    }
    if (context.principal?.type === "sandbox") {
      context.principal.session.spent = 0;
      context.principal.session.transactions = [];
      context.principal.session.proofs = {};
      await entitlements.putSandboxSession(context.principal.session);
    }
    return json(
      200,
      await sessionView(context.principal),
      context.setCookie ? { "set-cookie": context.setCookie } : undefined
    );
  }

  const paymentRouteResponse = await handlePaymentRoute(req, url);
  if (paymentRouteResponse) return paymentRouteResponse;

  if (pathname.startsWith("/api/")) {
    return json(404, { error: "API route not found" });
  }

  if (pathname === "/favicon.ico") {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "public, max-age=86400"
      }
    });
  }

  return new Response("Not found", { status: 404 });
}

export async function reconcileXrplSettlements(
  correlationId = crypto.randomUUID()
) {
  return paymentService.reconcile(catalog, correlationId);
}

export function startXrplReconciliationWorker(
  intervalSeconds = Number(
    process.env.XRPL_RECONCILIATION_INTERVAL_SECONDS || "30"
  )
) {
  if (
    activeBackend() !== "xrpl" ||
    PAYMENT_ASSET !== "XRP" ||
    !XRPL_MERCHANT_ADDRESS
  ) {
    return () => {};
  }
  if (
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds < 5 ||
    intervalSeconds > 3600
  ) {
    throw new Error(
      "XRPL_RECONCILIATION_INTERVAL_SECONDS must be between 5 and 3600."
    );
  }
  let running = false;
  const reconcile = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileXrplSettlements();
    } catch (error) {
      console.error("XRPL reconciliation failed.", error);
    } finally {
      running = false;
    }
  };
  void reconcile();
  const timer = setInterval(reconcile, intervalSeconds * 1000);
  return () => clearInterval(timer);
}

export function createServer(port = PORT) {
  return Bun.serve({
    port,
    routes: {
      "/": appHtml,
      "/index.html": appHtml
    },
    fetch: handleRequest,
    development: process.env.NODE_ENV === "development",
    error(error) {
      console.error(error);
      return json(500, { error: "Internal server error" });
    }
  });
}

if (import.meta.main) {
  const server = createServer();
  startXrplReconciliationWorker();
  console.log(`AgentCore XRPL Guest Commerce is running at ${server.url}`);
}
