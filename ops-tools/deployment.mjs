// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { DescribeStackEventsCommand } from "@aws-sdk/client-cloudformation";
import { DescribeServicesCommand } from "@aws-sdk/client-ecs";
import { FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { clients, requiredValue, stackMetadata } from "./shared.mjs";

export async function deploymentHealth() {
  const { stack, outputs } = await stackMetadata();
  const cluster = requiredValue(outputs, "StorefrontClusterName");
  const serviceName = requiredValue(outputs, "StorefrontServiceName");
  const response = await clients.ecs.send(
    new DescribeServicesCommand({ cluster, services: [serviceName] })
  );
  const service = response.services?.[0];
  const deployment = service?.deployments?.[0];
  return {
    checkedAt: new Date().toISOString(),
    provenance: {
      sourceCommitSha:
        outputs.SourceCommitSha || process.env.SOURCE_COMMIT_SHA || "unknown"
    },
    stack: {
      name: process.env.STACK_NAME,
      status: stack?.StackStatus || "UNKNOWN",
      updatedAt: stack?.LastUpdatedTime?.toISOString()
    },
    storefront: {
      cluster,
      service: serviceName,
      status: service?.status || "UNKNOWN",
      desired: service?.desiredCount ?? 0,
      running: service?.runningCount ?? 0,
      pending: service?.pendingCount ?? 0,
      rollout: deployment?.rolloutState || "UNKNOWN",
      taskDefinition: deployment?.taskDefinition
    },
    runtimes: [
      { name: "supervisor", arn: outputs.AgentRuntimeArn },
      { name: "devops", arn: outputs.DevOpsRuntimeArn },
      { name: "security", arn: outputs.SecurityRuntimeArn }
    ]
  };
}

export async function recentServiceEvents(input) {
  const windowMinutes = Math.min(
    1440,
    Math.max(5, Number(input?.windowMinutes) || 60)
  );
  const startTime = Date.now() - windowMinutes * 60_000;
  const { outputs } = await stackMetadata();
  const cluster = requiredValue(outputs, "StorefrontClusterName");
  const serviceName = requiredValue(outputs, "StorefrontServiceName");
  const logGroupName = requiredValue(outputs, "StorefrontLogGroupName");
  const [stackEvents, service, logs] = await Promise.all([
    clients.cloudformation.send(
      new DescribeStackEventsCommand({ StackName: process.env.STACK_NAME })
    ),
    clients.ecs.send(
      new DescribeServicesCommand({ cluster, services: [serviceName] })
    ),
    clients.logs.send(
      new FilterLogEventsCommand({
        logGroupName,
        startTime,
        limit: 20,
        filterPattern: "?ERROR ?Error ?error ?Exception ?exception"
      })
    )
  ]);
  return {
    windowMinutes,
    cloudFormation: (stackEvents.StackEvents || [])
      .filter((event) => (event.Timestamp?.getTime() || 0) >= startTime)
      .slice(0, 12)
      .map((event) => ({
        timestamp: event.Timestamp?.toISOString(),
        resource: event.LogicalResourceId,
        type: event.ResourceType,
        status: event.ResourceStatus,
        reason: event.ResourceStatusReason
      })),
    ecs: (service.services?.[0]?.events || []).slice(0, 12).map((event) => ({
      timestamp: event.createdAt?.toISOString(),
      message: event.message
    })),
    errors: (logs.events || []).map((event) => ({
      timestamp: event.timestamp
        ? new Date(event.timestamp).toISOString()
        : undefined,
      message: event.message?.replace(/\s+/g, " ").trim().slice(0, 600)
    }))
  };
}
