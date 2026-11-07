// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useState } from "react";
import { ActivitySection } from "./components/ActivitySection";
import { AgentInspector } from "./components/AgentInspector";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { HotelCheckIn } from "./components/HotelCheckIn";
import { HotelDashboard } from "./components/HotelDashboard";
import { MovieCollection } from "./components/MovieCollection";
import { OpsCopilot } from "./components/OpsCopilot";
import { PaymentSheet } from "./components/PaymentSheet";
import { PlayerModal } from "./components/PlayerModal";
import { RequestBar } from "./components/RequestBar";
import { RecommendationDialog } from "./components/RecommendationDialog";
import { ToastRegion } from "./components/ToastRegion";
import { useStorefront } from "./hooks/useStorefront";
import type { DemoArea, Movie } from "./types";

export function App() {
  const storefront = useStorefront();
  const [area, setArea] = useState<DemoArea>(() => {
    if (typeof window === "undefined") return "storefront";
    if (window.location.hash === "#operations") return "operations";
    if (window.location.hash === "#hotel") return "hotel";
    if (window.location.hash === "#checkin") return "checkin";
    return "storefront";
  });
  const [trailerMovie, setTrailerMovie] = useState<Movie>();
  const [recommendationsOpen, setRecommendationsOpen] = useState(false);
  const modalOpen = Boolean(
    storefront.pendingPurchase ||
      storefront.playback ||
      trailerMovie ||
      recommendationsOpen
  );

  useEffect(() => {
    setRecommendationsOpen(Boolean(storefront.curation));
  }, [storefront.curation?.createdAt]);

  const selectArea = useCallback(
    (nextArea: DemoArea) => {
      setArea(nextArea);
      setRecommendationsOpen(false);
      if (typeof window !== "undefined") {
        window.history.replaceState(
          null,
          "",
          nextArea === "operations"
            ? "#operations"
            : nextArea === "hotel"
              ? "#hotel"
              : nextArea === "checkin"
                ? "#checkin"
              : "#storefront"
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    []
  );

  useEffect(() => {
    const selectHashArea = () =>
      setArea(() => {
        if (window.location.hash === "#operations") return "operations";
        if (window.location.hash === "#hotel") return "hotel";
        if (window.location.hash === "#checkin") return "checkin";
        return "storefront";
      });
    window.addEventListener("hashchange", selectHashArea);
    return () => window.removeEventListener("hashchange", selectHashArea);
  }, []);

  useEffect(() => {
    document.body.style.overflow = modalOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [modalOpen]);

  useEffect(() => {
    if (area === "hotel" && !storefront.hotelDashboardBusy) {
      void storefront.refreshHotelDashboard();
    }
  }, [area]);

  useEffect(() => {
    const closeModal = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (storefront.pendingPurchase) storefront.closePayment();
      if (storefront.playback) storefront.closePlayer();
      if (trailerMovie) setTrailerMovie(undefined);
      if (recommendationsOpen) setRecommendationsOpen(false);
    };
    document.addEventListener("keydown", closeModal);
    return () => document.removeEventListener("keydown", closeModal);
  }, [
    storefront.closePayment,
    storefront.closePlayer,
    storefront.pendingPurchase,
    storefront.playback,
    trailerMovie,
    recommendationsOpen
  ]);

  if (storefront.error) {
    return (
      <main className="loading-screen">
        <p className="section-kicker">DEMO IS OFFLINE</p>
        <h1>{storefront.error}</h1>
        <p>Start the Bun server and refresh the page.</p>
      </main>
    );
  }

  if (!storefront.session || !storefront.featuredMovie) {
    return (
      <main className="loading-screen" aria-label="Loading Proof of Stay">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p>Preparing your payment session…</p>
      </main>
    );
  }

  return (
    <>
      <div className="noise" />
      <Header
        area={area}
        inspectionAvailable={Boolean(storefront.agentInspection)}
        remaining={storefront.session.remaining}
        currency={storefront.session.currency}
        backend={storefront.session.backend}
        walletAddress={storefront.session.walletAddress}
        authenticated={storefront.session.authenticated}
        proofOfStay={storefront.session.proofOfStay}
        onAreaChange={selectArea}
      />
      {area === "storefront" ? (
        <main>
          <Hero
            movie={storefront.featuredMovie}
            onPlay={storefront.requestPlayback}
            onTrailer={setTrailerMovie}
          />
          <RequestBar
            busy={storefront.agentBusy}
            onRequest={storefront.requestByQuery}
          />
          <MovieCollection
            movies={storefront.catalog}
            curation={storefront.curation}
            onPlay={storefront.requestPlayback}
            onTrailer={setTrailerMovie}
          />
        </main>
      ) : area === "checkin" ? (
        <HotelCheckIn
          session={storefront.session}
          availability={storefront.hotelRoomAvailability}
          availabilityBusy={storefront.hotelRoomAvailabilityBusy}
          availabilityError={storefront.hotelRoomAvailabilityError}
          checkInBusy={storefront.stayBusy}
          checkInError={storefront.stayError}
          onCheckIn={storefront.checkInHotel}
          onRefresh={storefront.refreshHotelRoomAvailability}
          onFinishKiosk={storefront.finishKioskSession}
          onOpenTv={() => selectArea("storefront")}
        />
      ) : area === "hotel" ? (
        <main className="hotel-workspace">
          <HotelDashboard
            dashboard={storefront.hotelDashboard}
            busy={storefront.hotelDashboardBusy}
            error={storefront.hotelDashboardError}
            onRefresh={storefront.refreshHotelDashboard}
          />
        </main>
      ) : (
        <main className="operations-workspace">
          <section className="operations-intro">
            <div>
              <p className="section-kicker">UNDER THE HOOD</p>
              <h1>AgentCore operations workspace.</h1>
            </div>
            <p>
              Inspect specialist routing, enforced policies, read-only tools,
              memory activity, findings, and execution traces away from the
              consumer storefront.
            </p>
          </section>
          <OpsCopilot
            busy={storefront.agentBusy}
            onRequest={storefront.requestOpsAgent}
          />
          <AgentInspector
            inspection={storefront.agentInspection}
            busy={storefront.agentBusy}
          />
          <ActivitySection
            catalog={storefront.catalog}
            session={storefront.session}
            onReset={storefront.resetDemo}
          />
        </main>
      )}
      <Footer backend={storefront.session.backend} />
      <ToastRegion toasts={storefront.toasts} />

      {storefront.pendingPurchase && (
        <PaymentSheet
          purchase={storefront.pendingPurchase}
          session={storefront.session}
          status={storefront.paymentStatus}
          error={storefront.paymentError}
          onClose={storefront.closePayment}
          onResolve={storefront.resolvePayment}
        />
      )}

      {storefront.playback && (
        <PlayerModal
          mode="playback"
          playback={storefront.playback}
          onClose={storefront.closePlayer}
        />
      )}
      {trailerMovie && (
        <PlayerModal
          mode="trailer"
          trailer={trailerMovie}
          onClose={() => setTrailerMovie(undefined)}
        />
      )}
      {recommendationsOpen && storefront.curation && (
        <RecommendationDialog
          curation={storefront.curation}
          onClose={() => setRecommendationsOpen(false)}
          onPlay={(titleId) => {
            setRecommendationsOpen(false);
            void storefront.requestPlayback(titleId);
          }}
          onTrailer={(movie) => {
            setRecommendationsOpen(false);
            setTrailerMovie(movie);
          }}
        />
      )}
    </>
  );
}
