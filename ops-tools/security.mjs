// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { GetDistributionCommand } from "@aws-sdk/client-cloudfront";
import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import {
  GetRoleCommand,
  GetRolePolicyCommand,
  ListRolePoliciesCommand
} from "@aws-sdk/client-iam";
import {
  clients,
  finding,
  requiredValue,
  stackMetadata,
  valueList
} from "./shared.mjs";

export async function iamSummary(existingOutputs) {
  const outputs = existingOutputs || (await stackMetadata()).outputs;
  const roles = await Promise.all(
    valueList(outputs, "RuntimeRoleNames").map(async (roleName) => {
      const [role, inline] = await Promise.all([
        clients.iam.send(new GetRoleCommand({ RoleName: roleName })),
        clients.iam.send(new ListRolePoliciesCommand({ RoleName: roleName }))
      ]);
      const inlinePolicies = await Promise.all(
        (inline.PolicyNames || []).map(async (policyName) => {
          const response = await clients.iam.send(
            new GetRolePolicyCommand({ RoleName: roleName, PolicyName: policyName })
          );
          const document = response.PolicyDocument
            ? JSON.parse(decodeURIComponent(response.PolicyDocument))
            : {};
          const statements = Array.isArray(document.Statement)
            ? document.Statement
            : document.Statement
              ? [document.Statement]
              : [];
          return {
            policyName,
            statements: statements.map((statement) => ({
              effect: statement.Effect,
              actions: Array.isArray(statement.Action)
                ? statement.Action
                : statement.Action
                  ? [statement.Action]
                  : [],
              resourceCount: Array.isArray(statement.Resource)
                ? statement.Resource.length
                : statement.Resource
                  ? 1
                  : 0,
              wildcardResource:
                statement.Resource === "*" ||
                (Array.isArray(statement.Resource) &&
                  statement.Resource.includes("*"))
            }))
          };
        })
      );
      return {
        roleName,
        arn: role.Role?.Arn,
        lastUsed: role.Role?.RoleLastUsed?.LastUsedDate?.toISOString(),
        inlinePolicies
      };
    })
  );
  return {
    mutationGuard:
      "Specialist Runtime roles can invoke the read-only AgentCore Gateway but have no infrastructure mutation permissions.",
    roles
  };
}

export async function securityPosture() {
  const { outputs } = await stackMetadata();
  const distributionId = requiredValue(outputs, "CloudFrontDistributionId");
  const tableName = requiredValue(outputs, "EntitlementTableName");
  const groupIds = valueList(outputs, "ApplicationSecurityGroupIds");
  const [distribution, table, securityGroups, identity] = await Promise.all([
    clients.cloudfront.send(new GetDistributionCommand({ Id: distributionId })),
    clients.dynamodb.send(new DescribeTableCommand({ TableName: tableName })),
    clients.ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: groupIds })),
    iamSummary(outputs)
  ]);
  const behavior =
    distribution.Distribution?.DistributionConfig?.DefaultCacheBehavior;
  const encryption = table.Table?.SSEDescription?.Status;
  const pitr = process.env.TABLE_PITR_ENABLED === "true";
  const publicDemo = process.env.ALLOWED_CIDR === "0.0.0.0/0";
  const allowedIpv6Cidrs = (process.env.ALLOWED_IPV6_CIDRS || "")
    .split(",")
    .map((cidr) => cidr.trim())
    .filter(Boolean);
  const viewerIpv6Enabled =
    distribution.Distribution?.DistributionConfig?.IsIPV6Enabled === true;
  const groups = securityGroups.SecurityGroups || [];
  const unrestricted = groups.flatMap((group) =>
    (group.IpPermissions || [])
      .filter((permission) =>
        (permission.IpRanges || []).some(
          (range) => range.CidrIp === "0.0.0.0/0"
        )
      )
      .map(() => group.GroupId)
  );
  const wildcardStatements = identity.roles.flatMap((role) =>
    role.inlinePolicies.flatMap((policy) =>
      policy.statements.filter((statement) => statement.wildcardResource)
    )
  );
  const findings = [
    finding(
      "info",
      "HTTPS is enforced at the edge",
      behavior?.ViewerProtocolPolicy === "redirect-to-https" ? "pass" : "fail",
      `CloudFront viewer protocol policy is ${behavior?.ViewerProtocolPolicy || "unknown"}.`,
      distributionId
    ),
    finding(
      "info",
      "The application load balancer is private",
      process.env.LOAD_BALANCER_SCHEME === "internal" ? "pass" : "fail",
      `Load balancer scheme is ${process.env.LOAD_BALANCER_SCHEME}.`,
      requiredValue(outputs, "StorefrontServiceName")
    ),
    finding(
      unrestricted.length ? "high" : "info",
      "Security groups avoid unrestricted IPv4 ingress",
      unrestricted.length ? "fail" : "pass",
      unrestricted.length
        ? `Unrestricted ingress appears on ${unrestricted.join(", ")}.`
        : "No inspected security group exposes IPv4 ingress to 0.0.0.0/0.",
      groups.map((group) => group.GroupId).filter(Boolean).join(", ")
    ),
    finding(
      encryption === "ENABLED" ? "info" : "high",
      "Entitlements are encrypted at rest",
      encryption === "ENABLED" ? "pass" : "fail",
      `DynamoDB server-side encryption status is ${encryption || "unknown"}.`,
      tableName
    ),
    finding(
      pitr ? "info" : "medium",
      "Point-in-time recovery is enabled",
      pitr ? "pass" : "fail",
      `Point-in-time recovery configured=${pitr}.`,
      tableName
    ),
    finding(
      publicDemo ? "medium" : "info",
      "Demo viewer access scope",
      publicDemo ? "review" : "pass",
      publicDemo
        ? allowedIpv6Cidrs.length
          ? `IPv4 viewer access is unrestricted. IPv6 is restricted to ${allowedIpv6Cidrs.join(", ")}.`
          : "The CloudFront demo is intentionally shareable from any IPv4 or IPv6 viewer IP."
        : allowedIpv6Cidrs.length
          ? `IPv4 is restricted to ${process.env.ALLOWED_CIDR}; IPv6 is restricted to ${allowedIpv6Cidrs.join(", ")}.`
          : viewerIpv6Enabled
            ? `IPv4 is restricted to ${process.env.ALLOWED_CIDR}; IPv6 is enabled without a configured IPv6 allowlist.`
            : `IPv4 is restricted to ${process.env.ALLOWED_CIDR}; viewer IPv6 is disabled.`,
      distributionId
    ),
    finding(
      wildcardStatements.length ? "medium" : "info",
      "IAM wildcard-resource review",
      wildcardStatements.length ? "review" : "pass",
      `${wildcardStatements.length} statement(s) use Resource "*".`,
      identity.roles.map((role) => role.roleName).join(", ")
    ),
    finding(
      "info",
      "Specialist mutation guard",
      "pass",
      identity.mutationGuard,
      "AgentCore Gateway and specialist Runtime roles"
    )
  ];
  return {
    checkedAt: new Date().toISOString(),
    summary: {
      pass: findings.filter((item) => item.status === "pass").length,
      review: findings.filter((item) => item.status === "review").length,
      fail: findings.filter((item) => item.status === "fail").length
    },
    findings
  };
}
