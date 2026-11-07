// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { HotelDashboard as HotelDashboardData } from "../types";

interface HotelDashboardProps {
  dashboard: HotelDashboardData | null;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function HotelDashboard({
  dashboard,
  busy,
  error,
  onRefresh
}: HotelDashboardProps) {
  return (
    <section className="hotel-dashboard" aria-labelledby="hotel-title">
      <div className="hotel-hero">
        <div>
          <p className="section-kicker">PROPERTY CONSOLE</p>
          <h1 id="hotel-title">
            {dashboard?.propertyName || "Ledger Lodge"}
          </h1>
          <p>{dashboard?.tagline || "Check in. Chain out."}</p>
        </div>
        <div className="hotel-ledger-source">
          <span>LIVE RECEIPT SOURCE</span>
          <strong>
            {dashboard?.merchantWalletDisplay || "XRPL merchant wallet"}
          </strong>
          <button type="button" onClick={onRefresh} disabled={busy}>
            {busy ? "Reading ledger…" : "Refresh ledger ↻"}
          </button>
        </div>
      </div>

      {error && (
        <div className="hotel-error" role="alert">
          <strong>Ledger temporarily unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="hotel-stats">
        <article>
          <small>PURCHASES</small>
          <strong>{dashboard?.stats.totalPurchases ?? "—"}</strong>
          <span>Validated receipts</span>
        </article>
        <article>
          <small>REVENUE</small>
          <strong>
            {dashboard
              ? dashboard.stats.revenue.toFixed(2)
              : "—"}
          </strong>
          <span>XRP settled</span>
        </article>
        <article>
          <small>ROOMS</small>
          <strong>{dashboard?.stats.occupiedRooms ?? "—"}</strong>
          <span>With purchases</span>
        </article>
        <article>
          <small>TOP TITLE</small>
          <strong className="hotel-top-title">
            {dashboard?.stats.topTitle || "No purchases yet"}
          </strong>
          <span>Across Ledger Lodge</span>
        </article>
      </div>

      <div className="hotel-receipts">
        <div className="hotel-receipts-head">
          <div>
            <p className="section-kicker">PROOF OF PURCHASE</p>
            <h2>Room receipts from the ledger.</h2>
          </div>
          <p>
            Payment facts come from XRPL. Room numbers are privately
            resolved from opaque invoice IDs in DynamoDB.
          </p>
        </div>

        <div className="hotel-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Movie</th>
                <th>Wallet</th>
                <th>Amount</th>
                <th>Purchased</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {dashboard?.purchases.length ? (
                dashboard.purchases.map((purchase) => (
                  <tr key={purchase.transactionId}>
                    <td>
                      <strong>{purchase.roomNumber}</strong>
                      <small>{purchase.stayReference}</small>
                    </td>
                    <td>
                      <strong>{purchase.title}</strong>
                      <small>Via AgentCore</small>
                    </td>
                    <td>
                      <code>{purchase.walletDisplay}</code>
                    </td>
                    <td>
                      <strong>
                        {purchase.amount.toFixed(2)} {purchase.currency}
                      </strong>
                      <small>{purchase.status.toUpperCase()}</small>
                    </td>
                    <td>{displayDate(purchase.createdAt)}</td>
                    <td>
                      <code title={purchase.transactionId}>
                        {purchase.invoiceId}
                      </code>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="hotel-empty" colSpan={6}>
                    <strong>No Ledger Lodge receipts yet.</strong>
                    <span>
                      Check in a wallet, purchase a movie from the TV, then
                      refresh this dashboard.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
