// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import path from "node:path";
import {
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack
} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as stepFunctions from "aws-cdk-lib/aws-stepfunctions";
import * as customResources from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { acknowledgeCdkNagFinding } from "./cdk-nag";

export interface ResourceReadinessProviderProps {
  readonly projectRoot: string;
}

export class ResourceReadinessProvider extends Construct {
  private readonly provider: customResources.Provider;

  constructor(
    scope: Construct,
    id: string,
    props: ResourceReadinessProviderProps
  ) {
    super(scope, id);

    const handlerLogGroup = new logs.LogGroup(
      this,
      "HandlerLogGroup",
      {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY
      }
    );
    const handler = new lambdaNodejs.NodejsFunction(
      this,
      "Handler",
      {
        description:
          "Waits for AgentCore Runtimes and CloudFront VPC origins to become ready.",
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        entry: path.join(
          props.projectRoot,
          "infra/functions/resource-readiness/index.cjs"
        ),
        handler: "handler",
        depsLockFilePath: path.join(props.projectRoot, "bun.lock"),
        bundling: {
          bundleAwsSDK: true,
          minify: true,
          sourceMap: false
        },
        timeout: Duration.seconds(30),
        memorySize: 256,
        logGroup: handlerLogGroup
      }
    );
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:GetAgentRuntime",
          "cloudfront:GetVpcOrigin"
        ],
        resources: ["*"]
      })
    );
    if (handler.role) {
      acknowledgeCdkNagFinding(
        handler.role,
        "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
        "The Lambda construct attaches AWSLambdaBasicExecutionRole only for delivery to the dedicated readiness-handler log group."
      );
      acknowledgeCdkNagFinding(
        handler.role,
        "AwsSolutions-IAM5[Resource::*]",
        "The two read-only readiness APIs do not support resource-level IAM permissions. The function receives exact Runtime and VPC origin IDs from CloudFormation."
      );
    }

    const providerLogGroup = new logs.LogGroup(
      this,
      "ProviderLogGroup",
      {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY
      }
    );
    this.provider = new customResources.Provider(this, "Provider", {
      onEventHandler: handler,
      isCompleteHandler: handler,
      queryInterval: Duration.seconds(10),
      totalTimeout: Duration.minutes(30),
      logGroup: providerLogGroup
    });

    for (const childId of [
      "framework-onEvent",
      "framework-isComplete",
      "framework-onTimeout"
    ]) {
      const frameworkHandler = this.provider.node.tryFindChild(
        childId
      ) as lambda.Function | undefined;
      if (!frameworkHandler?.role) {
        continue;
      }
      acknowledgeCdkNagFinding(
        frameworkHandler.role,
        "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
        "The CDK custom-resource provider framework attaches AWSLambdaBasicExecutionRole only for delivery to its dedicated log group."
      );
    }

    const handlerLogicalId = Stack.of(this).getLogicalId(
      handler.node.defaultChild as lambda.CfnFunction
    );
    const invokeFinding =
      `AwsSolutions-IAM5[Resource::<${handlerLogicalId}.Arn>:*]`;
    for (const childId of [
      "framework-onEvent",
      "framework-isComplete",
      "framework-onTimeout"
    ]) {
      const frameworkHandler = this.provider.node.tryFindChild(
        childId
      ) as lambda.Function | undefined;
      if (!frameworkHandler?.role) {
        continue;
      }
      acknowledgeCdkNagFinding(
        frameworkHandler.role,
        invokeFinding,
        "The CDK provider framework invokes published versions and aliases of the single readiness-handler function. It cannot invoke unrelated Lambda functions."
      );
    }

    const waiterStateMachine = this.provider.node.findChild(
      "waiter-state-machine"
    );
    const waiterStateMachineResource =
      waiterStateMachine.node.findChild(
        "Resource"
      ) as stepFunctions.CfnStateMachine;
    const waiterStateMachineRole = waiterStateMachine.node.findChild(
      "Role"
    ) as iam.Role;
    acknowledgeCdkNagFinding(
      waiterStateMachineResource,
      "AwsSolutions-SF1",
      "This short-lived deployment waiter contains no business or customer data. The readiness handler and provider already write failures and status transitions to dedicated CloudWatch log groups."
    );
    acknowledgeCdkNagFinding(
      waiterStateMachineResource,
      "AwsSolutions-SF2",
      "X-Ray is not enabled for this deterministic deployment-only polling loop. CloudFormation events, Step Functions execution status, and dedicated Lambda logs provide sufficient diagnostics without retaining tracing data."
    );
    for (const childId of [
      "framework-isComplete",
      "framework-onTimeout"
    ]) {
      const frameworkHandler = this.provider.node.findChild(
        childId
      ) as lambda.Function;
      const frameworkHandlerLogicalId = Stack.of(this).getLogicalId(
        frameworkHandler.node.defaultChild as lambda.CfnFunction
      );
      acknowledgeCdkNagFinding(
        waiterStateMachineRole,
        `AwsSolutions-IAM5[Resource::<${frameworkHandlerLogicalId}.Arn>:*]`,
        "The waiter state machine invokes published versions and aliases of this single CDK-generated provider function. It cannot invoke unrelated Lambda functions."
      );
    }
  }

  waitForAgentCoreRuntime(
    id: string,
    runtimeId: string,
    runtimeVersion: string
  ): CustomResource {
    return new CustomResource(this, id, {
      serviceToken: this.provider.serviceToken,
      resourceType: "Custom::AgentCoreResourceReadiness",
      properties: {
        Kind: "AgentCoreRuntime",
        ResourceId: runtimeId,
        ResourceVersion: runtimeVersion
      }
    });
  }

  waitForCloudFrontVpcOrigin(
    id: string,
    originId: string
  ): CustomResource {
    return new CustomResource(this, id, {
      serviceToken: this.provider.serviceToken,
      resourceType: "Custom::AgentCoreResourceReadiness",
      properties: {
        Kind: "CloudFrontVpcOrigin",
        ResourceId: originId
      }
    });
  }
}
