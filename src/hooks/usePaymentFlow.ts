// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../lib/api";
import { isAgentResponse } from "../lib/contracts";
import type {
  AgentInspection,
  PaymentSession,
  PaymentStatus,
  PendingPurchase,
  PlaybackResponse
} from "../types";

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

interface PaymentFlowOptions {
  session: PaymentSession | null;
  setSession: Dispatch<SetStateAction<PaymentSession | null>>;
  setAgentBusy: Dispatch<SetStateAction<boolean>>;
  setAgentInspection: Dispatch<SetStateAction<AgentInspection | null>>;
  addToast: (label: string, message: string) => void;
}

export function usePaymentFlow({
  session,
  setSession,
  setAgentBusy,
  setAgentInspection,
  addToast
}: PaymentFlowOptions) {
  const [pendingPurchase, setPendingPurchase] =
    useState<PendingPurchase | null>(null);
  const [playback, setPlayback] = useState<PlaybackResponse | null>(null);
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const presentPayment = useCallback(
    (purchase: PendingPurchase, paymentSession: PaymentSession) => {
      setSession(paymentSession);
      setError(null);
      setPendingPurchase(purchase);
    },
    [setSession]
  );

  const presentPlayback = useCallback((value: PlaybackResponse) => {
    setPendingPurchase(null);
    setStatus("idle");
    setPlayback(value);
  }, []);

  const clear = useCallback(() => {
    setPendingPurchase(null);
    setPlayback(null);
    setStatus("idle");
    setError(null);
  }, []);

  const resolvePayment = useCallback(async () => {
    if (!pendingPurchase || !session) return;
    const purchase = pendingPurchase;
    setError(null);
    setStatus("signing");
    await wait(700);

    setAgentBusy(true);
    try {
      const result = await api.invokeAgent({
        prompt: purchase.prompt,
        actorId: purchase.actorId,
        sessionId: purchase.runtimeSessionId,
        approvePayment: true
      });
      if (!result.response.ok || !isAgentResponse(result.body)) {
        const body = result.body as { message?: string };
        setStatus("idle");
        addToast(
          "Payment blocked:",
          body.message || "AgentCore Runtime could not approve the payment."
        );
        return;
      }
      setAgentInspection({
        prompt: purchase.prompt,
        capturedAt: new Date().toISOString(),
        response: result.body
      });
      if (
        result.body.action?.status === "playback_unlocked" &&
        result.body.action.playback
      ) {
        const sessionResult = await api.getSession();
        setSession(sessionResult.body);
        setStatus("settled");
        addToast(
          "Settled:",
          `${purchase.movie.price.toFixed(2)} ${session.currency} approved through AgentCore Runtime.`
        );
        await wait(650);
        presentPlayback(result.body.action.playback);
        return;
      }
      setStatus("idle");
      addToast(
        "Payment blocked:",
        result.body.action?.message ||
          result.body.message ||
          "The Runtime did not unlock playback."
      );
    } finally {
      setAgentBusy(false);
    }
  }, [
    addToast,
    pendingPurchase,
    presentPlayback,
    session,
    setAgentBusy,
    setAgentInspection,
    setSession
  ]);

  return {
    pendingPurchase,
    playback,
    status,
    error,
    presentPayment,
    presentPlayback,
    resolvePayment,
    closePayment: () => {
      setPendingPurchase(null);
      setStatus("idle");
      setError(null);
    },
    closePlayer: () => setPlayback(null),
    clear
  };
}
