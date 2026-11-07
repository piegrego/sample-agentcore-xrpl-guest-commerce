// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const SUPPORTED_KINDS = new Set([
  "AgentCoreRuntime",
  "CloudFrontVpcOrigin"
]);

let agentCoreClient;
let cloudFrontClient;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function evaluateAgentRuntimeStatus(status, failureReason) {
  const normalizedStatus = requiredString(
    status,
    "AgentCore Runtime status"
  ).toUpperCase();
  if (normalizedStatus === "READY") {
    return true;
  }
  if (
    normalizedStatus === "CREATE_FAILED" ||
    normalizedStatus === "UPDATE_FAILED" ||
    normalizedStatus === "DELETING"
  ) {
    const reason =
      typeof failureReason === "string" && failureReason.trim()
        ? `: ${failureReason.trim()}`
        : "";
    throw new Error(
      `AgentCore Runtime entered terminal status ${normalizedStatus}${reason}`
    );
  }
  if (
    normalizedStatus === "CREATING" ||
    normalizedStatus === "UPDATING"
  ) {
    return false;
  }
  throw new Error(
    `AgentCore Runtime returned unsupported status "${status}".`
  );
}

function evaluateVpcOriginStatus(status) {
  const normalizedStatus = requiredString(
    status,
    "CloudFront VPC origin status"
  ).toUpperCase();
  if (normalizedStatus === "DEPLOYED") {
    return true;
  }
  if (
    normalizedStatus.includes("FAIL") ||
    normalizedStatus === "DELETING" ||
    normalizedStatus === "DELETED"
  ) {
    throw new Error(
      `CloudFront VPC origin entered terminal status ${normalizedStatus}.`
    );
  }
  return false;
}

async function getAgentCoreRuntime(properties) {
  const {
    BedrockAgentCoreControlClient,
    GetAgentRuntimeCommand
  } = require("@aws-sdk/client-bedrock-agentcore-control");
  agentCoreClient ??= new BedrockAgentCoreControlClient({});
  return agentCoreClient.send(
    new GetAgentRuntimeCommand({
      agentRuntimeId: requiredString(
        properties.ResourceId,
        "ResourceId"
      ),
      agentRuntimeVersion: requiredString(
        properties.ResourceVersion,
        "ResourceVersion"
      )
    })
  );
}

async function getVpcOrigin(properties) {
  const {
    CloudFrontClient,
    GetVpcOriginCommand
  } = require("@aws-sdk/client-cloudfront");
  cloudFrontClient ??= new CloudFrontClient({});
  return cloudFrontClient.send(
    new GetVpcOriginCommand({
      Id: requiredString(properties.ResourceId, "ResourceId")
    })
  );
}

function isEventuallyConsistentNotFound(error) {
  return (
    error?.name === "ResourceNotFoundException" ||
    error?.name === "NoSuchVpcOrigin"
  );
}

async function checkReadiness(properties) {
  if (properties.Kind === "AgentCoreRuntime") {
    try {
      const runtime = await getAgentCoreRuntime(properties);
      return evaluateAgentRuntimeStatus(
        runtime.status,
        runtime.failureReason
      );
    } catch (error) {
      if (isEventuallyConsistentNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  if (properties.Kind === "CloudFrontVpcOrigin") {
    try {
      const response = await getVpcOrigin(properties);
      return evaluateVpcOriginStatus(response.VpcOrigin?.Status);
    } catch (error) {
      if (isEventuallyConsistentNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  throw new Error(`Unsupported readiness Kind "${properties.Kind}".`);
}

exports.handler = async (event) => {
  const properties = event?.ResourceProperties;
  if (!properties || typeof properties !== "object") {
    throw new Error("ResourceProperties are required.");
  }
  const kind = requiredString(properties.Kind, "Kind");
  if (!SUPPORTED_KINDS.has(kind)) {
    throw new Error(`Unsupported readiness Kind "${kind}".`);
  }
  const resourceId = requiredString(
    properties.ResourceId,
    "ResourceId"
  );
  const resourceVersion =
    kind === "AgentCoreRuntime"
      ? requiredString(
          properties.ResourceVersion,
          "ResourceVersion"
        )
      : "";
  const physicalResourceId = [
    "readiness",
    kind,
    resourceId,
    resourceVersion
  ]
    .filter(Boolean)
    .join(":");

  if (!event.CallbackContext?.ReadinessPoll) {
    return {
      PhysicalResourceId: physicalResourceId,
      CallbackContext: {
        ReadinessPoll: true
      }
    };
  }

  if (event.RequestType === "Delete") {
    return {
      IsComplete: true
    };
  }

  return {
    IsComplete: await checkReadiness(properties)
  };
};

exports.evaluateAgentRuntimeStatus = evaluateAgentRuntimeStatus;
exports.evaluateVpcOriginStatus = evaluateVpcOriginStatus;
