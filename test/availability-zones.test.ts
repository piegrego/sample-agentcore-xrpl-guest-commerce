// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import {
  AGENTCORE_RUNTIME_SUPPORTED_AVAILABILITY_ZONE_IDS,
  CLOUDFRONT_VPC_ORIGIN_UNSUPPORTED_AVAILABILITY_ZONE_IDS,
  selectAvailabilityZoneNames,
  supportedAvailabilityZoneIds
} from "../infra/cdk/lib/availability-zones";

// AZ names map to different IDs in each account; this mirrors one real account.
const US_EAST_1_ZONES = [
  { zoneName: "us-east-1a", zoneId: "use1-az6" },
  { zoneName: "us-east-1b", zoneId: "use1-az1" },
  { zoneName: "us-east-1c", zoneId: "use1-az2" },
  { zoneName: "us-east-1d", zoneId: "use1-az4" },
  { zoneName: "us-east-1e", zoneId: "use1-az3" },
  { zoneName: "us-east-1f", zoneId: "use1-az5" }
];

describe("Availability Zone selection", () => {
  test("maps supported AZ IDs to this account's AZ names", () => {
    expect(selectAvailabilityZoneNames("us-east-1", US_EAST_1_ZONES)).toEqual([
      "us-east-1b",
      "us-east-1c",
      "us-east-1d"
    ]);
  });

  test("excludes AZ IDs that CloudFront VPC origins reject", () => {
    for (const region of Object.keys(
      AGENTCORE_RUNTIME_SUPPORTED_AVAILABILITY_ZONE_IDS
    )) {
      const ids = supportedAvailabilityZoneIds(region);
      expect(ids.length).toBeGreaterThanOrEqual(2);
      for (const excluded of CLOUDFRONT_VPC_ORIGIN_UNSUPPORTED_AVAILABILITY_ZONE_IDS) {
        expect(ids).not.toContain(excluded);
      }
    }
  });

  test("requires at least two supported AZs", () => {
    expect(() =>
      selectAvailabilityZoneNames("us-east-1", [
        { zoneName: "us-east-1a", zoneId: "use1-az1" },
        { zoneName: "us-east-1e", zoneId: "use1-az3" }
      ])
    ).toThrow("At least 2");
  });

  test("contains only valid, unique AZ IDs", () => {
    for (const ids of Object.values(
      AGENTCORE_RUNTIME_SUPPORTED_AVAILABILITY_ZONE_IDS
    )) {
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^[a-z0-9]+-az[0-9]+$/);
      }
    }
  });

  test("fails closed for undocumented Regions, including GovCloud", () => {
    expect(() => supportedAvailabilityZoneIds("moon-east-1")).toThrow(
      "not documented"
    );
    expect(() => supportedAvailabilityZoneIds("us-gov-west-1")).toThrow(
      "not documented"
    );
  });
});
