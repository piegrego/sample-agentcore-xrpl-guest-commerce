#!/usr/bin/env bun

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { App, Tags, Validations } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { loadConfiguration } from "../lib/config";
import { AgentCoreXrplPaymentsStack } from "../lib/agentcore-xrpl-payments-stack";
import { lookupAvailabilityZoneNames } from "../lib/availability-zones";

const app = new App();
const loadedConfig = loadConfiguration(app);
const region = loadedConfig.region ?? process.env.CDK_DEFAULT_REGION;
if (!region) {
  throw new Error('Set CDK context "region" or an AWS Region for the profile.');
}
const config = {
  ...loadedConfig,
  availabilityZones: loadedConfig.availabilityZones.length
    ? loadedConfig.availabilityZones
    : await lookupAvailabilityZoneNames(region)
};

const stack = new AgentCoreXrplPaymentsStack(
  app,
  `AgentCoreXrplPayments-${config.environmentName}`,
  {
    env:
      config.account || config.region
        ? {
            account: config.account,
            region: config.region
          }
        : undefined,
    description:
      `AgentCore Runtime and selectable XRPL payments demo (${config.environmentName})`,
    config
  }
);

Tags.of(stack).add("Application", "AgentCoreXrplPaymentsDemo");
Tags.of(stack).add("Environment", config.environmentName);
Tags.of(stack).add("ManagedBy", "AWS-CDK");

Validations.of(app).addPlugins(
  new AwsSolutionsChecks(app, {
    verbose: true,
    writeSuppressionsToCloudFormation: true
  })
);

app.synth();
