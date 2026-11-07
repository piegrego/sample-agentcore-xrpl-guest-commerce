// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import path from "node:path";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { acknowledgeCdkNagFinding } from "./cdk-nag";

export interface OperationsToolsProps {
  readonly projectRoot: string;
  readonly stackName: string;
  readonly environmentName: string;
  readonly allowedCidr: string;
  readonly allowedIpv6Cidrs: readonly string[];
  readonly sourceCommitSha: string;
}

export function createOperationsTools(
  scope: Construct,
  props: OperationsToolsProps
) {
  const handler = new lambda.Function(scope, "OperationsTools", {
    description:
      "Read-only operational and security tools exposed through AgentCore Gateway.",
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    handler: "index.handler",
    code: lambda.Code.fromAsset(path.join(props.projectRoot, "ops-tools")),
    timeout: Duration.seconds(30),
    memorySize: 512,
    environment: {
      STACK_NAME: props.stackName,
      TABLE_PITR_ENABLED: "true",
      ALLOWED_CIDR: props.allowedCidr,
      ALLOWED_IPV6_CIDRS: props.allowedIpv6Cidrs.join(","),
      LOAD_BALANCER_SCHEME: "internal",
      ENVIRONMENT_NAME: props.environmentName,
      SOURCE_COMMIT_SHA: props.sourceCommitSha
    },
    logGroup: new logs.LogGroup(scope, "OperationsToolsLogGroup", {
      logGroupName:
        `/aws/lambda/agentcore-xrpl-demo-${props.environmentName}-operations-tools`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY
    })
  });
  handler.addToRolePolicy(
    new iam.PolicyStatement({
      actions: [
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "ecs:DescribeServices",
        "logs:FilterLogEvents",
        "ec2:DescribeSecurityGroups",
        "cloudfront:GetDistribution",
        "dynamodb:DescribeTable",
        "iam:GetRole",
        "iam:ListRolePolicies",
        "iam:GetRolePolicy"
      ],
      resources: ["*"]
    })
  );
  if (handler.role) {
    acknowledgeCdkNagFinding(
      handler.role,
      "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
      "The CDK Lambda construct attaches AWSLambdaBasicExecutionRole only for CloudWatch Logs delivery. The function's application permissions are defined in the inline, read-only policy below."
    );
    acknowledgeCdkNagFinding(
      handler.role,
      "AwsSolutions-IAM5[Resource::*]",
      "The operations function calls read-only Describe, Get, List, and Filter APIs whose resource-level authorization is unsupported or incomplete. It has no mutation actions, and the AgentCore Gateway policy restricts which tools can invoke it."
    );
  }
  return handler;
}
