// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import {
  App,
  CfnResource,
  CustomResource,
  Stack
} from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AgentCoreRuntimeConstruct } from "../infra/cdk/lib/agentcore-runtime-construct";

describe("reusable AgentCore Runtime construct", () => {
  test("creates independently scoped readiness-gated endpoints", () => {
    const stack = new Stack(new App(), "RuntimeReuse", {
      env: {
        account: "111111111111",
        region: "us-east-1"
      }
    });
    const dependency = new CfnResource(stack, "RuntimeDependency", {
      type: "Custom::RuntimeDependency"
    });
    const readiness = {
      waitForAgentCoreRuntime(
        id: string,
        runtimeId: string,
        runtimeVersion: string
      ) {
        return new CustomResource(stack, id, {
          serviceToken:
            "arn:aws:lambda:us-east-1:111111111111:function:runtime-readiness",
          resourceType: "Custom::RuntimeReadiness",
          properties: {
            RuntimeId: runtimeId,
            RuntimeVersion: runtimeVersion
          }
        });
      }
    };

    for (const id of ["Primary", "Secondary"]) {
      new AgentCoreRuntimeConstruct(stack, id, {
        runtime: {
          agentRuntimeName: `${id}Runtime`,
          roleArn:
            "arn:aws:iam::111111111111:role/AgentCoreRuntimeRole",
          agentRuntimeArtifact: {
            containerConfiguration: {
              containerUri:
                "111111111111.dkr.ecr.us-east-1.amazonaws.com/runtime:latest"
            }
          },
          networkConfiguration: {
            networkMode: "PUBLIC"
          },
          protocolConfiguration: "HTTP"
        },
        endpoint: {
          name: "live",
          description: `${id} stable endpoint`
        },
        resourceReadiness: readiness,
        runtimeDependencies: [dependency]
      });
    }

    const template = Template.fromStack(stack);
    const runtimes = template.findResources(
      "AWS::BedrockAgentCore::Runtime"
    );
    const endpoints = template.findResources(
      "AWS::BedrockAgentCore::RuntimeEndpoint"
    );
    const readinessResources = template.findResources(
      "Custom::RuntimeReadiness"
    );

    expect(Object.keys(runtimes)).toHaveLength(2);
    expect(Object.keys(endpoints)).toHaveLength(2);
    expect(Object.keys(readinessResources)).toHaveLength(2);
    for (const runtime of Object.values(runtimes) as any[]) {
      expect(runtime.DependsOn).toContain("RuntimeDependency");
    }
    for (const endpoint of Object.values(endpoints) as any[]) {
      const dependencies = Array.isArray(endpoint.DependsOn)
        ? endpoint.DependsOn
        : [endpoint.DependsOn].filter(Boolean);
      expect(
        dependencies.some((logicalId: string) =>
          Object.keys(readinessResources).includes(logicalId)
        )
      ).toBe(true);
    }
  });

  test("requires complete migration identifiers", () => {
    const stack = new Stack(new App(), "RuntimeMigrationValidation");
    expect(
      () =>
        new AgentCoreRuntimeConstruct(stack, "MigratedRuntime", {
          runtime: {
            agentRuntimeName: "MigratedRuntime",
            roleArn:
              "arn:aws:iam::111111111111:role/AgentCoreRuntimeRole",
            agentRuntimeArtifact: {
              containerConfiguration: {
                containerUri:
                  "111111111111.dkr.ecr.us-east-1.amazonaws.com/runtime:latest"
              }
            },
            networkConfiguration: {
              networkMode: "PUBLIC"
            },
            protocolConfiguration: "HTTP"
          },
          endpoint: {
            name: "live"
          },
          resourceReadiness: {
            waitForAgentCoreRuntime() {
              throw new Error("must not create readiness");
            }
          },
          preserveLegacyResourcePaths: true
        })
    ).toThrow("require both legacyRuntimeId and legacyEndpointId");
  });
});
