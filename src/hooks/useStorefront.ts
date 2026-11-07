// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { isAgentResponse } from "../lib/contracts";
import { usePaymentFlow } from "./usePaymentFlow";
import type {
  AgentInspection,
  AgentMode,
  AgentResponse,
  HotelDashboard,
  HotelRoomAvailability,
  Movie,
  MovieCuration,
  PaymentSession,
  ToastMessage
} from "../types";

export { isAgentResponse } from "../lib/contracts";

export function createMovieCuration(
  body: AgentResponse,
  prompt: string,
  catalog: Movie[]
): MovieCuration | null {
  const action = body.action;
  if (
    action?.status !== "recommendations_ready" ||
    !action.recommendations?.length
  ) {
    return null;
  }
  const recommendations = action.recommendations.flatMap(
    (recommendation) => {
      const movie = catalog.find(
        (item) => item.id === recommendation.titleId
      );
      return movie ? [{ movie, reason: recommendation.reason }] : [];
    }
  );
  if (!recommendations.length) return null;

  return {
    prompt,
    summary:
      action.summary ||
      body.message ||
      "A few titles selected for your request.",
    memoryInfluenced: action.memoryInfluenced === true,
    recommendations,
    createdAt: new Date().toISOString()
  };
}

function findMovie(catalog: Movie[], query: string) {
  const normalized = query.toLowerCase().trim();
  return (
    catalog.find((movie) => normalized.includes(movie.title.toLowerCase())) ||
    catalog.find((movie) =>
      movie.title
        .toLowerCase()
        .split(" ")
        .some((word) => word.length > 3 && normalized.includes(word))
    )
  );
}

export function useStorefront() {
  const [catalog, setCatalog] = useState<Movie[]>([]);
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentInspection, setAgentInspection] =
    useState<AgentInspection | null>(null);
  const [curation, setCuration] = useState<MovieCuration | null>(null);
  const [hotelDashboard, setHotelDashboard] =
    useState<HotelDashboard | null>(null);
  const [hotelDashboardBusy, setHotelDashboardBusy] = useState(false);
  const [hotelDashboardError, setHotelDashboardError] =
    useState<string | null>(null);
  const [stayBusy, setStayBusy] = useState(false);
  const [stayError, setStayError] = useState<string | null>(null);
  const [hotelRoomAvailability, setHotelRoomAvailability] =
    useState<HotelRoomAvailability | null>(null);
  const [hotelRoomAvailabilityBusy, setHotelRoomAvailabilityBusy] =
    useState(false);
  const [hotelRoomAvailabilityError, setHotelRoomAvailabilityError] =
    useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nextToastId = useRef(0);
  const toastTimers = useRef(new Set<number>());
  const latestAgentRequest = useRef(0);
  const actorId = useRef(
    `agentcore-xrpl-web-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const addToast = useCallback((label: string, message: string) => {
    const id = ++nextToastId.current;
    setToasts((current) => [...current, { id, label, message }]);
    const timer = window.setTimeout(() => {
      toastTimers.current.delete(timer);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
    toastTimers.current.add(timer);
  }, []);
  const payment = usePaymentFlow({
    session,
    setSession,
    setAgentBusy,
    setAgentInspection,
    addToast
  });

  useEffect(() => {
    let active = true;
    Promise.all([api.getCatalog(), api.getSession()])
      .then(([catalogResult, sessionResult]) => {
        if (!active) return;
        setCatalog(catalogResult.body.catalog);
        setSession(sessionResult.body);
      })
      .catch((cause) => {
        if (!active) return;
        console.error(cause);
        setError("Could not connect to the Proof of Stay service.");
      });
    return () => {
      active = false;
      for (const timer of toastTimers.current) window.clearTimeout(timer);
      toastTimers.current.clear();
    };
  }, []);

  const finishKioskSession = useCallback(async () => {
    setStayBusy(true);
    try {
      const result = await api.finishKioskSession();
      if (
        !result.response.ok ||
        !("authenticated" in result.body)
      ) {
        const message =
          "message" in result.body ? result.body.message : undefined;
        addToast(
          "Kiosk handoff blocked:",
          message || "The kiosk session could not be cleared."
        );
        return false;
      }
      setSession(result.body);
      payment.clear();
      setAgentInspection(null);
      setCuration(null);
      addToast(
        "Kiosk cleared:",
        "This device session is cleared. The room remains occupied until checkout."
      );
      return true;
    } catch (cause) {
      addToast(
        "Kiosk handoff blocked:",
        cause instanceof Error
          ? cause.message
          : "The kiosk session could not be cleared."
      );
      return false;
    } finally {
      setStayBusy(false);
    }
  }, [addToast, payment.clear]);

  const refreshHotelRoomAvailability = useCallback(async () => {
    setHotelRoomAvailabilityBusy(true);
    setHotelRoomAvailabilityError(null);
    try {
      const result = await api.getAvailableHotelRooms();
      setHotelRoomAvailability(result.body);
    } catch (cause) {
      setHotelRoomAvailabilityError(
        cause instanceof Error
          ? cause.message
          : "Ledger Lodge could not load available rooms."
      );
    } finally {
      setHotelRoomAvailabilityBusy(false);
    }
  }, []);

  useEffect(() => {
    if (
      session?.backend === "xrpl" &&
      !session.proofOfStay
    ) {
      void refreshHotelRoomAvailability();
    } else {
      setHotelRoomAvailability(null);
      setHotelRoomAvailabilityError(null);
    }
  }, [
    refreshHotelRoomAvailability,
    session?.authenticated,
    session?.backend,
    session?.proofOfStay?.stayRef
  ]);

  const checkInHotel = useCallback(async () => {
    setStayBusy(true);
    setStayError(null);
    try {
      const result = await api.checkInHotel();
      if (
        !result.response.ok ||
        !("authenticated" in result.body)
      ) {
        const message =
          "message" in result.body ? result.body.message : undefined;
        setStayError(message || "Ledger Lodge could not assign a room.");
        if (result.response.status === 409) {
          void refreshHotelRoomAvailability();
        }
        return false;
      }
      setSession(result.body);
      addToast(
        "Check-in complete:",
        `Room ${result.body.proofOfStay?.roomNumber} is linked to this guest session until 11:00 AM checkout.`
      );
      return true;
    } catch (cause) {
      setStayError(
        cause instanceof Error
          ? cause.message
          : "Ledger Lodge could not assign a room."
      );
      return false;
    } finally {
      setStayBusy(false);
    }
  }, [addToast, refreshHotelRoomAvailability]);

  const linkHotelStay = useCallback(
    async (roomNumber: string, pin: string) => {
      setStayBusy(true);
      setStayError(null);
      try {
        const result = await api.linkHotelStay({ roomNumber, pin });
        if (
          !result.response.ok ||
          !("authenticated" in result.body)
        ) {
          const message =
            "message" in result.body
              ? result.body.message
              : undefined;
          setStayError(
            message || "Ledger Lodge could not verify that room."
          );
          if (result.response.status === 409) {
            void refreshHotelRoomAvailability();
          }
          return false;
        }
        setSession(result.body);
        addToast(
          "Proof of Stay:",
          `Guest session linked to Ledger Lodge room ${result.body.proofOfStay?.roomNumber}.`
        );
        return true;
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Proof of Stay failed.";
        setStayError(message);
        return false;
      } finally {
        setStayBusy(false);
      }
    },
    [addToast, refreshHotelRoomAvailability]
  );

  const refreshHotelDashboard = useCallback(async () => {
    setHotelDashboardBusy(true);
    setHotelDashboardError(null);
    try {
      const result = await api.getHotelDashboard();
      if (
        !result.response.ok ||
        !("propertyName" in result.body)
      ) {
        const message =
          "message" in result.body
            ? result.body.message
            : undefined;
        setHotelDashboardError(
          message || "Ledger Lodge could not read its wallet history."
        );
        return;
      }
      setHotelDashboard(result.body);
    } catch (cause) {
      setHotelDashboardError(
        cause instanceof Error
          ? cause.message
          : "Ledger Lodge could not read its wallet history."
      );
    } finally {
      setHotelDashboardBusy(false);
    }
  }, []);

  const handleAgentResponse = useCallback(
    async (
      body: AgentResponse,
      prompt: string,
      fallbackMovie?: Movie
    ) => {
      const action = body.action;
      if (
        action?.status === "payment_confirmation_required" &&
        action.paymentRequired
      ) {
        const titleId = action.paymentRequired.challenge.resource.url
          .match(/^\/api\/titles\/([^/]+)\/stream$/)?.[1];
        const movie =
          catalog.find((item) => item.id === titleId) || fallbackMovie;
        if (!movie) {
          addToast(
            "AgentCore:",
            "A payment was requested for a title that is not in the local catalog."
          );
          return;
        }

        payment.presentPayment(
          {
            movie,
            challenge: action.paymentRequired.challenge,
            prompt,
            actorId: body.actorId,
            runtimeSessionId: body.runtimeSessionId || body.sessionId
          },
          action.paymentRequired.session
        );
        addToast("AgentCore:", body.message);
        return;
      }

      if (action?.status === "playback_unlocked" && action.playback) {
        const sessionResult = await api.getSession();
        setSession(sessionResult.body);
        payment.presentPlayback(action.playback);
        addToast("AgentCore:", body.message);
        return;
      }

      if (action?.status === "recommendations_ready") {
        const nextCuration = createMovieCuration(body, prompt, catalog);
        if (!nextCuration) {
          addToast(
            "AgentCore:",
            "The concierge returned recommendations outside the current catalog."
          );
          return;
        }
        setCuration(nextCuration);
        addToast(
          "For You:",
          `${nextCuration.recommendations.length} selectable recommendations are ready.`
        );
        return;
      }

      addToast("AgentCore:", body.message || action?.message || "Request completed.");
    },
    [addToast, catalog, payment.presentPayment, payment.presentPlayback]
  );

  const invokeAgent = useCallback(
    async (
      prompt: string,
      fallbackMovie?: Movie,
      agentMode: AgentMode = "concierge"
    ) => {
      const requestId = ++latestAgentRequest.current;
      setAgentBusy(true);
      try {
        const result = await api.invokeAgent({
          prompt,
          actorId: actorId.current,
          approvePayment: false,
          agentMode
        });
        if (requestId !== latestAgentRequest.current) return;
        if (!result.response.ok || !isAgentResponse(result.body)) {
          const failure = result.body as { message?: string };
          addToast(
            "AgentCore error:",
            failure.message || "The concierge could not complete the request."
          );
          return;
        }
        setAgentInspection({
          prompt,
          capturedAt: new Date().toISOString(),
          response: result.body
        });
        await handleAgentResponse(result.body, prompt, fallbackMovie);
      } finally {
        if (requestId === latestAgentRequest.current) {
          setAgentBusy(false);
        }
      }
    },
    [addToast, handleAgentResponse]
  );

  const requestOpsAgent = useCallback(
    async (
      mode: Exclude<AgentMode, "concierge">,
      prompt: string
    ) => {
      const request = prompt.trim();
      if (!request) {
        addToast("Ops Copilot:", "Enter an investigation request.");
        return;
      }
      addToast(
        "Supervisor:",
        `Routing this request to the ${mode === "devops" ? "DevOps" : "Security"} specialist…`
      );
      await invokeAgent(request, undefined, mode);
      window.setTimeout(() => {
        document
          .getElementById("agent-inspector")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    },
    [addToast, invokeAgent]
  );

  const requestPlayback = useCallback(
    async (titleId: string) => {
      const movie = catalog.find((item) => item.id === titleId);
      if (!movie) return;
      const activeSession = session;
      if (!activeSession) {
        addToast("Guest session unavailable:", "Reload the page and try again.");
        return;
      }
      if (
        activeSession.backend === "xrpl" &&
        !activeSession.proofOfStay
      ) {
        addToast(
          "Proof of Stay required:",
          "Open the Check In tab and assign this guest session a room before purchasing a movie."
        );
        return;
      }
      addToast("Agent:", `Asking AgentCore to play ${movie.title}…`);
      await invokeAgent(`Play ${movie.title}`, movie);
    },
    [addToast, catalog, invokeAgent, session]
  );

  const requestByQuery = useCallback(
    async (query: string) => {
      const prompt = query.trim();
      if (!prompt) {
        addToast("Agent:", "Enter a request such as “Play Afterlight.”");
        return;
      }
      const activeSession = session;
      if (!activeSession) {
        addToast("Guest session unavailable:", "Reload the page and try again.");
        return;
      }
      if (
        activeSession.backend === "xrpl" &&
        !activeSession.proofOfStay
      ) {
        addToast(
          "Proof of Stay required:",
          "Open the Check In tab and assign this guest session a room before asking the concierge."
        );
        return;
      }
      addToast("Agent:", "Sending your request to AgentCore Runtime…");
      await invokeAgent(prompt, findMovie(catalog, prompt));
    },
    [
      addToast,
      catalog,
      invokeAgent,
      session
    ]
  );

  const resetDemo = useCallback(async () => {
    const result = await api.resetSession();
    setSession(result.body);
    payment.clear();
    setAgentInspection(null);
    setCuration(null);
    addToast("Demo reset:", "Payment activity and the active session were reset.");
  }, [addToast, payment.clear]);

  const featuredMovie = useMemo(
    () => catalog.find((movie) => movie.featured) || catalog[0],
    [catalog]
  );

  return {
    catalog,
    session,
    featuredMovie,
    pendingPurchase: payment.pendingPurchase,
    playback: payment.playback,
    paymentStatus: payment.status,
    paymentError: payment.error,
    agentBusy,
    agentInspection,
    curation,
    hotelDashboard,
    hotelDashboardBusy,
    hotelDashboardError,
    stayBusy,
    stayError,
    hotelRoomAvailability,
    hotelRoomAvailabilityBusy,
    hotelRoomAvailabilityError,
    toasts,
    error,
    requestPlayback,
    requestByQuery,
    requestOpsAgent,
    resolvePayment: payment.resolvePayment,
    finishKioskSession,
    checkInHotel,
    linkHotelStay,
    refreshHotelRoomAvailability,
    refreshHotelDashboard,
    resetDemo,
    closePayment: payment.closePayment,
    closePlayer: payment.closePlayer
  };
}
