// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export const AGENT_MODES = ["concierge", "devops", "security"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export interface AgentInvocation {
  prompt: string;
  actorId?: string;
  sessionId?: string;
  agentMode?: AgentMode;
  includeMemoryDetails?: boolean;
  approvePayment?: boolean;
  paymentSessionId?: string;
  paymentInstrumentId?: string;
  paymentDelegationToken?: string;
}

export interface SpecialistInvocation {
  prompt: string;
  actorId: string;
  sessionId: string;
  agentMode: Exclude<AgentMode, "concierge">;
  includeMemoryDetails: boolean;
  approvePayment: false;
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

export function parseAgentInvocation(value: unknown): AgentInvocation {
  if (!value || typeof value !== "object") {
    throw new Error("The invocation body must be a JSON object.");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw new Error('The invocation body must contain a non-empty "prompt".');
  }
  if (
    !optionalString(input.actorId) ||
    !optionalString(input.sessionId) ||
    !optionalString(input.paymentSessionId) ||
    !optionalString(input.paymentInstrumentId) ||
    !optionalString(input.paymentDelegationToken)
  ) {
    throw new Error("One or more invocation identifiers are invalid.");
  }
  if (
    input.agentMode !== undefined &&
    !AGENT_MODES.includes(input.agentMode as AgentMode)
  ) {
    throw new Error("The requested agent mode is invalid.");
  }
  if (
    input.approvePayment !== undefined &&
    typeof input.approvePayment !== "boolean"
  ) {
    throw new Error("approvePayment must be a boolean.");
  }
  if (
    input.includeMemoryDetails !== undefined &&
    typeof input.includeMemoryDetails !== "boolean"
  ) {
    throw new Error("includeMemoryDetails must be a boolean.");
  }
  return input as unknown as AgentInvocation;
}

export function specialistInvocation(
  input: AgentInvocation,
  role: Exclude<AgentMode, "concierge">,
  actorId: string,
  sessionId: string
): SpecialistInvocation {
  return {
    prompt: input.prompt,
    actorId,
    sessionId,
    agentMode: role,
    includeMemoryDetails: input.includeMemoryDetails === true,
    approvePayment: false
  };
}
