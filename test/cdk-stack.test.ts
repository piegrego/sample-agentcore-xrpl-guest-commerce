// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AgentCoreXrplPaymentsStack } from "../infra/cdk/lib/agentcore-xrpl-payments-stack";
import {
  createTestAccountId,
  createTestCommitSha,
  createTestSecretArn,
  createTestXrplAddress
} from "./fixtures";

const paymentSettings = {
  paymentMaxAmount: "2",
  paymentSessionLimit: "2",
  usdcNetwork: "eip155:84532",
  usdcAsset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  xrplMaxFeeDrops: "2000",
  xrplReconciliationIntervalSeconds: 30
} as const;

describe("AgentCoreXrplPaymentsStack", () => {
  test("synthesizes the storefront and AgentCore platform", () => {
    const app = new App();
    const account = createTestAccountId();
    const sourceCommitSha = createTestCommitSha();
    const stack = new AgentCoreXrplPaymentsStack(app, "TestPayments", {
      env: {
        account,
        region: "us-east-1"
      },
      config: {
        environmentName: "test",
        sourceCommitSha,
        account,
        region: "us-east-1",
        availabilityZones: ["dummy1a", "dummy1b"],
        authMode: "iam",
        allowedCidr: "10.0.0.0/8",
        allowedIpv6Cidrs: ["2001:db8::/32"],
        modelId: "amazon.nova-lite-v1:0",
        enablePayments: true,
        paymentBackend: "agentcore",
        paymentAsset: "USDC",
        ...paymentSettings,
        usdcPayTo: "0x2222222222222222222222222222222222222222",
        xrplNetwork: "xrpl:1"
      }
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::BedrockAgentCore::Runtime", 3);
    template.resourceCountIs("AWS::BedrockAgentCore::RuntimeEndpoint", 3);
    template.resourceCountIs("AWS::BedrockAgentCore::Memory", 2);
    template.resourceCountIs("AWS::BedrockAgentCore::Gateway", 1);
    template.resourceCountIs("AWS::BedrockAgentCore::GatewayTarget", 1);
    template.resourceCountIs("AWS::BedrockAgentCore::PolicyEngine", 1);
    template.resourceCountIs("AWS::BedrockAgentCore::Policy", 2);
    // Policy names are unique per account and Region, not per engine.
    template.hasResourceProperties("AWS::BedrockAgentCore::Policy", {
      Name: "DevOpsReadOnlyTest"
    });
    template.hasResourceProperties("AWS::BedrockAgentCore::Policy", {
      Name: "SecurityReadOnlyTest"
    });
    template.resourceCountIs("AWS::BedrockAgentCore::PaymentManager", 1);
    template.resourceCountIs("AWS::BedrockAgentCore::PaymentConnector", 1);
    template.resourceCountIs("AWS::Cognito::UserPool", 0);
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 0);
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    template.resourceCountIs("AWS::Logs::MetricFilter", 2);
    template.resourceCountIs("AWS::ECS::Service", 1);
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    template.resourceCountIs("AWS::CloudFront::VpcOrigin", 1);
    template.resourceCountIs(
      "Custom::AgentCoreResourceReadiness",
      4
    );
    template.hasResourceProperties(
      "Custom::AgentCoreResourceReadiness",
      {
        Kind: "CloudFrontVpcOrigin",
        ResourceId: {
          "Fn::GetAtt": [
            Match.stringLikeRegexp("VpcOrigin"),
            "Id"
          ]
        }
      }
    );
    template.hasResourceProperties(
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
      {
        Scheme: "internal"
      }
    );
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        Enabled: true,
        IPV6Enabled: true,
        HttpVersion: "http2and3",
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
          AllowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
        }
      }
    });
    template.resourceCountIs("AWS::CloudFront::Function", 1);
    template.hasResourceProperties("AWS::ECS::Service", {
      NetworkConfiguration: {
        AwsvpcConfiguration: {
          AssignPublicIp: "DISABLED"
        }
      }
    });

    template.hasResourceProperties("AWS::BedrockAgentCore::PaymentConnector", {
      ConnectorType: "CoinbaseCDP",
      ProvisionMode: "QUICK_CREATE"
    });
    template.resourceCountIs("Custom::AgentCoreRuntimeSubnetSelection", 0);
    const subnets = template.findResources("AWS::EC2::Subnet");
    expect(
      [...new Set(Object.values(subnets).map(
        (subnet: any) => subnet.Properties.AvailabilityZone
      ))].sort()
    ).toEqual(["dummy1a", "dummy1b"]);
    const privateSubnetRefs = Object.entries(subnets)
      .filter(([, subnet]: [string, any]) =>
        subnet.Properties.Tags.some(
          (tag: any) =>
            tag.Key === "aws-cdk:subnet-type" && tag.Value === "Private"
        )
      )
      .map(([logicalId]) => ({ Ref: logicalId }));
    expect(privateSubnetRefs).toHaveLength(2);
    for (const runtimeResource of Object.values(
      template.findResources("AWS::BedrockAgentCore::Runtime")
    )) {
      expect(
        runtimeResource.Properties.NetworkConfiguration.NetworkModeConfig
          .Subnets
      ).toEqual(privateSubnetRefs);
    }
    template.hasResourceProperties(
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
      { Scheme: "internal", Subnets: privateSubnetRefs }
    );
    template.hasResourceProperties("AWS::ECS::Service", {
      NetworkConfiguration: {
        AwsvpcConfiguration: { Subnets: privateSubnetRefs }
      }
    });
    const synthesizedTemplate = template.toJSON();
    const readinessResources = Object.entries(
      synthesizedTemplate.Resources as Record<string, any>
    ).filter(
      ([, resource]) =>
        resource.Type === "Custom::AgentCoreResourceReadiness"
    );
    const runtimeReadinessLogicalIds = readinessResources
      .filter(
        ([, resource]) =>
          resource.Properties.Kind === "AgentCoreRuntime"
      )
      .map(([logicalId]) => logicalId);
    const vpcOriginReadinessLogicalId = readinessResources.find(
      ([, resource]) =>
        resource.Properties.Kind === "CloudFrontVpcOrigin"
    )?.[0];
    expect(runtimeReadinessLogicalIds).toHaveLength(3);
    expect(vpcOriginReadinessLogicalId).toBeDefined();
    for (const logicalId of [
      "DevOpsRuntime",
      "SecurityRuntime",
      "ConciergeRuntime"
    ]) {
      expect(
        Object.keys(
          template.findResources("AWS::BedrockAgentCore::Runtime")
        )
      ).toContain(logicalId);
    }
    for (const logicalId of [
      "DevOpsLiveEndpoint",
      "SecurityLiveEndpoint",
      "ConciergeLiveEndpoint"
    ]) {
      expect(
        Object.keys(
          template.findResources(
            "AWS::BedrockAgentCore::RuntimeEndpoint"
          )
        )
      ).toContain(logicalId);
    }
    for (const logicalId of [
      "ResourceReadinessDevOpsRuntimeReady0DD2519A",
      "ResourceReadinessSecurityRuntimeReadyA630725D",
      "ResourceReadinessConciergeRuntimeReady591A95BE"
    ]) {
      expect(runtimeReadinessLogicalIds).toContain(logicalId);
    }
    for (const endpointResource of Object.values(
      template.findResources(
        "AWS::BedrockAgentCore::RuntimeEndpoint"
      )
    ) as any[]) {
      const dependencies = Array.isArray(endpointResource.DependsOn)
        ? endpointResource.DependsOn
        : [endpointResource.DependsOn].filter(Boolean);
      expect(
        dependencies.some((dependency: string) =>
          runtimeReadinessLogicalIds.includes(dependency)
        )
      ).toBe(true);
    }
    const distributionResource = Object.values(
      template.findResources("AWS::CloudFront::Distribution")
    )[0] as any;
    const distributionDependencies = Array.isArray(
      distributionResource.DependsOn
    )
      ? distributionResource.DependsOn
      : [distributionResource.DependsOn].filter(Boolean);
    expect(distributionDependencies).toContain(
      vpcOriginReadinessLogicalId
    );
    expect(
      Object.keys(
        template.findResources("AWS::CloudFront::Function")
      )
    ).toContain("StorefrontViewerAllowlist80B5FD92");
    expect(
      Object.keys(
        template.findResources("AWS::CloudFront::VpcOrigin")
      )
    ).toContain("StorefrontDistributionOrigin1VpcOriginA7D91E71");
    expect(
      Object.keys(
        template.findResources("AWS::CloudFront::Distribution")
      )
    ).toContain("StorefrontDistribution5DFDCD0D");
    expect(vpcOriginReadinessLogicalId).toBe(
      "ResourceReadinessStorefrontVpcOriginReadyDD6BE766"
    );
    template.resourceCountIs("AWS::EC2::NatGateway", 1);
    template.resourceCountIs("AWS::ServiceDiscovery::PrivateDnsNamespace", 1);
    template.hasResourceProperties("AWS::ServiceDiscovery::Service", {
      Name: "storefront",
      DnsConfig: {
        DnsRecords: [
          {
            TTL: 10,
            Type: "A"
          }
        ]
      }
    });
    expect(JSON.stringify(template.toJSON())).toContain(
      "http://storefront.agentcore-xrpl.local:4173"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "AgentRuntimeEndpointArn"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "bedrock-agentcore:InvokeAgentRuntimeForUser"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "bedrock-agentcore:GetPolicyEngine"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "bedrock-agentcore:AuthorizeAction"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "bedrock-agentcore:PartiallyAuthorizeActions"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "gateway/agentcorexrploperationstest*"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "AgentCore::IamEntity"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "OpsTools___get_deployment_health"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "OpsTools___audit_security_posture"
    );
    expect(JSON.stringify(template.toJSON())).toContain(
      "dynamodb:TransactWriteItems"
    );
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "dynamodb:UpdateItem",
              "dynamodb:TransactWriteItems"
            ]),
            Effect: "Allow",
            Resource: Match.arrayWith([
              Match.objectLike({
                "Fn::GetAtt": [
                  Match.stringLikeRegexp("EntitlementTable"),
                  "Arn"
                ]
              })
            ])
          })
        ])
      }
    });
    template.hasOutput("SourceCommitSha", {
      Value: sourceCommitSha
    });
    for (const outputName of [
      "StorefrontClusterName",
      "StorefrontServiceName",
      "StorefrontLogGroupName",
      "RuntimeRoleNames",
      "ApplicationSecurityGroupIds"
    ]) {
      template.hasOutput(outputName, {});
    }
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          ALLOWED_IPV6_CIDRS: "2001:db8::/32",
          SOURCE_COMMIT_SHA: sourceCommitSha
        })
      }
    });
    expect(JSON.stringify(template.toJSON())).toContain(
      "cloudformation:UpdateStack"
    );
    expect(JSON.stringify(template.toJSON())).not.toContain(
      "cloudformation:ListStackResources"
    );
    const runtimeImages = Object.values(
      template.findResources("AWS::BedrockAgentCore::Runtime")
    ).map(
      (resource) =>
        JSON.stringify(
          resource.Properties.AgentRuntimeArtifact.ContainerConfiguration
            .ContainerUri
        )
    );
    expect(new Set(runtimeImages).size).toBe(2);
    expect(
      runtimeImages.some(
        (image, index) => runtimeImages.indexOf(image) !== index
      )
    ).toBe(true);
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            Match.objectLike({
              Name: "PAYMENT_SESSION_LIMIT",
              Value: "2"
            }),
            Match.objectLike({
              Name: "USDC_PAY_TO",
              Value: "0x2222222222222222222222222222222222222222"
            }),
            Match.objectLike({
              Name: "XRPL_MAX_FEE_DROPS",
              Value: "2000"
            }),
            Match.objectLike({
              Name: "ENTITLEMENTS_TABLE_NAME",
              Value: Match.anyValue()
            })
          ])
        })
      ]),
      RuntimePlatform: {
        CpuArchitecture: "ARM64",
        OperatingSystemFamily: "LINUX"
      }
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" }
      ],
      SSESpecification: {
        SSEEnabled: true
      },
      TimeToLiveSpecification: {
        AttributeName: "expiresAt",
        Enabled: true
      },
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true
      },
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "settlement-state-updated",
          Projection: {
            ProjectionType: "ALL"
          }
        })
      ])
    });
    const entitlementTableResource = Object.values(
      template.findResources("AWS::DynamoDB::Table")
    )[0] as any;
    expect(
      entitlementTableResource.Properties.TableName
    ).toBeUndefined();
    expect(entitlementTableResource.DeletionPolicy).toBe(
      "RetainExceptOnCreate"
    );
    expect(entitlementTableResource.UpdateReplacePolicy).toBe(
      "Retain"
    );
  }, 20_000);

  test("can omit payment resources", () => {
    const app = new App();
    const account = createTestAccountId();
    const stack = new AgentCoreXrplPaymentsStack(app, "TestWithoutPayments", {
      env: {
        account,
        region: "us-east-1"
      },
      config: {
        environmentName: "test",
        sourceCommitSha: createTestCommitSha(),
        account,
        region: "us-east-1",
        availabilityZones: ["dummy1a", "dummy1b"],
        authMode: "iam",
        allowedCidr: "10.0.0.0/8",
        allowedIpv6Cidrs: [],
        modelId: "amazon.nova-lite-v1:0",
        enablePayments: false,
        paymentBackend: "sandbox",
        paymentAsset: "USDC",
        ...paymentSettings,
        xrplNetwork: "xrpl:1"
      }
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::BedrockAgentCore::PaymentManager", 0);
    template.resourceCountIs("AWS::BedrockAgentCore::PaymentConnector", 0);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        IPV6Enabled: false
      }
    });
    expect(JSON.stringify(template.toJSON())).not.toContain(
      "AgentCoreXrplPaymentsTest"
    );
  });

  test("can expose a shareable CloudFront URL without an IP allowlist", () => {
    const app = new App();
    const account = createTestAccountId();
    const stack = new AgentCoreXrplPaymentsStack(app, "TestShared", {
      env: {
        account,
        region: "us-east-1"
      },
      config: {
        environmentName: "shared",
        sourceCommitSha: createTestCommitSha(),
        account,
        region: "us-east-1",
        availabilityZones: ["dummy1a", "dummy1b"],
        authMode: "iam",
        allowedCidr: "0.0.0.0/0",
        allowedIpv6Cidrs: [],
        modelId: "amazon.nova-lite-v1:0",
        enablePayments: false,
        paymentBackend: "sandbox",
        paymentAsset: "USDC",
        ...paymentSettings,
        xrplNetwork: "xrpl:1"
      }
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    template.resourceCountIs("AWS::CloudFront::VpcOrigin", 1);
    template.resourceCountIs("AWS::CloudFront::Function", 0);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        IPV6Enabled: true
      }
    });
    expect(JSON.stringify(template.toJSON())).toContain(
      "CloudFrontDistributionId"
    );
  });

  test("wires direct XRPL without provisioning AgentCore Payments", () => {
    const app = new App();
    const account = createTestAccountId();
    const merchantAddress = createTestXrplAddress();
    const runtimePayerAddress = createTestXrplAddress();
    const secretArn = createTestSecretArn(account);
    const stack = new AgentCoreXrplPaymentsStack(app, "TestXrpl", {
      env: {
        account,
        region: "us-east-1"
      },
      config: {
        environmentName: "test",
        sourceCommitSha: createTestCommitSha(),
        account,
        region: "us-east-1",
        availabilityZones: ["dummy1a", "dummy1b"],
        authMode: "iam",
        allowedCidr: "10.0.0.0/8",
        allowedIpv6Cidrs: [],
        modelId: "amazon.nova-lite-v1:0",
        enablePayments: false,
        paymentBackend: "xrpl",
        paymentAsset: "XRP",
        ...paymentSettings,
        xrplNetwork: "xrpl:1",
        xrplMerchantAddress: merchantAddress,
        xrplRuntimePayerAddress: runtimePayerAddress,
        xrplWalletSeedSecretArn: secretArn
      }
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::BedrockAgentCore::Runtime", 3);
    template.resourceCountIs("AWS::BedrockAgentCore::PaymentManager", 0);
    template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      EnvironmentVariables: {
        PAYMENT_BACKEND: "xrpl",
        PAYMENT_ASSET: "XRP",
        PAYMENT_MAX_AMOUNT: "2",
        XRPL_NETWORK: "xrpl:1",
        XRPL_HTTP_URL: "",
        XRPL_MAX_FEE_DROPS: "2000",
        XRPL_RUNTIME_PAYER_ADDRESS: runtimePayerAddress,
        XRPL_WALLET_SEED_SECRET_ARN: secretArn,
        PAYMENT_MANAGER_ARN: "disabled"
      }
    });
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            Match.objectLike({
              Name: "XRPL_RUNTIME_PAYER_ADDRESS",
              Value: runtimePayerAddress
            })
          ])
        })
      ])
    });
    expect(JSON.stringify(template.toJSON())).toContain(secretArn);
  });
});
