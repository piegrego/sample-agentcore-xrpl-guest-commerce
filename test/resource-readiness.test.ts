// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";

const {
  evaluateAgentRuntimeStatus,
  evaluateVpcOriginStatus
} = require("../infra/functions/resource-readiness/index.cjs");

describe("resource readiness", () => {
  test("recognizes an AgentCore Runtime that is ready", () => {
    expect(evaluateAgentRuntimeStatus("READY")).toBe(true);
  });

  test("continues polling an AgentCore Runtime that is stabilizing", () => {
    expect(evaluateAgentRuntimeStatus("CREATING")).toBe(false);
    expect(evaluateAgentRuntimeStatus("UPDATING")).toBe(false);
  });

  test("fails immediately when an AgentCore Runtime cannot stabilize", () => {
    expect(() =>
      evaluateAgentRuntimeStatus(
        "CREATE_FAILED",
        "Container health check failed"
      )
    ).toThrow("Container health check failed");
  });

  test("recognizes a deployed CloudFront VPC origin", () => {
    expect(evaluateVpcOriginStatus("Deployed")).toBe(true);
  });

  test("continues polling a CloudFront VPC origin that is deploying", () => {
    expect(evaluateVpcOriginStatus("Deploying")).toBe(false);
  });

  test("fails immediately when a CloudFront VPC origin deployment fails", () => {
    expect(() => evaluateVpcOriginStatus("Failed")).toThrow(
      "terminal status FAILED"
    );
  });
});
