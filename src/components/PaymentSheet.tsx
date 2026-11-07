// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { PaymentSession, PaymentStatus, PendingPurchase } from "../types";

interface PaymentSheetProps {
  purchase: PendingPurchase;
  session: PaymentSession;
  status: PaymentStatus;
  error: string | null;
  onClose: () => void;
  onResolve: () => void;
}

export function PaymentSheet({
  purchase,
  session,
  status,
  error,
  onClose,
  onResolve
}: PaymentSheetProps) {
  const { movie, challenge } = purchase;
  const after = session.remaining - movie.price;
  const allowed = after >= 0;
  const signing = status === "signing";
  const settled = status === "settled";
  const busy = signing;
  let buttonLabel = "Approve with AgentCore & play";
  let buttonMark = "→";
  if (!allowed) {
    buttonLabel = "Payment blocked by policy";
    buttonMark = "×";
  } else if (signing) {
    buttonLabel = "AgentCore Runtime is signing";
    buttonMark = "";
  } else if (settled) {
    buttonLabel = "Payment settled";
    buttonMark = "✓";
  }

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="payment-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
      >
        <button className="close-sheet" onClick={onClose} aria-label="Close payment">
          ×
        </button>
        <div className="payment-stage-icon">
          <span>402</span>
        </div>
        <p className="section-kicker">PAYMENT REQUIRED</p>
        <h2 id="payment-title">Unlock this story</h2>
        <p className="payment-subtitle">
          The merchant returned an x402 purchase request.
        </p>

        <div className="payment-summary">
          <div className="payment-movie">
            <div className={`mini-poster ${movie.accent}`} />
            <div>
              <small>48-HOUR STREAM</small>
              <strong>{movie.title}</strong>
              <span>{challenge.merchant?.name || "Ledger Lodge Media"}</span>
            </div>
          </div>
          <strong className="payment-price">
            {movie.price.toFixed(2)} <small>{session.currency}</small>
          </strong>
        </div>

        <dl className="payment-details">
          <div>
            <dt>Network</dt>
            <dd>{session.network}</dd>
          </div>
          <div>
            <dt>Pay to</dt>
            <dd>{challenge.accepts[0].payTo}</dd>
          </div>
          <div>
            <dt>Session remaining</dt>
            <dd>{session.remaining.toFixed(2)} {session.currency}</dd>
          </div>
          <div>
            <dt>After purchase</dt>
            <dd>
              {allowed
                ? `${after.toFixed(2)} ${session.currency}`
                : "Policy denied"}
            </dd>
          </div>
        </dl>

        <div className={`policy-note${allowed ? "" : " denied"}`}>
          <span>{allowed ? "✓" : "!"}</span>
          {allowed ? (
            <p>
              <strong>Within your payment policy</strong>
              <br />
              Maximum {session.limit.toFixed(2)} {session.currency} for this session
            </p>
          ) : (
            <p>
              <strong>Session limit would be exceeded</strong>
              <br />
              This purchase needs {(movie.price - session.remaining).toFixed(2)}{" "}
              {session.currency} more.
            </p>
          )}
        </div>

        {error && (
          <div className="payment-error" role="alert">
            <strong>Runtime payment needs attention</strong>
            <span>{error}</span>
          </div>
        )}

        <button
          className={`resolve-button${busy ? " loading" : ""}`}
          disabled={!allowed || busy || settled}
          onClick={onResolve}
        >
          <span>{buttonLabel}</span>
          <span>{buttonMark}</span>
        </button>
        <p className="sheet-footnote">
          Approval is sent to AgentCore Runtime. Wallet material never enters
          the browser.
        </p>
      </section>
    </div>
  );
}
