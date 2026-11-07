// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import path from "node:path";
import {
  CfnOutput,
  CfnResource,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps
} from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import type { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import type { Construct } from "constructs";
import { AgentCoreRuntimeConstruct } from "./agentcore-runtime-construct";
import { MINIMUM_AVAILABILITY_ZONES } from "./availability-zones";
import { acknowledgeCdkNagFinding } from "./cdk-nag";
import { AgentCoreXrplContainerAssets } from "./container-assets";
import type { AgentCoreXrplConfiguration } from "./config";
import { createAgentCoreXrplNetwork } from "./network-construct";
import { createOperationsTools } from "./operations-tools-construct";
import { ResourceReadinessProvider } from "./resource-readiness";
import { StorefrontEdgeConstruct } from "./storefront-edge-construct";

export {
  cloudFrontCidrFunctionCode
} from "./storefront-edge-construct";

export interface AgentCoreXrplPaymentsStackProps extends StackProps {
  readonly config: AgentCoreXrplConfiguration;
}

function resourceName(prefix: string, environmentName: string): string {
  const suffix = environmentName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `${prefix}${suffix}`.slice(0, 48);
}

export class AgentCoreXrplPaymentsStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: AgentCoreXrplPaymentsStackProps
  ) {
    super(scope, id, props);

    const { config } = props;
    const projectRoot = path.resolve(import.meta.dir, "../../..");
    const commonTags = {
      Application: "AgentCoreXrplPaymentsDemo",
      Environment: config.environmentName
    };

    // No fixed name: the table is retained on delete and would block redeploys.
    const entitlementTable = new dynamodb.Table(this, "EntitlementTable", {
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      // Delete a table created by a failed deployment rollback, but retain an
      // established table during normal stack deletion or replacement.
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
    });
    entitlementTable.addGlobalSecondaryIndex({
      indexName: "settlement-state-updated",
      partitionKey: {
        name: "state",
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "updatedAt",
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    const memory = new agentcore.CfnMemory(this, "ConciergeMemory", {
      name: resourceName("AgentCoreXrplMemory", config.environmentName),
      description:
        "Conversation events and non-authoritative movie preferences for the media concierge.",
      eventExpiryDuration: 30,
      memoryStrategies: [
        {
          userPreferenceMemoryStrategy: {
            name: "MoviePreferences",
            description:
              "Extract viewing preferences such as genres, languages, and caption choices.",
            namespaceTemplates: ["/users/{actorId}/preferences"]
          }
        }
      ],
      tags: commonTags
    });
    memory.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const opsMemory = new agentcore.CfnMemory(this, "OperationsMemory", {
      name: resourceName("AgentCoreXrplOpsMemory", config.environmentName),
      description:
        "Non-authoritative operational findings and investigation summaries for the specialist agents.",
      eventExpiryDuration: 30,
      memoryStrategies: [
        {
          semanticMemoryStrategy: {
            name: "OperationsKnowledge",
            description:
              "Extract durable deployment observations, accepted risks, and investigation outcomes.",
            namespaceTemplates: ["/users/{actorId}/operations"]
          }
        }
      ],
      tags: commonTags
    });
    opsMemory.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const paymentManagerName = resourceName(
      "AgentCoreXrplPayments",
      config.environmentName
    );

    const paymentManagerRole = config.enablePayments
      ? new iam.Role(this, "PaymentManagerRole", {
          assumedBy: new iam.ServicePrincipal(
            "bedrock-agentcore.amazonaws.com",
            {
              conditions: {
                StringEquals: {
                  "aws:SourceAccount": this.account
                },
                ArnLike: {
                  "aws:SourceArn": `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:payment-manager/${paymentManagerName}-*`
                }
              }
            }
          ),
          description:
            "Service role used by AgentCore Payments for workload identity and connector credentials."
        })
      : undefined;

    paymentManagerRole?.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateWorkloadIdentity",
          "bedrock-agentcore:GetWorkloadIdentity",
          "bedrock-agentcore:DeleteWorkloadIdentity",
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetResourcePaymentToken",
          "bedrock-agentcore:CreatePaymentCredentialProvider",
          "bedrock-agentcore:GetPaymentCredentialProvider",
          "bedrock-agentcore:TagResource"
        ],
        resources: [
          `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default`,
          `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/workload-identity/*`,
          `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/payment-credential-provider/*`
        ]
      })
    );
    if (paymentManagerRole) {
      const paymentManagerWildcardReason =
        "AgentCore Payments creates workload identities and credential providers with service-generated identifiers. The policy limits wildcards to the default AgentCore identity directory, token vault, and bedrock-agentcore-prefixed connector secrets in this account and Region.";
      acknowledgeCdkNagFinding(
        paymentManagerRole,
        `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/workload-identity/*]`,
        paymentManagerWildcardReason
      );
      acknowledgeCdkNagFinding(
        paymentManagerRole,
        `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/payment-credential-provider/*]`,
        paymentManagerWildcardReason
      );
      acknowledgeCdkNagFinding(
        paymentManagerRole,
        `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-*]`,
        paymentManagerWildcardReason
      );
    }
    paymentManagerRole?.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-*`
        ]
      })
    );

    const paymentManager = config.enablePayments
      ? new agentcore.CfnPaymentManager(this, "PaymentManager", {
          name: paymentManagerName,
          description:
            "Budget bounded payment manager for the x402 storefront demo",
          roleArn: paymentManagerRole!.roleArn,
          authorizerType: "AWS_IAM",
          tags: Object.entries(commonTags).map(([key, value]) => ({
            key,
            value
          }))
        })
      : undefined;

    paymentManager?.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const paymentConnector = paymentManager
      ? new agentcore.CfnPaymentConnector(this, "CoinbaseConnector", {
          connectorName: resourceName(
            "AgentCoreXrplCoinbase",
            config.environmentName
          ),
          description:
            "Coinbase CDP test wallet connector provisioned with Quick Create",
          connectorType: "CoinbaseCDP",
          paymentManagerId: paymentManager.attrPaymentManagerId,
          provisionMode: "QUICK_CREATE"
        })
      : undefined;
    paymentConnector?.applyRemovalPolicy(RemovalPolicy.DESTROY);

    if (config.availabilityZones.length < MINIMUM_AVAILABILITY_ZONES) {
      throw new Error(
        `At least ${MINIMUM_AVAILABILITY_ZONES} Availability Zones are required.`
      );
    }
    const network = createAgentCoreXrplNetwork(this, {
      environmentName: config.environmentName,
      availabilityZones: config.availabilityZones
    });
    const {
      vpc,
      runtimeSecurityGroup,
      cloudFrontOriginPrefixList
    } = network;
    const runtimeSubnetIds = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
    }).subnetIds;
    const resourceReadiness = new ResourceReadinessProvider(
      this,
      "ResourceReadiness",
      { projectRoot }
    );
    const images = new AgentCoreXrplContainerAssets(
      this,
      "ContainerAssets",
      {
        projectRoot
      }
    );

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: `agentcore-xrpl-demo-${config.environmentName}`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED
    });
    const serviceNamespace = cluster.addDefaultCloudMapNamespace({
      name: "agentcore-xrpl.local"
    });

    const storefrontLogGroup = new logs.LogGroup(
      this,
      "StorefrontApplicationLogGroup",
      {
        logGroupName:
          `/ecs/agentcore-xrpl-demo-${config.environmentName}-storefront`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY
      }
    );
    const reconciliationFailureMetric = new logs.MetricFilter(
      this,
      "PaymentReconciliationFailureMetric",
      {
        logGroup: storefrontLogGroup,
        filterPattern: logs.FilterPattern.stringValue(
          "$.event",
          "=",
          "payment.reconciliation.failed"
        ),
        metricNamespace: "AgentCoreXrplDemo/Payments",
        metricName: "ReconciliationFailures",
        metricValue: "1",
        defaultValue: 0
      }
    );
    const reconciliationPendingMetric = new logs.MetricFilter(
      this,
      "PaymentReconciliationPendingMetric",
      {
        logGroup: storefrontLogGroup,
        filterPattern: logs.FilterPattern.stringValue(
          "$.event",
          "=",
          "payment.reconciliation.pending"
        ),
        metricNamespace: "AgentCoreXrplDemo/Payments",
        metricName: "PendingReconciliations",
        metricValue: "1",
        defaultValue: 0
      }
    );
    new cloudwatch.Alarm(this, "PaymentReconciliationFailureAlarm", {
      alarmName:
        `agentcore-xrpl-demo-${config.environmentName}-payment-reconciliation-failed`,
      alarmDescription:
        "A submitted XRPL settlement failed ledger invariant checks.",
      metric: reconciliationFailureMetric.metric({
        period: Duration.minutes(5),
        statistic: "Sum"
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    new cloudwatch.Alarm(this, "PaymentReconciliationStuckAlarm", {
      alarmName:
        `agentcore-xrpl-demo-${config.environmentName}-payment-reconciliation-stuck`,
      alarmDescription:
        "XRPL settlements remained pending across repeated reconciliation runs.",
      metric: reconciliationPendingMetric.metric({
        period: Duration.minutes(5),
        statistic: "Sum"
      }),
      threshold: 6,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    const storefront = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "Storefront",
      {
        cluster,
        publicLoadBalancer: false,
        openListener: false,
        listenerPort: 80,
        assignPublicIp: false,
        desiredCount: 1,
        enableExecuteCommand: false,
        circuitBreaker: {
          rollback: true
        },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        healthCheck: {
          command: [
            "CMD-SHELL",
            "bun -e \"const response = await fetch('http://127.0.0.1:4173/health'); process.exit(response.ok ? 0 : 1)\""
          ],
          interval: Duration.seconds(30),
          retries: 3,
          startPeriod: Duration.seconds(10),
          timeout: Duration.seconds(5)
        },
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX
        },
        taskSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        },
        cloudMapOptions: {
          name: "storefront",
          cloudMapNamespace: serviceNamespace,
          dnsTtl: Duration.seconds(10)
        },
        taskImageOptions: {
          image: ecs.ContainerImage.fromDockerImageAsset(images.storefront),
          containerName: "storefront",
          containerPort: 4173,
          environment: {
            NODE_ENV: "production",
            PORT: "4173",
            PAYMENT_BACKEND: config.paymentBackend,
            PAYMENT_ASSET: config.paymentAsset,
            PAYMENT_SESSION_LIMIT: config.paymentSessionLimit,
            USDC_NETWORK: config.usdcNetwork,
            USDC_ASSET: config.usdcAsset,
            USDC_PAY_TO: config.usdcPayTo ?? "",
            XRPL_NETWORK: config.xrplNetwork,
            XRPL_HTTP_URL: config.xrplHttpUrl ?? "",
            XRPL_MERCHANT_ADDRESS: config.xrplMerchantAddress ?? "",
            XRPL_RUNTIME_PAYER_ADDRESS:
              config.xrplRuntimePayerAddress ?? "",
            XRPL_MAX_FEE_DROPS: config.xrplMaxFeeDrops,
            XRPL_RECONCILIATION_INTERVAL_SECONDS:
              String(config.xrplReconciliationIntervalSeconds),
            ENTITLEMENTS_TABLE_NAME: entitlementTable.tableName,
            PAYMENT_MANAGER_ARN:
              paymentManager?.attrPaymentManagerArn ?? "disabled",
            MEMORY_ID: memory.attrMemoryId
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "agentcore-xrpl-demo",
            logGroup: storefrontLogGroup
          })
        }
      }
    );
    Validations.of(storefront.loadBalancer).acknowledge({
      id: "AwsSolutions-ELB2",
      reason:
        "This short-lived, non-production sample omits ALB access-log storage to control setup and storage costs. CloudFront and application telemetry provide request evidence for the demo. Production adaptations must enable ALB access logs with an organization-approved retention policy."
    });
    Validations.of(storefront.taskDefinition).acknowledge({
      id: "AwsSolutions-ECS2",
      reason:
        "The task definition contains only non-secret deployment configuration such as ports, backend selection, resource identifiers, and limits. XRPL payer material is retrieved from Secrets Manager by the Runtime and is never placed in the storefront task environment."
    });
    if (storefront.taskDefinition.executionRole) {
      acknowledgeCdkNagFinding(
        storefront.taskDefinition.executionRole,
        "AwsSolutions-IAM5[Resource::*]",
        "The ECS execution role requires ecr:GetAuthorizationToken on all resources because that API does not support resource-level permissions. Image-layer access remains scoped to the CDK-created repository."
      );
    }

    storefront.loadBalancer.connections.allowFrom(
      cloudFrontOriginPrefixList,
      ec2.Port.tcp(80),
      "AWS-managed CloudFront origin-facing access"
    );
    storefront.loadBalancer.setAttribute(
      "idle_timeout.timeout_seconds",
      "180"
    );
    storefront.service.connections.allowFrom(
      runtimeSecurityGroup,
      ec2.Port.tcp(4173),
      "AgentCore Runtime private access to the storefront"
    );
    storefront.targetGroup.configureHealthCheck({
      path: "/health",
      healthyHttpCodes: "200",
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5)
    });
    storefront.targetGroup.setAttribute(
      "deregistration_delay.timeout_seconds",
      "15"
    );
    const targetGroupResource = storefront.targetGroup.node
      .defaultChild as elbv2.CfnTargetGroup;
    targetGroupResource.overrideLogicalId(
      "StorefrontCloudFrontTargetGroup"
    );

    const storefrontEdge = new StorefrontEdgeConstruct(
      this,
      "StorefrontEdge",
      {
        environmentName: config.environmentName,
        loadBalancer: storefront.loadBalancer,
        allowedIpv4Cidr: config.allowedCidr,
        allowedIpv6Cidrs: config.allowedIpv6Cidrs,
        resourceReadiness,
        // This is a structural refactor of an existing stack. Retaining the
        // original construct paths prevents CloudFormation replacements.
        preserveLegacyResourcePaths: true
      }
    );
    const { distribution } = storefrontEdge;

    const storefrontContainer = storefront.taskDefinition.defaultContainer;
    if (!storefrontContainer) {
      throw new Error("The storefront task definition has no default container.");
    }
    if (paymentManager) {
      storefront.taskDefinition.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: [
            "bedrock-agentcore:CreatePaymentInstrument",
            "bedrock-agentcore:GetPaymentInstrument",
            "bedrock-agentcore:GetPaymentInstrumentBalance",
            "bedrock-agentcore:ListPaymentInstruments",
            "bedrock-agentcore:DeletePaymentInstrument",
            "bedrock-agentcore:CreatePaymentSession",
            "bedrock-agentcore:GetPaymentSession",
            "bedrock-agentcore:ListPaymentSessions",
            "bedrock-agentcore:DeletePaymentSession"
          ],
          resources: [paymentManager.attrPaymentManagerArn]
        })
      );
      storefront.taskDefinition.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: ["bedrock-agentcore:ProcessPayment"],
          resources: ["*"]
        })
      );
    }
    storefront.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:TransactWriteItems",
          "dynamodb:ConditionCheckItem"
        ],
        resources: [
          entitlementTable.tableArn,
          `${entitlementTable.tableArn}/index/settlement-state-updated`
        ]
      })
    );
    const createRuntimeRole = (
      id: string,
      description: string,
      image: DockerImageAsset
    ) => {
      const role = new iam.Role(this, id, {
        assumedBy: new iam.ServicePrincipal(
          "bedrock-agentcore.amazonaws.com",
          {
            conditions: {
              StringEquals: {
                "aws:SourceAccount": this.account
              },
              ArnLike: {
                "aws:SourceArn": `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:*`
              }
            }
          }
        ),
        description
      });
      image.repository.grantPull(role);
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["ecr:GetAuthorizationToken"],
          resources: ["*"]
        })
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:DescribeLogStreams",
            "logs:DescribeLogGroups",
            "logs:PutLogEvents",
            "logs:PutResourcePolicy",
            "xray:PutTraceSegments",
            "xray:PutTelemetryRecords",
            "xray:GetSamplingRules",
            "xray:GetSamplingTargets",
            "cloudwatch:PutMetricData"
          ],
          resources: ["*"]
        })
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "bedrock:InvokeModel",
            "bedrock:InvokeModelWithResponseStream"
          ],
          resources: ["*"]
        })
      );
      acknowledgeCdkNagFinding(
        role,
        "AwsSolutions-IAM5[Resource::*]",
        "The Runtime role requires resource wildcards for ECR authorization, telemetry APIs, and foundation-model invocation where resource-level constraints are unsupported or model selection is deployment configuration. Repository pulls and sample resources remain separately scoped, and specialist roles include explicit mutation denies."
      );
      return role;
    };

    const runtimeRole = createRuntimeRole(
      "AgentRuntimeRole",
      "Least-privilege execution role for the supervisor and media concierge.",
      images.concierge
    );
    const devopsRuntimeRole = createRuntimeRole(
      "DevOpsAgentRuntimeRole",
      "Execution role for the read-only DevOps specialist.",
      images.specialist
    );
    const securityRuntimeRole = createRuntimeRole(
      "SecurityAgentRuntimeRole",
      "Execution role for the read-only Security specialist.",
      images.specialist
    );

    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:RetrieveMemoryRecords"
        ],
        resources: [memory.attrMemoryArn]
      })
    );
    for (const specialistRole of [devopsRuntimeRole, securityRuntimeRole]) {
      specialistRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "bedrock-agentcore:CreateEvent",
            "bedrock-agentcore:GetEvent",
            "bedrock-agentcore:ListEvents",
            "bedrock-agentcore:RetrieveMemoryRecords"
          ],
          resources: [opsMemory.attrMemoryArn]
        })
      );
      specialistRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: [
            "cloudformation:CreateStack",
            "cloudformation:UpdateStack",
            "cloudformation:DeleteStack",
            "ecs:UpdateService",
            "ecs:DeleteService",
            "iam:Create*",
            "iam:Update*",
            "iam:Delete*",
            "iam:Put*",
            "iam:Attach*",
            "iam:Detach*",
            "dynamodb:CreateTable",
            "dynamodb:UpdateTable",
            "dynamodb:DeleteTable",
            "ec2:AuthorizeSecurityGroupIngress",
            "ec2:RevokeSecurityGroupIngress",
            "cloudfront:CreateDistribution",
            "cloudfront:UpdateDistribution",
            "cloudfront:DeleteDistribution"
          ],
          resources: ["*"]
        })
      );
    }
    if (paymentManager) {
      runtimeRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "bedrock-agentcore:ProcessPayment",
            "bedrock-agentcore:GetPaymentSession",
            "bedrock-agentcore:GetPaymentInstrument",
            "bedrock-agentcore:GetPaymentInstrumentBalance"
          ],
          resources: [paymentManager.attrPaymentManagerArn]
        })
      );
    }
    if (config.xrplWalletSeedSecretArn) {
      runtimeRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [config.xrplWalletSeedSecretArn]
        })
      );
    }

    const opsToolsFunction = createOperationsTools(this, {
      projectRoot,
      stackName: this.stackName,
      environmentName: config.environmentName,
      allowedCidr: config.allowedCidr,
      allowedIpv6Cidrs: config.allowedIpv6Cidrs,
      sourceCommitSha: config.sourceCommitSha
    });

    const policyEngine = new agentcore.CfnPolicyEngine(
      this,
      "OperationsPolicyEngine",
      {
        name: resourceName("AgentCoreXrplOpsPolicy", config.environmentName),
        description:
          "Restricts the specialist agents to their approved read-only MCP tools.",
        tags: Object.entries(commonTags).map(([key, value]) => ({
          key,
          value
        }))
      }
    );
    policyEngine.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const operationsGatewayName = resourceName(
      "AgentCoreXrplOperations",
      config.environmentName
    );
    const operationsGatewayArnPattern = Stack.of(this).formatArn({
      service: "bedrock-agentcore",
      resource: "gateway",
      resourceName: `${operationsGatewayName.toLowerCase()}*`
    });
    const operationsGateway = new agentcore.Gateway(
      this,
      "OperationsGateway",
      {
        gatewayName: operationsGatewayName,
        description:
          "IAM-authenticated read-only operational tools for the specialist agents.",
        authorizerConfiguration:
          agentcore.GatewayAuthorizer.usingAwsIam(),
        tags: commonTags
      }
    );
    const gatewayResource = operationsGateway.node
      .defaultChild as agentcore.CfnGateway;
    const gatewayPolicyEngineAccess = new iam.Policy(
      this,
      "OperationsGatewayPolicyEngineAccess",
      {
        statements: [
          new iam.PolicyStatement({
            actions: ["bedrock-agentcore:GetPolicyEngine"],
            resources: [policyEngine.attrPolicyEngineArn]
          }),
          new iam.PolicyStatement({
            actions: [
              "bedrock-agentcore:AuthorizeAction",
              "bedrock-agentcore:PartiallyAuthorizeActions"
            ],
            resources: [
              policyEngine.attrPolicyEngineArn,
              operationsGatewayArnPattern
            ]
          })
        ]
      }
    );
    acknowledgeCdkNagFinding(
      gatewayPolicyEngineAccess,
      `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:bedrock-agentcore:${this.region}:${this.account}:gateway/${operationsGatewayName.toLowerCase()}*]`,
      "AgentCore gateway authorization uses a service-generated gateway identifier suffix. The wildcard is limited to this stack's deterministic gateway name prefix in the current account and Region."
    );
    operationsGateway.role.attachInlinePolicy(gatewayPolicyEngineAccess);
    const operationsToolsResource =
      opsToolsFunction.node.defaultChild as CfnResource;
    const operationsToolsLogicalId =
      this.getLogicalId(operationsToolsResource);
    acknowledgeCdkNagFinding(
      operationsGateway.role,
      `AwsSolutions-IAM5[Resource::<${operationsToolsLogicalId}.Arn>:*]`,
      "The generated Gateway role invokes only the operations Lambda alias/version resources created by this stack. Lambda qualified ARNs require the generated suffix wildcard."
    );
    gatewayResource.policyEngineConfiguration = {
      arn: policyEngine.attrPolicyEngineArn,
      mode: "ENFORCE"
    };
    gatewayResource.addResourceDependency(policyEngine);
    gatewayResource.addResourceDependency(
      gatewayPolicyEngineAccess.node.defaultChild as iam.CfnPolicy
    );

    const operationsTarget = operationsGateway.addLambdaTarget(
      "OperationsTarget",
      {
        gatewayTargetName: "OpsTools",
        description:
          "Read-only deployment health, service event, IAM, and security posture tools.",
        lambdaFunction: opsToolsFunction,
        toolSchema: agentcore.ToolSchema.fromInline([
          {
            name: "get_deployment_health",
            description:
              "Get current CloudFormation and ECS deployment health for the sample.",
            inputSchema: {
              type: agentcore.SchemaDefinitionType.OBJECT,
              properties: {}
            }
          },
          {
            name: "get_recent_service_events",
            description:
              "Get recent CloudFormation events, ECS service events, and storefront error logs.",
            inputSchema: {
              type: agentcore.SchemaDefinitionType.OBJECT,
              properties: {
                windowMinutes: {
                  type: agentcore.SchemaDefinitionType.INTEGER,
                  description:
                    "Lookback window in minutes, from 5 through 1440."
                }
              }
            }
          },
          {
            name: "audit_security_posture",
            description:
              "Run a read-only security posture audit of the deployed demo.",
            inputSchema: {
              type: agentcore.SchemaDefinitionType.OBJECT,
              properties: {}
            }
          },
          {
            name: "get_iam_summary",
            description:
              "Summarize the Runtime IAM roles and their inline policy actions without exposing credentials.",
            inputSchema: {
              type: agentcore.SchemaDefinitionType.OBJECT,
              properties: {}
            }
          }
        ])
      }
    );

    operationsGateway.grantInvoke(devopsRuntimeRole);
    operationsGateway.grantInvoke(securityRuntimeRole);

    const gatewayArn = operationsGateway.gatewayArn;
    const assumedRolePrincipal = (role: iam.Role) =>
      `arn:${this.partition}:sts::${this.account}:assumed-role/${role.roleName}`;
    const createToolPolicy = (
      id: string,
      name: string,
      description: string,
      role: iam.Role,
      toolNames: string[]
    ) => {
      const actions = toolNames
        .map((toolName) => `AgentCore::Action::"OpsTools___${toolName}"`)
        .join(", ");
      const policy = new agentcore.CfnPolicy(this, id, {
        name,
        description,
        policyEngineId: policyEngine.attrPolicyEngineId,
        enforcementMode: "ACTIVE",
        validationMode: "FAIL_ON_ANY_FINDINGS",
        definition: {
          cedar: {
            statement: `permit(
  principal == AgentCore::IamEntity::"${assumedRolePrincipal(role)}",
  action in [${actions}],
  resource == AgentCore::Gateway::"${gatewayArn}"
);`
          }
        }
      });
      policy.addResourceDependency(
        operationsTarget.node.defaultChild as agentcore.CfnGatewayTarget
      );
      policy.applyRemovalPolicy(RemovalPolicy.DESTROY);
      return policy;
    };

    const devopsToolPolicy = createToolPolicy(
      "DevOpsToolPolicy",
      resourceName("DevOpsReadOnly", config.environmentName),
      "Allows the DevOps Runtime to inspect deployment health and recent service events.",
      devopsRuntimeRole,
      ["get_deployment_health", "get_recent_service_events"]
    );
    const securityToolPolicy = createToolPolicy(
      "SecurityToolPolicy",
      resourceName("SecurityReadOnly", config.environmentName),
      "Allows the Security Runtime to audit posture and inspect Runtime IAM summaries.",
      securityRuntimeRole,
      ["audit_security_posture", "get_iam_summary"]
    );

    const specialistNetworkConfiguration = {
      networkMode: "VPC",
      networkModeConfig: {
        subnets: runtimeSubnetIds,
        securityGroups: [runtimeSecurityGroup.securityGroupId]
      }
    };
    const createSpecialistRuntime = (
      constructId: string,
      runtimeId: string,
      endpointId: string,
      roleName: "devops" | "security",
      role: iam.Role,
      policy: agentcore.CfnPolicy
    ) => {
      return new AgentCoreRuntimeConstruct(
        this,
        constructId,
        {
          runtime: {
            agentRuntimeName: resourceName(
              roleName === "devops"
                ? "AgentCoreXrplDevOps"
                : "AgentCoreXrplSecurity",
              config.environmentName
            ),
            description:
              roleName === "devops"
                ? "Read-only DevOps specialist for deployment and service investigations."
                : "Read-only Security specialist for live posture and IAM reviews.",
            roleArn: role.roleArn,
            agentRuntimeArtifact: {
              containerConfiguration: {
                containerUri: images.specialist.imageUri
              }
            },
            networkConfiguration: specialistNetworkConfiguration,
            protocolConfiguration: "HTTP",
            lifecycleConfiguration: {
              idleRuntimeSessionTimeout: 900,
              maxLifetime: 3600
            },
            environmentVariables: {
              AWS_REGION: this.region,
              MODEL_ID: config.modelId,
              AGENT_ROLE: roleName,
              OPS_MEMORY_ID: opsMemory.attrMemoryId,
              OPS_GATEWAY_URL: operationsGateway.gatewayUrl!,
              OPS_GATEWAY_TARGET_PREFIX: "OpsTools"
            },
            tags: {
              ...commonTags,
              AgentRole: roleName
            }
          },
          endpoint: {
            name: "live",
            description:
              `Stable live endpoint for the ${roleName} specialist.`,
            tags: commonTags
          },
          resourceReadiness,
          runtimeDependencies: [operationsTarget, policy],
          preserveLegacyResourcePaths: true,
          legacyRuntimeId: runtimeId,
          legacyEndpointId: endpointId,
          readinessId: `${runtimeId}Ready`
        }
      );
    };

    const devopsAgent = createSpecialistRuntime(
      "DevOpsAgentCoreRuntime",
      "DevOpsRuntime",
      "DevOpsLiveEndpoint",
      "devops",
      devopsRuntimeRole,
      devopsToolPolicy
    );
    const securityAgent = createSpecialistRuntime(
      "SecurityAgentCoreRuntime",
      "SecurityRuntime",
      "SecurityLiveEndpoint",
      "security",
      securityRuntimeRole,
      securityToolPolicy
    );

    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:InvokeAgentRuntime",
          "bedrock-agentcore:InvokeAgentRuntimeForUser"
        ],
        resources: [
          devopsAgent.runtime.attrAgentRuntimeArn,
          devopsAgent.endpoint.attrAgentRuntimeEndpointArn,
          securityAgent.runtime.attrAgentRuntimeArn,
          securityAgent.endpoint.attrAgentRuntimeEndpointArn
        ]
      })
    );

    const conciergeAgent = new AgentCoreRuntimeConstruct(
      this,
      "ConciergeAgentCoreRuntime",
      {
        runtime: {
          agentRuntimeName: resourceName(
            "AgentCoreXrplConcierge",
            config.environmentName
          ),
          description:
            "Bun-based media concierge that selects titles and handles the x402 request flow.",
          roleArn: runtimeRole.roleArn,
          agentRuntimeArtifact: {
            containerConfiguration: {
              containerUri: images.concierge.imageUri
            }
          },
          networkConfiguration: {
            networkMode: "VPC",
            networkModeConfig: {
              subnets: runtimeSubnetIds,
              securityGroups: [
                runtimeSecurityGroup.securityGroupId
              ]
            }
          },
          protocolConfiguration: "HTTP",
          lifecycleConfiguration: {
            idleRuntimeSessionTimeout: 900,
            maxLifetime: 3600
          },
          environmentVariables: {
            AWS_REGION: this.region,
            MODEL_ID: config.modelId,
            AGENT_ROLE: "supervisor",
            STOREFRONT_ORIGIN:
              "http://storefront.agentcore-xrpl.local:4173",
            MEMORY_ID: memory.attrMemoryId,
            OPS_MEMORY_ID: opsMemory.attrMemoryId,
            DEVOPS_RUNTIME_ARN:
              devopsAgent.runtime.attrAgentRuntimeArn,
            SECURITY_RUNTIME_ARN:
              securityAgent.runtime.attrAgentRuntimeArn,
            PAYMENT_BACKEND: config.paymentBackend,
            PAYMENT_ASSET: config.paymentAsset,
            PAYMENT_MAX_AMOUNT: config.paymentMaxAmount,
            XRPL_NETWORK: config.xrplNetwork,
            XRPL_HTTP_URL: config.xrplHttpUrl ?? "",
            XRPL_MAX_FEE_DROPS: config.xrplMaxFeeDrops,
            XRPL_RUNTIME_PAYER_ADDRESS:
              config.xrplRuntimePayerAddress ?? "",
            XRPL_WALLET_SEED_SECRET_ARN:
              config.xrplWalletSeedSecretArn ?? "",
            PAYMENT_MANAGER_ARN:
              paymentManager?.attrPaymentManagerArn ?? "disabled"
          },
          tags: commonTags
        },
        endpoint: {
          name: "live",
          description:
            "Stable live endpoint for the media concierge.",
          tags: commonTags
        },
        resourceReadiness,
        preserveLegacyResourcePaths: true,
        legacyRuntimeId: "ConciergeRuntime",
        legacyEndpointId: "ConciergeLiveEndpoint",
        readinessId: "ConciergeRuntimeReady"
      }
    );
    const { runtime, endpoint: runtimeEndpoint } = conciergeAgent;
    storefrontContainer.addEnvironment(
      "AGENT_RUNTIME_ARN",
      runtime.attrAgentRuntimeArn
    );
    storefrontContainer.addEnvironment("AGENT_RUNTIME_QUALIFIER", "live");
    storefront.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:InvokeAgentRuntime",
          "bedrock-agentcore:InvokeAgentRuntimeForUser"
        ],
        resources: [
          runtime.attrAgentRuntimeArn,
          runtimeEndpoint.attrAgentRuntimeEndpointArn
        ]
      })
    );

    new CfnOutput(this, "StorefrontUrl", {
      description: "HTTPS URL for the AgentCore XRPL storefront.",
      value: `https://${distribution.distributionDomainName}`
    });
    new CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId
    });
    new CfnOutput(this, "SourceCommitSha", {
      description: "Git commit used to synthesize this deployment.",
      value: config.sourceCommitSha
    });
    new CfnOutput(this, "AgentRuntimeArn", {
      value: runtime.attrAgentRuntimeArn
    });
    new CfnOutput(this, "AgentRuntimeEndpointArn", {
      value: runtimeEndpoint.attrAgentRuntimeEndpointArn
    });
    new CfnOutput(this, "MemoryId", {
      value: memory.attrMemoryId
    });
    new CfnOutput(this, "OperationsMemoryId", {
      value: opsMemory.attrMemoryId
    });
    new CfnOutput(this, "OperationsGatewayArn", {
      value: operationsGateway.gatewayArn
    });
    new CfnOutput(this, "OperationsGatewayUrl", {
      value: operationsGateway.gatewayUrl!
    });
    new CfnOutput(this, "OperationsPolicyEngineArn", {
      value: policyEngine.attrPolicyEngineArn
    });
    new CfnOutput(this, "DevOpsRuntimeArn", {
      value: devopsAgent.runtime.attrAgentRuntimeArn
    });
    new CfnOutput(this, "SecurityRuntimeArn", {
      value: securityAgent.runtime.attrAgentRuntimeArn
    });
    new CfnOutput(this, "EntitlementTableName", {
      value: entitlementTable.tableName
    });
    new CfnOutput(this, "StorefrontClusterName", {
      value: cluster.clusterName
    });
    new CfnOutput(this, "StorefrontServiceName", {
      value: storefront.service.serviceName
    });
    new CfnOutput(this, "StorefrontLogGroupName", {
      value: storefrontLogGroup.logGroupName
    });
    new CfnOutput(this, "RuntimeRoleNames", {
      value: [
        runtimeRole.roleName,
        devopsRuntimeRole.roleName,
        securityRuntimeRole.roleName
      ].join(",")
    });
    new CfnOutput(this, "ApplicationSecurityGroupIds", {
      value: [
        runtimeSecurityGroup.securityGroupId,
        storefront.service.connections.securityGroups[0].securityGroupId,
        storefront.loadBalancer.connections.securityGroups[0].securityGroupId
      ].join(",")
    });
    new CfnOutput(this, "PaymentManagerArn", {
      value: paymentManager?.attrPaymentManagerArn ?? "disabled"
    });
    new CfnOutput(this, "PaymentManagerId", {
      value: paymentManager?.attrPaymentManagerId ?? "disabled"
    });
    new CfnOutput(this, "PaymentConnectorId", {
      value: paymentConnector?.attrPaymentConnectorId ?? "disabled"
    });
    new CfnOutput(this, "PaymentConnectorAuthorizationUrl", {
      description:
        "Open this URL after deployment to authorize Coinbase Quick Create.",
      value: paymentConnector?.attrAuthorizationUrl ?? "disabled"
    });
  }
}
