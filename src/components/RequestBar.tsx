// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState, type FormEvent } from "react";

interface RequestBarProps {
  onRequest: (query: string) => void;
  busy: boolean;
}

export function RequestBar({ onRequest, busy }: RequestBarProps) {
  const [query, setQuery] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    onRequest(query);
  };

  return (
    <section className="request-strip" aria-labelledby="request-heading">
      <div>
        <p className="section-kicker">ASK THE CONCIERGE</p>
        <h2 id="request-heading">What do you want to watch?</h2>
      </div>
      <form id="request-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="request-input">
          Request a movie
        </label>
        <input
          id="request-input"
          autoComplete="off"
          placeholder='Try “Play Afterlight”'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" aria-label="Send request" disabled={busy}>
          {busy ? <span className="request-spinner" /> : "↗"}
        </button>
      </form>
      <p className="request-hint">
        {busy
          ? "AgentCore is matching this request against the catalog and your available preferences…"
          : "Recommendations stay in For You; detailed execution traces stay in Operations."}
      </p>
    </section>
  );
}
