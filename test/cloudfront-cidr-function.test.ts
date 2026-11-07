// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import {
  App,
  CustomResource,
  Stack
} from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  StorefrontEdgeConstruct,
  cloudFrontCidrFunctionCode
} from "../infra/cdk/lib/storefront-edge-construct";

interface ViewerRequestEvent {
  viewer: { ip: string };
  request: { uri: string };
}

type ViewerRequestHandler = (
  event: ViewerRequestEvent
) => ViewerRequestEvent["request"] | {
  statusCode: number;
  statusDescription: string;
};

function compileHandler(
  ipv4Cidr: string,
  ipv6Cidrs: readonly string[]
) {
  const code = cloudFrontCidrFunctionCode(ipv4Cidr, ipv6Cidrs);
  return new Function(`${code}\nreturn handler;`)() as ViewerRequestHandler;
}

function invoke(handler: ViewerRequestHandler, ip: string) {
  const request = { uri: "/" };
  return {
    request,
    response: handler({ viewer: { ip }, request })
  };
}

describe("CloudFront dual-stack viewer allowlist", () => {
  test("preserves the existing IPv4 CIDR behavior", () => {
    const handler = compileHandler("203.0.113.0/24", [
      "2001:db8:1234::/48"
    ]);
    const allowed = invoke(handler, "203.0.113.42");
    const denied = invoke(handler, "203.0.114.42");

    expect(allowed.response).toBe(allowed.request);
    expect(denied.response).toMatchObject({ statusCode: 403 });
  });

  test("accepts compressed and expanded IPv6 addresses within the CIDR", () => {
    const handler = compileHandler("203.0.113.0/24", [
      "2001:db8:1234::/48"
    ]);

    for (const address of [
      "2001:db8:1234::1",
      "2001:0db8:1234:0000:0000:0000:0000:ffff"
    ]) {
      const result = invoke(handler, address);
      expect(result.response).toBe(result.request);
    }
  });

  test("enforces IPv6 prefixes that do not end on a byte boundary", () => {
    const handler = compileHandler("203.0.113.0/24", [
      "2001:db8::/127"
    ]);

    expect(invoke(handler, "2001:db8::1").response).not.toMatchObject({
      statusCode: 403
    });
    expect(invoke(handler, "2001:db8::2").response).toMatchObject({
      statusCode: 403
    });
  });

  test("rejects IPv6 addresses outside the allowlist and malformed forms", () => {
    const handler = compileHandler("203.0.113.0/24", [
      "2001:db8:1234::/48"
    ]);

    for (const address of [
      "2001:db8:1235::1",
      "2001:db8::ffff:203.0.113.1",
      "2001:db8:::1",
      "fe80::1%eth0"
    ]) {
      expect(invoke(handler, address).response).toMatchObject({
        statusCode: 403
      });
    }
  });

  test("fails synthesis for invalid or excessive IPv6 CIDR configuration", () => {
    expect(() =>
      cloudFrontCidrFunctionCode("203.0.113.0/24", [
        "2001:db8::/129"
      ])
    ).toThrow("invalid IPv6 CIDR");
    expect(() =>
      cloudFrontCidrFunctionCode(
        "203.0.113.0/24",
        Array.from({ length: 33 }, () => "2001:db8::/32")
      )
    ).toThrow("at most 32 entries");
  });

  test("creates multiple independently scoped edge distributions", () => {
    const stack = new Stack(new App(), "EdgeReuse", {
      env: {
        account: "111111111111",
        region: "us-east-1"
      }
    });
    const vpc = new ec2.Vpc(stack, "Vpc", {
      maxAzs: 2,
      natGateways: 0
    });
    const readiness = {
      waitForCloudFrontVpcOrigin(id: string, originId: string) {
        return new CustomResource(stack, id, {
          serviceToken:
            "arn:aws:lambda:us-east-1:111111111111:function:edge-readiness",
          resourceType: "Custom::EdgeReadiness",
          properties: {
            Kind: "CloudFrontVpcOrigin",
            ResourceId: originId
          }
        });
      }
    };

    for (const id of ["Primary", "Secondary"]) {
      const loadBalancer = new elbv2.ApplicationLoadBalancer(
        stack,
        `${id}LoadBalancer`,
        {
          vpc,
          internetFacing: false
        }
      );
      new StorefrontEdgeConstruct(stack, `${id}Edge`, {
        environmentName: id.toLowerCase(),
        loadBalancer,
        allowedIpv4Cidr: "0.0.0.0/0",
        resourceReadiness: readiness
      });
    }

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::CloudFront::Distribution", 2);
    template.resourceCountIs("AWS::CloudFront::VpcOrigin", 2);
    template.resourceCountIs(
      "Custom::EdgeReadiness",
      2
    );
  });
});
