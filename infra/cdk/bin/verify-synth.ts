#!/usr/bin/env bun

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// CDK context providers require a concrete account and Region even for an
// offline synthesis. These non-deployable placeholders let the verification
// path exercise template generation and cdk-nag without borrowing a
// developer's AWS account. The normal cdk:synth and cdk:deploy commands still
// require the operator's real deployment environment.
process.env.CDK_DEFAULT_ACCOUNT ??= "000000000000";
process.env.CDK_DEFAULT_REGION ??= "us-east-1";
process.env.CDK_CONTEXT_JSON ??= JSON.stringify({
  availabilityZones: "dummy1a,dummy1b"
});

await import("./agentcore-xrpl-payments");

export {};
