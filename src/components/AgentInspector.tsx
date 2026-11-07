// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  AgentInspection,
  AgentTraceCategory,
  AgentTraceStatus
} from "../types";

interface AgentInspectorProps {
  inspection: AgentInspection | null;
  busy: boolean;
}

const categoryLabels: Record<AgentTraceCategory, string> = {
  runtime: "Runtime",
  agent: "Agent",
  policy: "Policy",
  memory: "Memory",
  model: "Model",
  tool: "Tool"
};

const statusLabels: Record<AgentTraceStatus, string> = {
  success: "OK",
  skipped: "SKIPPED",
  error: "ERROR"
};

function shortId(value: string | undefined) {
  if (!value) return "Not returned";
  if (value.length <= 30) return value;
  return `${value.slice(0, 14)}…${value.slice(-10)}`;
}

function duration(value: number | undefined) {
  return typeof value === "number" ? `${value.toLocaleString()} ms` : "—";
}

export function AgentInspector({
  inspection,
  busy
}: AgentInspectorProps) {
  const response = inspection?.response;
  const memory = response?.memory;
  const trace = response?.trace;
  const orchestration = response?.orchestration;
  const findings = response?.findings;

  return (
    <section
      className="agent-inspector"
      id="agent-inspector"
      aria-labelledby="agent-inspector-title"
    >
      <div className="inspector-heading">
        <div>
          <p className="section-kicker">AGENTCORE SESSION INSPECTOR</p>
          <h2 id="agent-inspector-title">See what the agent actually did.</h2>
        </div>
        <span
          className={`inspector-live ${busy ? "is-busy" : ""}`}
          aria-live="polite"
        >
          <i />
          {busy ? "RUNNING" : inspection ? "TRACE READY" : "WAITING"}
        </span>
      </div>

      {!inspection ? (
        <div className="inspector-empty">
          <span>01</span>
          <div>
            <strong>Send a natural-language request above.</strong>
            <p>
              Proof of Stay will show memory retrieval, model calls, tool execution,
              memory writes, timing, and the AgentCore trace identifier here.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="inspector-summary">
            <article className="prompt-card">
              <small>USER PROMPT</small>
              <p>“{inspection.prompt}”</p>
              <small>AGENT RESPONSE</small>
              <strong>{response?.message}</strong>
            </article>

            <article className="trace-meta-card">
              <div>
                <small>AGENTCORE TRACE</small>
                <strong title={response?.traceId}>
                  {shortId(response?.traceId)}
                </strong>
              </div>
              <div>
                <small>RUNTIME SESSION</small>
                <strong title={response?.runtimeSessionId || response?.sessionId}>
                  {shortId(response?.runtimeSessionId || response?.sessionId)}
                </strong>
              </div>
              <div>
                <small>RUNTIME ROUND TRIP</small>
                <strong>{duration(response?.runtimeDurationMs)}</strong>
              </div>
              <div>
                <small>IN-AGENT TRACE</small>
                <strong>{duration(trace?.totalDurationMs)}</strong>
              </div>
            </article>
          </div>

          {orchestration?.route.length ? (
            <div className="agent-route-panel">
              <div>
                <small>AGENT HANDOFF</small>
                <strong>
                  {orchestration.route.map((hop) => hop.name).join(" → ")}
                </strong>
              </div>
              <ol>
                {orchestration.route.map((hop, index) => (
                  <li key={`${hop.role}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small>{hop.role.toUpperCase()}</small>
                      <strong>{hop.name}</strong>
                    </div>
                    <i className={`trace-status ${hop.status}`}>
                      {statusLabels[hop.status]}
                    </i>
                  </li>
                ))}
              </ol>
              <div className="gateway-boundary">
                <small>AGENTCORE GATEWAY</small>
                <strong>
                  {orchestration.gateway?.used
                    ? `${orchestration.gateway.target || "MCP"} · ${orchestration.gateway.policyMode || "POLICY ACTIVE"}`
                    : "Not used for this request"}
                </strong>
                <p>
                  {orchestration.gateway?.used
                    ? `${orchestration.gateway.tools?.join(", ") || "Approved tools"}; mutation authority=${orchestration.gateway.mutationAllowed ? "yes" : "no"}.`
                    : "The media path remains inside the supervisor Runtime."}
                </p>
              </div>
            </div>
          ) : null}

          {findings?.length ? (
            <article className="security-findings">
              <div className="inspector-panel-head">
                <div>
                  <small>SECURITY FINDINGS</small>
                  <strong>Live posture review</strong>
                </div>
                <span>{findings.length} CHECKS</span>
              </div>
              <div className="finding-grid">
                {findings.map((finding, index) => (
                  <div
                    className={`finding-card ${finding.status} ${finding.severity}`}
                    key={`${finding.title}-${index}`}
                  >
                    <div>
                      <span>{finding.status.toUpperCase()}</span>
                      <small>{finding.severity.toUpperCase()}</small>
                    </div>
                    <strong>{finding.title}</strong>
                    <p>{finding.detail}</p>
                    {finding.resource ? (
                      <code title={finding.resource}>
                        {shortId(finding.resource)}
                      </code>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <div className="inspector-grid">
            <article className="memory-panel">
              <div className="inspector-panel-head">
                <div>
                  <small>LONG-TERM MEMORY</small>
                  <strong>
                    {memory?.enabled
                      ? response?.agentMode === "concierge"
                        ? "Preference recall"
                        : "Operations recall"
                      : "Memory disabled"}
                  </strong>
                </div>
                <span className={`trace-status ${memory?.recallStatus || "skipped"}`}>
                  {statusLabels[memory?.recallStatus || "skipped"]}
                </span>
              </div>

              <div className="memory-namespace">
                <small>NAMESPACE</small>
                <code title={memory?.namespace}>
                  {shortId(memory?.namespace)}
                </code>
              </div>

              <div className="memory-records">
                {memory?.recalled.length ? (
                  memory.recalled.map((record, index) => (
                    <div className="memory-record" key={`${index}-${record}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{record}</p>
                    </div>
                  ))
                ) : (
                  <p className="memory-empty">
                    No matching preference records were recalled for this
                    request.
                  </p>
                )}
              </div>

              <div className="memory-write">
                <span
                  className={`trace-status ${memory?.writeStatus || "skipped"}`}
                >
                  {statusLabels[memory?.writeStatus || "skipped"]}
                </span>
                <p>
                  {memory?.writeStatus === "success"
                    ? "This conversation was sent to AgentCore Memory for asynchronous extraction."
                    : "No new memory event was confirmed for this response."}
                </p>
              </div>
            </article>

            <article className="trace-panel">
              <div className="inspector-panel-head">
                <div>
                  <small>EXECUTION PATH</small>
                  <strong>Sanitized operational trace</strong>
                </div>
                <span>{trace?.steps.length || 0} STEPS</span>
              </div>

              <ol className="trace-list">
                {trace?.steps.length ? (
                  trace.steps.map((step) => (
                    <li className={step.status} key={step.id}>
                      <span className="trace-node" aria-hidden="true" />
                      <div className="trace-step-copy">
                        <div>
                          <small>{categoryLabels[step.category]}</small>
                          <strong>{step.name}</strong>
                        </div>
                        <p>{step.detail}</p>
                      </div>
                      <div className="trace-timing">
                        <span className={`trace-status ${step.status}`}>
                          {statusLabels[step.status]}
                        </span>
                        <small>+{step.offsetMs} ms</small>
                        <small>{duration(step.durationMs)}</small>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="skipped">
                    <span className="trace-node" aria-hidden="true" />
                    <div className="trace-step-copy">
                      <strong>Structured trace unavailable</strong>
                      <p>
                        Deploy the updated Runtime to populate execution steps.
                      </p>
                    </div>
                  </li>
                )}
              </ol>
            </article>
          </div>

          <p className="trace-disclosure">
            This view contains operational spans and sanitized inputs and
            outcomes. It does not expose hidden model reasoning.
          </p>
        </>
      )}
    </section>
  );
}
