// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState } from "react";
import type {
  HotelRoomAvailability,
  PaymentSession,
  ProofOfStay
} from "../types";

interface HotelCheckInProps {
  session: PaymentSession;
  availability: HotelRoomAvailability | null;
  availabilityBusy: boolean;
  availabilityError: string | null;
  checkInBusy: boolean;
  checkInError: string | null;
  onCheckIn: () => Promise<boolean>;
  onRefresh: () => void;
  onFinishKiosk: () => Promise<boolean>;
  onOpenTv: () => void;
}

function checkoutLabel(checkoutAt: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(checkoutAt));
}

export function HotelCheckIn({
  session,
  availability,
  availabilityBusy,
  availabilityError,
  checkInBusy,
  checkInError,
  onCheckIn,
  onRefresh,
  onFinishKiosk,
  onOpenTv
}: HotelCheckInProps) {
  const [completedStay, setCompletedStay] = useState<ProofOfStay>();
  const availableCount = availability?.availableRooms.length;
  const soldOut = availableCount === 0;
  const stay = session.proofOfStay ?? completedStay;

  const finishKiosk = async () => {
    if (!session.proofOfStay) return;
    const currentStay = session.proofOfStay;
    if (await onFinishKiosk()) setCompletedStay(currentStay);
  };

  if (completedStay && !session.authenticated) {
    return (
      <main className="checkin-workspace">
        <section className="checkin-kiosk checkin-complete">
          <div className="checkin-complete-mark" aria-hidden="true">
            ✓
          </div>
          <p className="section-kicker">KIOSK CLEARED</p>
          <h1>Room {completedStay.roomNumber} is ready.</h1>
          <p>
            The kiosk session is cleared, but the room remains occupied until
            checkout. The public sample keeps guest access in an HTTP-only
            browser session instead of a consumer wallet.
          </p>
          <div className="checkin-confirmation-strip">
            <span>Checkout</span>
            <strong>{checkoutLabel(completedStay.checkoutAt)}</strong>
          </div>
          <button
            className="checkin-secondary-action"
            type="button"
            onClick={() => setCompletedStay(undefined)}
          >
            Check in another guest
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="checkin-workspace">
      <section className="checkin-kiosk" aria-labelledby="checkin-title">
        <div className="checkin-heading">
          <div>
            <p className="section-kicker">LEDGER LODGE ARRIVAL KIOSK</p>
            <h1 id="checkin-title">
              {stay
                ? "Your room is ready."
                : "Start a managed guest session."}
            </h1>
          </div>
          <div className="checkin-inventory" aria-live="polite">
            <span>Live inventory</span>
            <strong>
              {availabilityBusy
                ? "Checking…"
                : availability
                  ? `${availableCount} of ${availability.totalRooms}`
                  : "Unavailable"}
            </strong>
            <small>rooms ready</small>
          </div>
        </div>

        <div className="checkin-flow">
          <article className={session.authenticated ? "complete" : "active"}>
            <span className="checkin-step-number">01</span>
            <div>
              <p className="section-kicker">IDENTITY</p>
              <h2>Establish the guest session</h2>
              <p>
                The service creates an opaque, HTTP-only session for this
                guest. The session receives access while AgentCore Runtime
                pays from its configured XRPL account.
              </p>
              {session.authenticated ? (
                <div className="checkin-wallet-proof">
                  <i aria-hidden="true">✓</i>
                  <span>
                    <small>
                      {session.identityType === "wallet"
                        ? "VERIFIED WALLET"
                        : "GUEST SESSION"}
                    </small>
                    <strong>
                      {session.walletAddress
                        ? `${session.walletAddress.slice(0, 9)}…${session.walletAddress.slice(-7)}`
                        : session.id}
                    </strong>
                  </span>
                </div>
              ) : (
                <div className="checkin-unavailable" role="note">
                  <strong>Guest session unavailable.</strong>
                  <span>
                    Reload the page to create a new managed guest session.
                  </span>
                </div>
              )}
            </div>
          </article>

          <article
            className={
              stay
                ? "complete"
                : session.authenticated
                  ? "active"
                  : "pending"
            }
          >
            <span className="checkin-step-number">02</span>
            <div>
              <p className="section-kicker">ROOM ASSIGNMENT</p>
              <h2>{stay ? `Room ${stay.roomNumber}` : "Receive your room"}</h2>
              {stay ? (
                <>
                  <p>
                    This guest session now carries the private Proof of Stay
                    used by the TV experience.
                  </p>
                  <div className="assigned-room">
                    <span>ROOM</span>
                    <strong>{stay.roomNumber}</strong>
                    <small>Checkout {checkoutLabel(stay.checkoutAt)}</small>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    Ledger Lodge will atomically assign one available room to
                    this guest session. A session can hold one active room.
                  </p>
                  {soldOut ? (
                    <div className="checkin-unavailable" role="status">
                      <strong>No rooms are currently available.</strong>
                      <span>Please try again later.</span>
                      <button
                        className="text-button"
                        type="button"
                        disabled={availabilityBusy}
                        onClick={onRefresh}
                      >
                        {availabilityBusy ? "Checking…" : "Check again"}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="checkin-primary-action"
                      type="button"
                      disabled={
                        !session.authenticated ||
                        checkInBusy ||
                        availabilityBusy ||
                        !availability
                      }
                      onClick={() => void onCheckIn()}
                    >
                      {checkInBusy ? "Assigning your room…" : "Assign my room"}
                      <span aria-hidden="true">→</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </article>

          <article className={stay ? "active" : "pending"}>
            <span className="checkin-step-number">03</span>
            <div>
              <p className="section-kicker">IN-ROOM HANDOFF</p>
              <h2>Continue on the TV</h2>
              <p>
                This sample previews the TV experience in the same browser so
                the HTTP-only guest session remains available. A production
                hotel must exchange a one-time room handoff token between
                devices.
              </p>
              {stay && session.authenticated && (
                <div className="checkin-actions">
                  <button
                    className="checkin-primary-action"
                    type="button"
                    onClick={onOpenTv}
                  >
                    Preview TV experience
                    <span aria-hidden="true">→</span>
                  </button>
                  <button
                    className="checkin-secondary-action"
                    type="button"
                    disabled={checkInBusy}
                    onClick={() => void finishKiosk()}
                  >
                    {checkInBusy ? "Clearing kiosk…" : "Finish at kiosk"}
                  </button>
                </div>
              )}
            </div>
          </article>
        </div>

        {(checkInError || availabilityError) && (
          <div className="checkin-error" role="alert">
            <strong>Check-in needs attention</strong>
            <span>{checkInError || availabilityError}</span>
          </div>
        )}

        <div className="checkin-privacy">
          <strong>PRIVATE BY DESIGN</strong>
          <p>
            The room assignment stays in DynamoDB. XRPL receives only an opaque
            invoice identifier. The invoice binds the guest beneficiary to the
            configured Runtime payer without publishing room data.
          </p>
        </div>
      </section>
    </main>
  );
}
