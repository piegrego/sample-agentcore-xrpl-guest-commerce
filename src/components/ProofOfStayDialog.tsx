// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState, type FormEvent } from "react";
import type { HotelRoomAvailability } from "../types";

const NO_AVAILABLE_ROOMS: string[] = [];

interface ProofOfStayDialogProps {
  busy: boolean;
  error: string | null;
  availability: HotelRoomAvailability | null;
  availabilityBusy: boolean;
  availabilityError: string | null;
  walletAddress?: string;
  onLink: (roomNumber: string, pin: string) => Promise<boolean>;
  onRefresh: () => void;
  onDisconnect: () => void;
}

export function ProofOfStayDialog({
  busy,
  error,
  availability,
  availabilityBusy,
  availabilityError,
  walletAddress,
  onLink,
  onRefresh,
  onDisconnect
}: ProofOfStayDialogProps) {
  const initialRoom = availability?.availableRooms[0] ?? "";
  const [roomNumber, setRoomNumber] = useState(initialRoom);
  const [pin, setPin] = useState(initialRoom.padStart(4, "0"));
  const availableRooms = availability?.availableRooms ?? NO_AVAILABLE_ROOMS;
  const soldOut = Boolean(availability && availableRooms.length === 0);

  useEffect(() => {
    if (availableRooms.includes(roomNumber)) return;
    const nextRoom = availableRooms[0] ?? "";
    setRoomNumber(nextRoom);
    setPin(nextRoom.padStart(4, "0"));
  }, [availableRooms, roomNumber]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !roomNumber.trim() || !pin.trim()) return;
    await onLink(roomNumber.trim(), pin.trim());
  };

  return (
    <div className="sheet-backdrop proof-stay-backdrop">
      <section
        className="proof-stay-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proof-stay-title"
      >
        <div className="proof-stay-mark" aria-hidden="true">
          <span>LL</span>
        </div>
        <p className="section-kicker">LEDGER LODGE</p>
        <h2 id="proof-stay-title">Show your Proof of Stay.</h2>
        <p className="proof-stay-subtitle">
          Choose an available room and enter its PIN. This wallet must
          check out before it can select another room.
        </p>

        {!availability ? (
          <div className="proof-stay-status" role="status">
            {availabilityBusy
              ? "Checking room availability…"
              : "Room availability could not be loaded. Please try again."}
            {!availabilityBusy && (
              <button
                className="text-button"
                type="button"
                onClick={onRefresh}
              >
                Try again
              </button>
            )}
          </div>
        ) : soldOut ? (
          <div className="proof-stay-sold-out" role="status">
            <strong>No rooms are currently available.</strong>
            <span>Please try again later.</span>
            <button
              className="text-button"
              type="button"
              onClick={onRefresh}
              disabled={availabilityBusy}
            >
              {availabilityBusy ? "Checking…" : "Check again"}
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              <span>
                Available rooms · {availableRooms.length} of{" "}
                {availability?.totalRooms ?? 400}
              </span>
              <select
                value={roomNumber}
                disabled={busy || availabilityBusy}
                onChange={(event) => {
                  const nextRoom = event.target.value;
                  setRoomNumber(nextRoom);
                  setPin(nextRoom.padStart(4, "0"));
                }}
              >
                {availableRooms.map((room) => (
                  <option key={room} value={room}>
                    Room {room}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Room PIN</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                type="password"
                value={pin}
                disabled={busy}
                onChange={(event) => setPin(event.target.value)}
              />
            </label>
            <div className="proof-stay-demo">
              <small>DEMO CREDENTIALS</small>
              <strong>
                Room {roomNumber} · PIN {roomNumber.padStart(4, "0")}
              </strong>
            </div>
            {error && (
              <div className="payment-error" role="alert">
                <strong>Proof of Stay failed</strong>
                <span>{error}</span>
              </div>
            )}
            <button
              className={`resolve-button${busy ? " loading" : ""}`}
              type="submit"
              disabled={busy || !roomNumber.trim() || !pin.trim()}
            >
              <span>{busy ? "Checking the guest list…" : "Check in"}</span>
              <span>{busy ? "" : "→"}</span>
            </button>
          </form>
        )}

        {availabilityError && (
          <div className="payment-error" role="alert">
            <strong>Rooms unavailable</strong>
            <span>{availabilityError}</span>
          </div>
        )}

        <div className="proof-stay-privacy">
          <span>PRIVATE MAPPING</span>
          <p>
            Room details stay in DynamoDB. XRPL receives only an opaque,
            one-way invoice identifier.
          </p>
        </div>
        <button
          className="text-button proof-stay-disconnect"
          type="button"
          onClick={onDisconnect}
          disabled={busy}
        >
          Disconnect {walletAddress?.slice(0, 7)}…
        </button>
      </section>
    </div>
  );
}
