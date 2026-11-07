// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Brand } from "./Brand";
import type {
  DemoArea,
  PaymentAsset,
  PaymentBackend,
  ProofOfStay
} from "../types";

interface HeaderProps {
  area: DemoArea;
  inspectionAvailable: boolean;
  remaining: number;
  currency: PaymentAsset;
  backend: PaymentBackend;
  walletAddress?: string;
  authenticated: boolean;
  proofOfStay?: ProofOfStay;
  onAreaChange: (area: DemoArea) => void;
}

export function Header({
  area,
  inspectionAvailable,
  remaining,
  currency,
  backend,
  walletAddress,
  authenticated,
  proofOfStay,
  onAreaChange
}: HeaderProps) {
  return (
    <header
      className={`topbar ${area !== "storefront" ? "operations-topbar" : ""}`}
    >
      <Brand />
      <nav className="area-nav" aria-label="Demo areas" role="tablist">
        <div className="area-nav-pill" role="group" aria-label="Guest experience">
          <button
            className={area === "checkin" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={area === "checkin"}
            onClick={() => onAreaChange("checkin")}
          >
            Check-In
          </button>
          <button
            className={area === "storefront" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={area === "storefront"}
            onClick={() => onAreaChange("storefront")}
          >
            TV
          </button>
        </div>
        <div className="area-nav-pill" role="group" aria-label="Hotel staff">
          <button
            className={area === "hotel" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={area === "hotel"}
            onClick={() => onAreaChange("hotel")}
          >
            Front Desk
          </button>
          <button
            className={area === "operations" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={area === "operations"}
            onClick={() => onAreaChange("operations")}
          >
            Operations
            {inspectionAvailable && <i aria-label="Trace available" />}
          </button>
        </div>
      </nav>
      <div
        className="wallet-pill"
        role="status"
      >
        <span className="live-dot" />
        <span>
          <small>
            {authenticated && walletAddress
              ? `${walletAddress?.slice(0, 6)}…${walletAddress?.slice(-4)}`
              : backend === "xrpl"
                ? "GUEST SESSION"
                : "AGENTCORE RUNTIME"}
          </small>
          <strong>
            {authenticated && walletAddress
                ? proofOfStay
                  ? `Room ${proofOfStay.roomNumber}`
                  : `${remaining.toFixed(2)} ${currency} · Link stay`
                : backend === "xrpl"
                  ? proofOfStay
                    ? `Room ${proofOfStay.roomNumber} · Runtime pays`
                    : `${remaining.toFixed(2)} ${currency} · Runtime pays`
                  : `${remaining.toFixed(2)} ${currency} · Managed`}
          </strong>
        </span>
      </div>
    </header>
  );
}
