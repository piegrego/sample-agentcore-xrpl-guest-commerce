// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createCatalog } from "../server/catalog";
import { truncateWallet } from "../server/hotel";
import { Header } from "../src/components/Header";
import { Hero } from "../src/components/Hero";
import { HotelCheckIn } from "../src/components/HotelCheckIn";
import { HotelDashboard } from "../src/components/HotelDashboard";
import { MovieCollection } from "../src/components/MovieCollection";
import { PaymentSheet } from "../src/components/PaymentSheet";
import { RecommendationDialog } from "../src/components/RecommendationDialog";
import {
  catalogFilterOptions,
  emptyCatalogFilters,
  filterCatalog
} from "../src/lib/catalogFilters";
import { createTestXrplAddress } from "./fixtures";

const catalog = createCatalog("XRP");

describe("catalog browser", () => {
  test("paginates the initial catalog eight titles at a time", () => {
    const html = renderToStaticMarkup(
      <MovieCollection
        movies={catalog}
        curation={null}
        onPlay={() => {}}
        onTrailer={() => {}}
      />
    );

    expect((html.match(/class="movie-card"/g) || []).length).toBe(8);
    expect(html).toContain("Showing 34 of 34 titles");
    expect(html).toContain('aria-label="Catalog pages"');
    expect(html).toContain('aria-current="page">1');
    expect(html).toContain(">5</button>");
  });

  test("renders persistent, selectable recommendation results", () => {
    const curation = {
      prompt: "Something gentle with captions",
      summary: "Gentle stories with accessible playback.",
      memoryInfluenced: true,
      createdAt: "2026-10-13T00:00:00.000Z",
      recommendations: [
        { movie: catalog[0], reason: "Reflective science fiction with captions." },
        { movie: catalog[2], reason: "A calm documentary with audio description." },
        { movie: catalog[4], reason: "A gentle animated fantasy." }
      ]
    };
    const html = renderToStaticMarkup(
      <RecommendationDialog
        curation={curation}
        onClose={() => {}}
        onPlay={() => {}}
        onTrailer={() => {}}
      />
    );

    expect(html).toContain("YOUR LINEUP IS READY");
    expect(html).toContain("recalled viewing preferences");
    expect(html).toContain("Watch trailer");
    expect(html).toContain("Rent · 0.65 XRP");
  });

  test("filters across genre, language, mood, pace, rating, and accessibility", () => {
    const filtered = filterCatalog(catalog, {
      ...emptyCatalogFilters,
      genre: "Animation",
      language: "Japanese",
      pace: "gentle",
      accessibility: "audio-description"
    });
    const searchResult = filterCatalog(catalog, {
      ...emptyCatalogFilters,
      query: "astronomy"
    });
    const options = catalogFilterOptions(catalog);

    expect(filtered.map((movie) => movie.id)).toContain("paper-kingdom");
    expect(searchResult.map((movie) => movie.id)).toEqual(["deep-field"]);
    expect(options.genres).toContain("Science fiction");
    expect(options.languages).toContain("Yoruba");
    expect(options.moods).toContain("Cozy");
    expect(options.paces).toEqual(["fast", "gentle", "moderate"]);
  });
});

describe("top-level demo areas", () => {
  test("presents managed guest check-in with live inventory", () => {
    const html = renderToStaticMarkup(
      <HotelCheckIn
        session={{
          id: "wallet_disconnected",
          currency: "XRP",
          backend: "xrpl",
          network: "XRPL Testnet",
          authenticated: false,
          approvalModes: ["runtime"],
          limit: 2,
          spent: 0,
          remaining: 2,
          expiresInMinutes: 0,
          transactions: []
        }}
        availability={{
          propertyId: "ledger-lodge",
          totalRooms: 400,
          availableRooms: ["101", "102", "103"]
        }}
        availabilityBusy={false}
        availabilityError={null}
        checkInBusy={false}
        checkInError={null}
        onCheckIn={async () => true}
        onRefresh={() => {}}
        onFinishKiosk={async () => true}
        onOpenTv={() => {}}
      />
    );

    expect(html).toContain("LEDGER LODGE ARRIVAL KIOSK");
    expect(html).toContain("Start a managed guest session.");
    expect(html).toContain("3 of 400");
    expect(html).toContain("Guest session unavailable.");
    expect(html).toContain("Receive your room");
  });

  test("asks guests to return later when the hotel is full", () => {
    const html = renderToStaticMarkup(
      <HotelCheckIn
        session={{
          id: "wallet_rGuest",
          currency: "XRP",
          backend: "xrpl",
          network: "XRPL Testnet",
          authenticated: true,
          approvalModes: ["runtime"],
          walletAddress: "rGuest",
          limit: 2,
          spent: 0,
          remaining: 2,
          expiresInMinutes: 60,
          transactions: []
        }}
        availability={{
          propertyId: "ledger-lodge",
          totalRooms: 400,
          availableRooms: []
        }}
        availabilityBusy={false}
        availabilityError={null}
        checkInBusy={false}
        checkInError={null}
        onCheckIn={async () => true}
        onRefresh={() => {}}
        onFinishKiosk={async () => true}
        onOpenTv={() => {}}
      />
    );

    expect(html).toContain("No rooms are currently available.");
    expect(html).toContain("Please try again later.");
    expect(html).toContain("Check again");
  });

  test("shows the room and TV handoff after kiosk check-in", () => {
    const html = renderToStaticMarkup(
      <HotelCheckIn
        session={{
          id: "wallet_rGuest",
          currency: "XRP",
          backend: "xrpl",
          network: "XRPL Testnet",
          authenticated: true,
          approvalModes: ["runtime"],
          walletAddress: "rGuest",
          limit: 2,
          spent: 0,
          remaining: 2,
          expiresInMinutes: 60,
          transactions: [],
          proofOfStay: {
            propertyId: "ledger-lodge",
            propertyName: "Ledger Lodge",
            roomNumber: "317",
            stayRef: "stay_test",
            linkedAt: "2026-10-19T12:00:00.000Z",
            checkoutAt: "2026-10-20T15:00:00.000Z"
          }
        }}
        availability={null}
        availabilityBusy={false}
        availabilityError={null}
        checkInBusy={false}
        checkInError={null}
        onCheckIn={async () => true}
        onRefresh={() => {}}
        onFinishKiosk={async () => true}
        onOpenTv={() => {}}
      />
    );

    expect(html).toContain("Your room is ready.");
    expect(html).toContain("Room 317");
    expect(html).toContain("Preview TV experience");
    expect(html).toContain("Finish at kiosk");
    expect(html).toContain("one-time room handoff token");
  });

  test("uses AgentCore Runtime as the built-in payment approval strategy", () => {
    const merchantAddress = createTestXrplAddress();
    const html = renderToStaticMarkup(
      <PaymentSheet
        purchase={{
          movie: catalog[0],
          challenge: {
            x402Version: 2,
            resource: {
              url: "/api/titles/afterlight/stream",
              description: "Stream",
              mimeType: "application/json"
            },
            accepts: [
              {
                scheme: "exact",
                network: "xrpl:1",
                asset: "XRP",
                amount: "650000",
                payTo: merchantAddress,
                maxTimeoutSeconds: 60,
                extra: {}
              }
            ]
          },
          prompt: "Play Afterlight",
          actorId: "actor",
          runtimeSessionId: "runtime-session"
        }}
        session={{
          id: "session",
          currency: "XRP",
          backend: "xrpl",
          network: "XRPL Testnet",
          authenticated: true,
          approvalModes: ["runtime"],
          limit: 2,
          spent: 0,
          remaining: 2,
          expiresInMinutes: 28,
          transactions: []
        }}
        status="idle"
        error={null}
        onClose={() => {}}
        onResolve={() => {}}
      />
    );
    expect(html).toContain("AgentCore Runtime");
    expect(html).not.toContain("Approve in");
  });

  test("groups guest and staff tabs into separate menu pills", () => {
    const html = renderToStaticMarkup(
      <Header
        area="operations"
        inspectionAvailable
        remaining={2}
        currency="XRP"
        backend="xrpl"
        authenticated={false}
        onAreaChange={() => {}}
      />
    );

    expect(html).toContain('aria-label="Guest experience"');
    expect(html).toContain('aria-label="Hotel staff"');
    expect(html).toContain("Check-In");
    expect(html).toContain(">TV</button>");
    expect(html).toContain("Front Desk");
    expect(html).toContain("Operations");
    expect(html.indexOf("Check-In")).toBeLessThan(html.indexOf(">TV</button>"));
    expect(html.indexOf("Front Desk")).toBeLessThan(
      html.indexOf("Operations")
    );
    expect(html).toContain("AWS Proof of Stay home");
    expect(html).toContain("Proof of Stay");
    expect(html).toContain('class="aws-logo"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Trace available");
    expect(html).toContain("operations-topbar");
  });

  test("renders room-level ledger receipts with truncated wallets", () => {
    const walletAddress = createTestXrplAddress();
    const walletDisplay = truncateWallet(walletAddress);
    const html = renderToStaticMarkup(
      <HotelDashboard
        dashboard={{
          propertyId: "ledger-lodge",
          propertyName: "Ledger Lodge",
          tagline: "Check in. Chain out.",
          generatedAt: "2026-10-14T12:00:00.000Z",
          source: "xrpl",
          merchantWalletDisplay: "rMercha…Wallet",
          stats: {
            totalPurchases: 1,
            revenue: 0.65,
            occupiedRooms: 1,
            uniqueWallets: 1,
            topTitle: "Afterlight"
          },
          purchases: [
            {
              transactionId: "A".repeat(64),
              invoiceId: "ABC123…XYZ789",
              roomNumber: "402",
              stayReference: "stay_7…29c81b",
              titleId: "afterlight",
              title: "Afterlight",
              amount: 0.65,
              currency: "XRP",
              network: "XRPL Testnet",
              status: "settled",
              createdAt: "2026-10-14T12:00:00.000Z",
              walletDisplay,
              channel: "agentcore"
            }
          ]
        }}
        busy={false}
        error={null}
        onRefresh={() => {}}
      />
    );

    expect(html).toContain("Ledger Lodge");
    expect(html).toContain("Room receipts from the ledger");
    expect(html).toContain(walletDisplay);
    expect(html).not.toContain(walletAddress);
  });

  test("offers public trailer playback from the hero without replacing rent", () => {
    const html = renderToStaticMarkup(
      <Hero movie={catalog[0]} onPlay={() => {}} onTrailer={() => {}} />
    );

    expect(html).toContain("Watch trailer");
    expect(html).toContain("Rent for 0.65 XRP");
    expect(html).toContain(
      `aria-label="Watch the trailer for ${catalog[0].title}"`
    );
  });
});
