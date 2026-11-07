// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  CloudFormationClient,
  DescribeStacksCommand
} from "@aws-sdk/client-cloudformation";
import { ECSClient } from "@aws-sdk/client-ecs";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { EC2Client } from "@aws-sdk/client-ec2";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { IAMClient } from "@aws-sdk/client-iam";

const region = process.env.AWS_REGION || "us-east-1";
export const clients = {
  cloudformation: new CloudFormationClient({ region }),
  ecs: new ECSClient({ region }),
  logs: new CloudWatchLogsClient({ region }),
  ec2: new EC2Client({ region }),
  cloudfront: new CloudFrontClient({ region: "us-east-1" }),
  dynamodb: new DynamoDBClient({ region }),
  iam: new IAMClient({ region })
};

export const finding = (severity, title, status, detail, resource) => ({
  severity,
  title,
  status,
  detail,
  resource
});
export const errorText = (error) =>
  error instanceof Error ? error.message : String(error);
export const outputMap = (stack) =>
  Object.fromEntries(
    (stack?.Outputs || [])
      .filter((output) => output.OutputKey && output.OutputValue)
      .map((output) => [output.OutputKey, output.OutputValue])
  );
export function requiredValue(values, name) {
  const value = values[name];
  if (!value) throw new Error(`Required deployment metadata ${name} is missing.`);
  return value;
}
export const valueList = (values, name) =>
  requiredValue(values, name).split(",").filter(Boolean);
export async function stackMetadata() {
  const response = await clients.cloudformation.send(
    new DescribeStacksCommand({ StackName: process.env.STACK_NAME })
  );
  const stack = response.Stacks?.[0];
  return { stack, outputs: outputMap(stack) };
}
