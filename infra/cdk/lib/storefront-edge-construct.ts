// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  CfnResource,
  Duration,
  Validations
} from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import type * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

interface Ipv4CidrRule {
  readonly mask: number;
  readonly network: number;
}

interface Ipv6CidrRule {
  readonly network: readonly number[];
  readonly prefix: number;
}

function parseIpv4Cidr(cidr: string): Ipv4CidrRule {
  const [address, prefixText] = cidr.split("/");
  const octets = address?.split(".").map(Number) ?? [];
  const prefix = Number(prefixText);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) =>
        !Number.isInteger(octet) || octet < 0 || octet > 255
    ) ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    throw new Error(
      `CDK context "allowedCidr" must be a valid IPv4 CIDR, received "${cidr}".`
    );
  }

  const addressValue = octets.reduce(
    (value, octet) => ((value << 8) | octet) >>> 0,
    0
  );
  const mask =
    prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return {
    mask,
    network: (addressValue & mask) >>> 0
  };
}

function parseIpv6Address(address: string): number[] | undefined {
  if (
    !address ||
    address.includes(".") ||
    address.includes("%") ||
    (address.match(/::/g)?.length ?? 0) > 1 ||
    !/^[0-9a-f:]+$/i.test(address)
  ) {
    return undefined;
  }

  const compressed = address.includes("::");
  const [leftText, rightText = ""] = compressed
    ? address.split("::")
    : [address, ""];
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const validGroup = (group: string) =>
    /^[0-9a-f]{1,4}$/i.test(group);
  if (
    left.some((group) => !validGroup(group)) ||
    right.some((group) => !validGroup(group))
  ) {
    return undefined;
  }

  const omittedGroups = 8 - left.length - right.length;
  if (
    (!compressed && omittedGroups !== 0) ||
    (compressed && omittedGroups < 1)
  ) {
    return undefined;
  }
  const groups = [
    ...left,
    ...Array.from({ length: omittedGroups }, () => "0"),
    ...right
  ].map((group) => Number.parseInt(group, 16));
  if (groups.length !== 8) return undefined;

  return groups.flatMap((group) => [group >>> 8, group & 0xff]);
}

function parseIpv6Cidr(cidr: string): Ipv6CidrRule {
  const separator = cidr.lastIndexOf("/");
  const address = separator >= 0 ? cidr.slice(0, separator) : "";
  const prefixText =
    separator >= 0 ? cidr.slice(separator + 1) : "";
  const prefix = Number(prefixText);
  const bytes = parseIpv6Address(address);
  if (
    !bytes ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 128
  ) {
    throw new Error(
      `CDK context "allowedIpv6Cidrs" contains an invalid IPv6 CIDR: "${cidr}".`
    );
  }

  return {
    network: bytes.map((byte, index) => {
      const remainingBits = prefix - index * 8;
      if (remainingBits >= 8) return byte;
      if (remainingBits <= 0) return 0;
      return byte & ((0xff << (8 - remainingBits)) & 0xff);
    }),
    prefix
  };
}

export function cloudFrontCidrFunctionCode(
  ipv4Cidr: string,
  ipv6Cidrs: readonly string[] = []
): string {
  if (ipv6Cidrs.length > 32) {
    throw new Error(
      'CDK context "allowedIpv6Cidrs" supports at most 32 entries in this sample.'
    );
  }
  const ipv4Rule = parseIpv4Cidr(ipv4Cidr);
  const ipv6Rules = ipv6Cidrs.map(parseIpv6Cidr);

  const code = `var IPV6_RULES = ${JSON.stringify(ipv6Rules)};

function forbidden() {
  return { statusCode: 403, statusDescription: 'Forbidden' };
}

function parseIpv4(address) {
  var parts = address.split('.');
  if (parts.length !== 4) return null;
  var value = 0;
  for (var index = 0; index < 4; index += 1) {
    var octet = Number(parts[index]);
    if (octet < 0 || octet > 255 || octet !== Math.floor(octet)) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

function parseIpv6(address) {
  if (!address || address.indexOf('.') !== -1 || address.indexOf('%') !== -1) return null;
  if (!/^[0-9a-f:]+$/i.test(address)) return null;
  if ((address.match(/::/g) || []).length > 1) return null;
  var compressed = address.indexOf('::') !== -1;
  var halves = compressed ? address.split('::') : [address, ''];
  var left = halves[0] ? halves[0].split(':') : [];
  var right = halves[1] ? halves[1].split(':') : [];
  var omitted = 8 - left.length - right.length;
  if ((!compressed && omitted !== 0) || (compressed && omitted < 1)) return null;
  var zeros = [];
  for (var zeroIndex = 0; zeroIndex < omitted; zeroIndex += 1) zeros.push('0');
  var groups = left.concat(zeros, right);
  if (groups.length !== 8) return null;
  var bytes = [];
  for (var index = 0; index < groups.length; index += 1) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[index])) return null;
    var group = parseInt(groups[index], 16);
    bytes.push(group >>> 8, group & 255);
  }
  return bytes;
}

function matchesIpv6(address, rule) {
  var fullBytes = Math.floor(rule.prefix / 8);
  var remainingBits = rule.prefix % 8;
  for (var index = 0; index < fullBytes; index += 1) {
    if (address[index] !== rule.network[index]) return false;
  }
  if (remainingBits > 0) {
    var mask = (255 << (8 - remainingBits)) & 255;
    if ((address[fullBytes] & mask) !== rule.network[fullBytes]) return false;
  }
  return true;
}

function handler(event) {
  var address = event.viewer.ip;
  if (address.indexOf(':') !== -1) {
    var ipv6 = parseIpv6(address);
    if (!ipv6) return forbidden();
    for (var index = 0; index < IPV6_RULES.length; index += 1) {
      if (matchesIpv6(ipv6, IPV6_RULES[index])) return event.request;
    }
    return forbidden();
  }

  var ipv4 = parseIpv4(address);
  if (ipv4 === null) return forbidden();
  if (((ipv4 & ${ipv4Rule.mask}) >>> 0) !== ${ipv4Rule.network}) return forbidden();
  return event.request;
}`;
  if (new TextEncoder().encode(code).length > 10_000) {
    throw new Error(
      "The generated CloudFront viewer allowlist exceeds the 10 KB function code limit."
    );
  }
  return code;
}

export interface StorefrontEdgeConstructProps {
  readonly environmentName: string;
  readonly loadBalancer: elbv2.IApplicationLoadBalancer;
  readonly allowedIpv4Cidr: string;
  readonly allowedIpv6Cidrs?: readonly string[];
  readonly resourceReadiness: StorefrontEdgeReadiness;
  /**
   * Creates the migrated resources at their original stack paths. This keeps
   * existing CloudFormation logical IDs and generated physical names stable.
   * New consumers should omit this option so the construct owns its children.
   */
  readonly preserveLegacyResourcePaths?: boolean;
}

export interface StorefrontEdgeReadiness {
  waitForCloudFrontVpcOrigin(
    id: string,
    originId: string
  ): import("aws-cdk-lib").CustomResource;
}

export class StorefrontEdgeConstruct extends Construct {
  readonly distribution: cloudfront.Distribution;
  readonly viewerRequestFunction?: cloudfront.Function;
  readonly vpcOrigin: cloudfront.CfnVpcOrigin;

  constructor(
    scope: Construct,
    id: string,
    props: StorefrontEdgeConstructProps
  ) {
    super(scope, id);

    const resourceScope = props.preserveLegacyResourcePaths
      ? scope
      : this;
    const allowedIpv6Cidrs = props.allowedIpv6Cidrs ?? [];
    this.viewerRequestFunction =
      props.allowedIpv4Cidr === "0.0.0.0/0" &&
      allowedIpv6Cidrs.length === 0
        ? undefined
        : new cloudfront.Function(
            resourceScope,
            "StorefrontViewerAllowlist",
            {
              comment:
                `Restricts the AgentCore XRPL ${props.environmentName} demo to configured IPv4 and IPv6 CIDRs.`,
              runtime: cloudfront.FunctionRuntime.JS_2_0,
              code: cloudfront.FunctionCode.fromInline(
                cloudFrontCidrFunctionCode(
                  props.allowedIpv4Cidr,
                  allowedIpv6Cidrs
                )
              )
            }
          );

    const enableViewerIpv6 =
      props.allowedIpv4Cidr === "0.0.0.0/0" ||
      allowedIpv6Cidrs.length > 0;
    // A restrictive IPv4-only deployment must not publish an AAAA route that
    // its edge function will always reject. Supplying an IPv6 CIDR enables
    // dual-stack viewing while the VPC origin remains IPv4.
    this.distribution = new cloudfront.Distribution(
      resourceScope,
      "StorefrontDistribution",
      {
        comment:
          `HTTPS entry point for the AgentCore XRPL ${props.environmentName} demo`,
        defaultBehavior: {
          origin:
            cloudfrontOrigins.VpcOrigin.withApplicationLoadBalancer(
              props.loadBalancer,
              {
                protocolPolicy:
                  cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                readTimeout: Duration.seconds(120),
                keepaliveTimeout: Duration.seconds(60)
              }
            ),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          functionAssociations: this.viewerRequestFunction
            ? [
                {
                  function: this.viewerRequestFunction,
                  eventType:
                    cloudfront.FunctionEventType.VIEWER_REQUEST
                }
              ]
            : undefined
        },
        enableIpv6: enableViewerIpv6,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100
      }
    );

    const vpcOrigin = this.distribution.node
      .findAll()
      .find(cloudfront.CfnVpcOrigin.isCfnVpcOrigin);
    if (!vpcOrigin) {
      throw new Error(
        "The storefront distribution did not synthesize a CloudFront VPC origin."
      );
    }
    this.vpcOrigin = vpcOrigin;
    const readinessId = props.preserveLegacyResourcePaths
      ? "StorefrontVpcOriginReady"
      : `${id}VpcOriginReady`;
    const vpcOriginReady =
      props.resourceReadiness.waitForCloudFrontVpcOrigin(
        readinessId,
        this.vpcOrigin.attrId
      );
    (
      this.distribution.node.defaultChild as CfnResource
    ).addResourceDependency(
      vpcOriginReady.node.defaultChild as CfnResource
    );

    Validations.of(this.distribution).acknowledge({
      id: "AwsSolutions-CFR1",
      reason:
        "The sample has no geographic licensing or residency requirement. Production owners must add geographic restrictions when their content or policy requires them."
    });
    Validations.of(this.distribution).acknowledge({
      id: "AwsSolutions-CFR2",
      reason:
        "AWS WAF is omitted from this short-lived sample to avoid a continuous fixed cost. The optional CIDR allowlist limits viewers at the edge. Production adaptations must add an organization-approved WAF policy."
    });
    Validations.of(this.distribution).acknowledge({
      id: "AwsSolutions-CFR3",
      reason:
        "This short-lived, non-production sample omits CloudFront standard-log storage to control setup and storage costs. Application and Runtime logs provide demo telemetry. Production adaptations must enable edge access logging with an approved retention policy."
    });
    Validations.of(this.distribution).acknowledge({
      id: "AwsSolutions-CFR4",
      reason:
        "The sample uses the CloudFront default domain and managed certificate so users can deploy without owning a domain. CloudFront does not allow the sample to configure the default certificate's minimum protocol. Production adaptations must use a custom domain, ACM certificate, and TLSv1.2_2021 or newer security policy."
    });
  }
}
