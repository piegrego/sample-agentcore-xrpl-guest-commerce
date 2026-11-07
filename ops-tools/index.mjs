// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { deploymentHealth, recentServiceEvents } from "./deployment.mjs";
import { iamSummary, securityPosture } from "./security.mjs";
import { errorText } from "./shared.mjs";

function requestedTool(event, context) {
  const contextual =
    context?.clientContext?.custom?.bedrockAgentCoreToolName ||
    event?.requestContext?.toolName ||
    event?.toolName ||
    event?.name;
  return String(contextual || "").split("___").at(-1);
}

export const handler = async (event = {}, context = {}) => {
  const tool = requestedTool(event, context);
  const input = event?.arguments || event?.input || event;
  try {
    if (tool === "get_deployment_health") return deploymentHealth();
    if (tool === "get_recent_service_events") return recentServiceEvents(input);
    if (tool === "audit_security_posture") return securityPosture();
    if (tool === "get_iam_summary") return iamSummary();
    throw new Error(`Unsupported read-only operations tool: ${tool || "unknown"}`);
  } catch (error) {
    console.error("Operations tool failed", { tool, error });
    return {
      error: "tool_failed",
      tool,
      message: errorText(error)
    };
  }
};
