// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Movie, PaymentSession } from "../types";

interface ActivitySectionProps {
  catalog: Movie[];
  session: PaymentSession;
  onReset: () => void;
}

const steps = [
  ["Request", "The guest asks the concierge to play a title."],
  ["Challenge", "The merchant responds with HTTP 402."],
  ["Resolve", "The configured backend signs within the session limit."],
  ["Unlock", "The agent retries with payment proof."]
];

export function ActivitySection({ catalog, session, onReset }: ActivitySectionProps) {
  const progress = Math.min(100, (session.spent / session.limit) * 100);

  return (
    <section className="activity-section" id="activity" aria-labelledby="activity-title">
      <div className="section-header">
        <div>
          <p className="section-kicker">UNDER THE HOOD</p>
          <h2 id="activity-title">One request. A controlled payment.</h2>
        </div>
        <button className="text-button" onClick={onReset}>
          Disconnect wallet ↻
        </button>
      </div>
      <div className="activity-layout">
        <div className="flow-card">
          <div className="flow-line" />
          {steps.map(([title, description], index) => (
            <div className="flow-step" key={title}>
              <span>0{index + 1}</span>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="ledger-card">
          <div className="ledger-head">
            <span>WALLET ENTITLEMENTS</span>
            <span className="status-chip">
              {session.authenticated ? "IDENTIFIED" : "DISCONNECTED"}
            </span>
          </div>
          <div className="budget-row">
            <div>
              <small>SPENT</small>
              <strong>{session.spent.toFixed(2)}</strong>
            </div>
            <div>
              <small>LIMIT</small>
              <strong>{session.limit.toFixed(2)}</strong>
            </div>
          </div>
          <div className="budget-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="ledger-list">
            {session.transactions.length ? (
              session.transactions.map((transaction) => {
                const movie = catalog.find((item) => item.id === transaction.titleId);
                return (
                  <div className="ledger-entry" key={transaction.id}>
                    <span className="ledger-check">✓</span>
                    <div>
                      <strong>{movie?.title || "Streaming access"}</strong>
                      <small>SETTLED · {transaction.network.toUpperCase()}</small>
                    </div>
                    <strong>−{transaction.amount.toFixed(2)}</strong>
                  </div>
                );
              })
            ) : (
              <div className="empty-ledger">No payments yet. Your agent is ready.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
