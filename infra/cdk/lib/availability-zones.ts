// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  DescribeAvailabilityZonesCommand,
  EC2Client
} from "@aws-sdk/client-ec2";

// AZ IDs supported by AgentCore Runtime VPC mode.
// Source: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-vpc.html
export const AGENTCORE_RUNTIME_SUPPORTED_AVAILABILITY_ZONE_IDS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  "ap-northeast-1": ["apne1-az1", "apne1-az2", "apne1-az4"],
  "ap-northeast-2": ["apne2-az1", "apne2-az2", "apne2-az3"],
  "ap-south-1": ["aps1-az1", "aps1-az2", "aps1-az3"],
  "ap-south-2": ["aps2-az1", "aps2-az2", "aps2-az3"],
  "ap-southeast-1": ["apse1-az1", "apse1-az2", "apse1-az3"],
  "ap-southeast-2": ["apse2-az1", "apse2-az2", "apse2-az3"],
  "ap-southeast-5": ["apse5-az1", "apse5-az2", "apse5-az3"],
  "ap-southeast-7": ["apse7-az1", "apse7-az2", "apse7-az3"],
  "ca-central-1": ["cac1-az1", "cac1-az2", "cac1-az4"],
  "eu-central-1": ["euc1-az1", "euc1-az2", "euc1-az3"],
  "eu-north-1": ["eun1-az1", "eun1-az2", "eun1-az3"],
  "eu-south-1": ["eus1-az1", "eus1-az2", "eus1-az3"],
  "eu-south-2": ["eus2-az1", "eus2-az2", "eus2-az3"],
  "eu-west-1": ["euw1-az1", "euw1-az2", "euw1-az3"],
  "eu-west-2": ["euw2-az1", "euw2-az2", "euw2-az3"],
  "eu-west-3": ["euw3-az1", "euw3-az2", "euw3-az3"],
  "sa-east-1": ["sae1-az1", "sae1-az2", "sae1-az3"],
  "us-east-1": ["use1-az1", "use1-az2", "use1-az4"],
  "us-east-2": ["use2-az1", "use2-az2", "use2-az3"],
  "us-west-1": ["usw1-az1", "usw1-az3"],
  "us-west-2": ["usw2-az1", "usw2-az2", "usw2-az3"]
});

// AZ IDs where CloudFront VPC origins are unavailable.
// Source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html#vpc-origins-supported-regions
export const CLOUDFRONT_VPC_ORIGIN_UNSUPPORTED_AVAILABILITY_ZONE_IDS: readonly string[] =
  Object.freeze(["use1-az3", "usw1-az2", "apne1-az3", "cac1-az3"]);

export const MINIMUM_AVAILABILITY_ZONES = 2;

export interface AvailabilityZone {
  readonly zoneName: string;
  readonly zoneId: string;
}

/** AZ IDs usable by both the Runtimes and the CloudFront VPC origin ALB. */
export function supportedAvailabilityZoneIds(region: string): readonly string[] {
  const runtimeIds = AGENTCORE_RUNTIME_SUPPORTED_AVAILABILITY_ZONE_IDS[region];
  if (!runtimeIds) {
    throw new Error(
      `AgentCore Runtime VPC Availability Zones are not documented for Region "${region}".`
    );
  }
  return runtimeIds.filter(
    (id) => !CLOUDFRONT_VPC_ORIGIN_UNSUPPORTED_AVAILABILITY_ZONE_IDS.includes(id)
  );
}

/** Returns the account-specific AZ names whose stable IDs are supported. */
export function selectAvailabilityZoneNames(
  region: string,
  zones: readonly AvailabilityZone[]
): string[] {
  const supportedIds = supportedAvailabilityZoneIds(region);
  const selected = zones
    .filter((zone) => supportedIds.includes(zone.zoneId))
    .sort((left, right) => left.zoneId.localeCompare(right.zoneId))
    .map((zone) => zone.zoneName);
  if (selected.length < MINIMUM_AVAILABILITY_ZONES) {
    throw new Error(
      `At least ${MINIMUM_AVAILABILITY_ZONES} supported Availability Zones are required in ${region}. ` +
        `Account AZ IDs: ${zones.map((zone) => zone.zoneId).sort().join(", ") || "none"}. ` +
        `Supported AZ IDs: ${supportedIds.join(", ")}.`
    );
  }
  return selected;
}

export async function lookupAvailabilityZoneNames(
  region: string
): Promise<string[]> {
  const response = await new EC2Client({ region }).send(
    new DescribeAvailabilityZonesCommand({
      Filters: [
        { Name: "zone-type", Values: ["availability-zone"] },
        { Name: "state", Values: ["available"] }
      ]
    })
  );
  const zones = (response.AvailabilityZones ?? []).flatMap((zone) =>
    zone.ZoneName && zone.ZoneId
      ? [{ zoneName: zone.ZoneName, zoneId: zone.ZoneId }]
      : []
  );
  return selectAvailabilityZoneNames(region, zones);
}
