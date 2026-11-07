// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Validations } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";

export interface AgentCoreXrplNetworkProps {
  readonly environmentName: string;
  readonly availabilityZones: readonly string[];
}

export interface AgentCoreXrplNetwork {
  readonly vpc: ec2.Vpc;
  readonly runtimeSecurityGroup: ec2.SecurityGroup;
  readonly cloudFrontOriginPrefixList: ec2.IPrefixList;
}

export function createAgentCoreXrplNetwork(
  scope: Construct,
  props: AgentCoreXrplNetworkProps
): AgentCoreXrplNetwork {
  const vpc = new ec2.Vpc(scope, "Vpc", {
    vpcName: `agentcore-xrpl-demo-${props.environmentName}`,
    availabilityZones: [...props.availabilityZones],
    natGateways: 1,
    subnetConfiguration: [
      {
        name: "public",
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24
      },
      {
        name: "runtime",
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: 24
      }
    ]
  });
  Validations.of(vpc).acknowledge({
    id: "AwsSolutions-VPC7",
    reason:
      "This short-lived, non-production sample omits VPC Flow Logs to avoid adding a continuous log-ingestion cost. Application, Runtime, ALB, and CloudFront telemetry remain available. Production adaptations must add VPC Flow Logs with an organization-approved retention policy."
  });
  const runtimeSecurityGroup = new ec2.SecurityGroup(
    scope,
    "RuntimeSecurityGroup",
    {
      vpc,
      allowAllOutbound: true,
      description:
        "Outbound access for AgentCore Runtime and private access to the storefront."
    }
  );
  const cloudFrontOriginPrefixList = ec2.PrefixList.fromLookup(
    scope,
    "CloudFrontOriginPrefixList",
    {
      prefixListName:
        "com.amazonaws.global.cloudfront.origin-facing"
    }
  );
  return { vpc, runtimeSecurityGroup, cloudFrontOriginPrefixList };
}
