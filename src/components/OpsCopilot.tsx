// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState, type FormEvent } from "react";
import type { AgentMode } from "../types";

interface OpsCopilotProps {
  busy: boolean;
  onRequest: (
    mode: Exclude<AgentMode, "concierge">,
    prompt: string
  ) => void;
}

const examples = {
  devops: [
    "Is the storefront healthy right now?",
    "Why did the latest deployment take several minutes?"
  ],
  security: [
    "Audit this demo for its biggest security risks.",
    "Show which Runtime IAM permissions need review."
  ]
} as const;

export function OpsCopilot({ busy, onRequest }: OpsCopilotProps) {
  const [mode, setMode] =
    useState<Exclude<AgentMode, "concierge">>("devops");
  const [prompt, setPrompt] = useState<string>(examples.devops[0]);

  const selectMode = (nextMode: Exclude<AgentMode, "concierge">) => {
    setMode(nextMode);
    setPrompt(examples[nextMode][0]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || busy) return;
    onRequest(mode, prompt.trim());
  };

  return (
    <section className="ops-copilot" aria-labelledby="ops-copilot-title">
      <div className="ops-copilot-heading">
        <div>
          <p className="section-kicker">MULTI-AGENT OPERATIONS CONSOLE</p>
          <h2 id="ops-copilot-title">
            Ask the system about itself.
          </h2>
        </div>
        <div className="ops-guardrail">
          <span>POLICY ENFORCED</span>
          <strong>READ ONLY</strong>
        </div>
      </div>

      <div className="ops-layout">
        <div className="agent-selector" role="tablist" aria-label="Specialist agent">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "devops"}
            className={mode === "devops" ? "active" : ""}
            onClick={() => selectMode("devops")}
          >
            <span>01</span>
            <div>
              <small>DEVOPS AGENT</small>
              <strong>Runtime health and deployments</strong>
              <p>
                Reads CloudFormation, ECS service events, and recent
                application errors.
              </p>
            </div>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "security"}
            className={mode === "security" ? "active" : ""}
            onClick={() => selectMode("security")}
          >
            <span>02</span>
            <div>
              <small>SECURITY AGENT</small>
              <strong>Posture and IAM review</strong>
              <p>
                Audits edge access, networking, encryption, recovery, and
                Runtime permissions.
              </p>
            </div>
          </button>
        </div>

        <form className="ops-prompt" onSubmit={submit}>
          <div>
            <small>ROUTE VIA SUPERVISOR → {mode.toUpperCase()}</small>
            <label htmlFor="ops-prompt-input">
              What should the specialist investigate?
            </label>
          </div>
          <textarea
            id="ops-prompt-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            disabled={busy}
          />
          <div className="ops-examples">
            {examples[mode].map((example) => (
              <button
                type="button"
                key={example}
                onClick={() => setPrompt(example)}
              >
                {example}
              </button>
            ))}
          </div>
          <button
            className="ops-submit"
            type="submit"
            disabled={busy || !prompt.trim()}
          >
            {busy ? "INVESTIGATING…" : `ASK ${mode.toUpperCase()} AGENT ↗`}
          </button>
          <p>
            Specialist roles can invoke approved Gateway tools but cannot
            deploy, restart, modify IAM, or alter resources.
          </p>
        </form>
      </div>
    </section>
  );
}
