// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { encodePaymentRequiredHeader } from "@x402/core/http";
import type {
  PaymentRequired,
  PaymentRequirements
} from "@x402/core/types";
import type { Payment } from "xrpl";
import type { Movie, PaymentChallenge } from "../src/types";
import { jsonResponse } from "./http";
import {
  playbackResponse,
  type ManagedPaymentPrincipal,
  type PaymentService
} from "./paymentService";
import {
  requestCorrelationId
} from "./paymentTelemetry";
import type {
  PaymentContext,
  PaymentContextMode,
  PaymentPrincipal
} from "./paymentContext";
import { epochSeconds } from "./paymentContext";

export interface PaymentRouteDependencies {
  readonly service: PaymentService;
  readonly catalog: Movie[];
  readonly resolveContext: (
    request: Request,
    mode: PaymentContextMode
  ) => Promise<PaymentContext>;
  readonly sessionView: (
    principal?: PaymentPrincipal
  ) => Promise<Record<string, any>>;
}

export function createSettledPlaybackResponse(
  movie: Movie,
  transactionId: string
) {
  return jsonResponse(200, playbackResponse(movie, transactionId));
}

export function createPaymentRouteHandler({
  service,
  catalog,
  resolveContext,
  sessionView
}: PaymentRouteDependencies) {
  const requireXrplBackend = () =>
    service.config.asset === "XRP" &&
    service.config.backend === "xrpl";

  return async function handlePaymentRoute(
    request: Request,
    url = new URL(request.url)
  ): Promise<Response | undefined> {
    const pathname = url.pathname;

    if (request.method === "POST" && pathname === "/api/xrpl/prepare") {
      const correlationId = requestCorrelationId(request);
      if (!requireXrplBackend()) {
        return jsonResponse(409, {
          error: "xrpl_backend_required",
          message:
            "The storefront is not configured for direct XRPL payments."
        });
      }
      const context = await resolveContext(request, "wallet");
      if (context.principal?.type !== "wallet") {
        return jsonResponse(401, {
          error: "wallet_authentication_required",
          message:
            "Connect and sign in with an approved XRPL wallet adapter before preparing payment."
        });
      }

      let body: {
        transaction?: Payment;
        requirements?: PaymentRequirements;
      };
      try {
        body = await request.json();
      } catch {
        return jsonResponse(400, { error: "invalid_json" });
      }

      const result = await service.prepareWalletPayment(
        body.transaction,
        body.requirements,
        context.principal.session,
        correlationId
      );
      return result.ok
        ? jsonResponse(200, { transaction: result.value })
        : jsonResponse(result.status, result.body);
    }

    if (request.method === "POST" && pathname === "/api/xrpl/recover") {
      const correlationId = requestCorrelationId(request);
      if (!requireXrplBackend()) {
        return jsonResponse(409, {
          error: "xrpl_backend_required",
          message:
            "The storefront is not configured for direct XRPL payments."
        });
      }
      const context = await resolveContext(request, "managed");
      if (
        context.principal?.type !== "wallet" &&
        context.principal?.type !== "guest"
      ) {
        return jsonResponse(401, {
          error: "guest_session_required",
          message: "Use the guest session that requested this payment."
        });
      }

      let body: { titleId?: string; transactionId?: string };
      try {
        body = await request.json();
      } catch {
        return jsonResponse(400, { error: "invalid_json" });
      }
      const movie = catalog.find((item) => item.id === body.titleId);
      if (!movie || !body.transactionId) {
        return jsonResponse(400, {
          error: "invalid_recovery_request",
          message: "A valid titleId and transactionId are required."
        });
      }

      try {
        const transaction = await service.recover(
          movie,
          body.transactionId,
          context.principal,
          correlationId
        );
        return jsonResponse(200, {
          status: "settled",
          transaction,
          session: await sessionView(context.principal),
          playback: playbackResponse(movie, transaction.id)
        });
      } catch (error) {
        console.error(error);
        return jsonResponse(400, {
          error: "xrpl_recovery_failed",
          message:
            error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    const streamMatch = pathname.match(
      /^\/api\/titles\/([^/]+)\/stream$/
    );
    if (request.method === "GET" && streamMatch) {
      const correlationId = requestCorrelationId(request);
      const movie = catalog.find((item) => item.id === streamMatch[1]);
      if (!movie) {
        return jsonResponse(404, { error: "Title not found" });
      }

      const context = await resolveContext(
        request,
        service.config.backend === "xrpl" ? "managed" : "sandbox"
      );
      const principal = context.principal;
      const transactionId = url.searchParams.get("transactionId");
      const managedPrincipal =
        principal?.type === "wallet" || principal?.type === "guest"
          ? principal
          : undefined;
      const existingEntitlement = managedPrincipal
        ? await service.getEntitlement(managedPrincipal, movie.id)
        : undefined;
      if (
        existingEntitlement &&
        existingEntitlement.expiresAt > epochSeconds() &&
        (!transactionId ||
          transactionId.toUpperCase() ===
            existingEntitlement.transactionId.toUpperCase())
      ) {
        return jsonResponse(
          200,
          playbackResponse(movie, existingEntitlement.transactionId)
        );
      }

      const sandbox =
        principal?.type === "sandbox" ? principal.session : undefined;
      const settledTransaction = transactionId
        ? sandbox?.transactions.find(
            (transaction) =>
              transaction.id === transactionId &&
              transaction.titleId === movie.id &&
              transaction.status === "settled"
          )
        : undefined;
      if (service.config.backend !== "xrpl" && settledTransaction) {
        return jsonResponse(
          200,
          playbackResponse(movie, settledTransaction.id)
        );
      }

      const sandboxEntitlement = sandbox?.transactions.find(
        (transaction) =>
          transaction.titleId === movie.id &&
          transaction.status === "settled"
      );
      if (service.config.backend !== "xrpl" && sandboxEntitlement) {
        return jsonResponse(
          200,
          playbackResponse(movie, sandboxEntitlement.id)
        );
      }

      const proof = request.headers.get("x-payment");
      const payment = proof && sandbox ? sandbox.proofs[proof] : undefined;
      if (payment?.titleId === movie.id) {
        return jsonResponse(
          200,
          playbackResponse(movie, payment.transactionId)
        );
      }

      const signature = request.headers.get("payment-signature");
      if (signature && requireXrplBackend() && managedPrincipal) {
        try {
          const result = await service.settle(
            signature,
            movie,
            managedPrincipal,
            correlationId
          );
          if (result.ok) {
            return createSettledPlaybackResponse(
              movie,
              result.value.id
            );
          }
          return jsonResponse(result.status, {
            ...result.body,
            ...(result.includeSession
              ? { session: await sessionView(managedPrincipal) }
              : {})
          });
        } catch (error) {
          console.error(error);
          return jsonResponse(402, {
            error: "xrpl_payment_failed",
            message:
              error instanceof Error ? error.message : "Unknown error"
          });
        }
      }

      let challenge: PaymentChallenge;
      try {
        challenge = await service.createChallenge(
          movie,
          principal,
          correlationId
        );
      } catch (error) {
        return jsonResponse(503, {
          error: "payment_backend_not_configured",
          message:
            error instanceof Error ? error.message : "Unknown error"
        });
      }

      await service.recordApprovalRequested(
        movie,
        challenge,
        managedPrincipal,
        correlationId
      );
      return jsonResponse(
        402,
        {
          error: "payment_required",
          message: `Payment is required to stream ${movie.title}.`,
          challenge,
          session: await sessionView(principal)
        },
        {
          "payment-required": encodePaymentRequiredHeader(
            challenge as PaymentRequired
          ),
          ...(context.setCookie ? { "set-cookie": context.setCookie } : {})
        }
      );
    }

    if (
      request.method === "POST" &&
      pathname === "/api/payments/resolve"
    ) {
      if (service.config.backend !== "sandbox") {
        return jsonResponse(409, {
          error: "wallet_signature_required",
          message:
            service.config.backend === "xrpl"
              ? "Direct XRPL payments require AgentCore Runtime approval or a signed x402 payload from a supported browser wallet."
              : "AgentCore Payments mode must be approved through an AgentCore payment session and instrument."
        });
      }

      let body: { titleId?: string; challenge?: unknown };
      try {
        body = await request.json();
      } catch {
        return jsonResponse(400, { error: "invalid_json" });
      }

      const movie = catalog.find((item) => item.id === body.titleId);
      if (!movie) {
        return jsonResponse(404, { error: "title_not_found" });
      }
      const context = await resolveContext(request, "sandbox");
      if (context.principal?.type !== "sandbox") {
        return jsonResponse(401, {
          error: "payment_session_required"
        });
      }

      try {
        const result = await service.resolveSandboxPayment(
          context.principal,
          movie
        );
        if (!result.ok) {
          return jsonResponse(result.status, {
            ...result.body,
            ...(result.includeSession
              ? {
                  session: await sessionView({
                    type: "sandbox",
                    id: context.principal.id,
                    session: await service.currentSandboxSession(
                      context.principal
                    )
                  })
                }
              : {})
          });
        }
        return jsonResponse(
          200,
          {
            status: "settled",
            proof: result.value.proof,
            transaction: result.value.transaction,
            session: await sessionView({
              type: "sandbox",
              id: result.value.session.tokenHash,
              session: result.value.session
            })
          },
          context.setCookie
            ? { "set-cookie": context.setCookie }
            : undefined
        );
      } catch (error) {
        return jsonResponse(409, {
          error: "payment_in_progress",
          message:
            error instanceof Error ? error.message : "Payment is busy."
        });
      }
    }

    return undefined;
  };
}
