// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { execFileSync } from "node:child_process";
import path from "node:path";
import type { App } from "aws-cdk-lib";
import { isValidClassicAddress } from "xrpl";
import {
  DEFAULT_PAYMENT_SESSION_LIMIT,
  DEFAULT_USDC_ASSET,
  DEFAULT_USDC_NETWORK,
  type PaymentAsset,
  type PaymentBackend,
  validatedEip155Network,
  validatedEvmAddress,
  validatedPositiveAmount
} from "../../../shared/paymentConfiguration";

export type AuthMode = "iam";

export interface AgentCoreXrplConfiguration {
  readonly environmentName: string;
  readonly sourceCommitSha: string;
  readonly account?: string;
  readonly region?: string;
  /** AZ names for the VPC. Resolved from the account when not set in context. */
  readonly availabilityZones: readonly string[];
  readonly authMode: AuthMode;
  readonly allowedCidr: string;
  readonly allowedIpv6Cidrs: readonly string[];
  readonly modelId: string;
  readonly enablePayments: boolean;
  readonly paymentBackend: PaymentBackend;
  readonly paymentAsset: PaymentAsset;
  readonly paymentMaxAmount: string;
  readonly paymentSessionLimit: string;
  readonly usdcNetwork: string;
  readonly usdcAsset: string;
  readonly usdcPayTo?: string;
  readonly xrplNetwork: string;
  readonly xrplHttpUrl?: string;
  readonly xrplMaxFeeDrops: string;
  readonly xrplReconciliationIntervalSeconds: number;
  readonly xrplMerchantAddress?: string;
  readonly xrplRuntimePayerAddress?: string;
  readonly xrplWalletSeedSecretArn?: string;
}

function contextValue(app: App, name: string): string | undefined {
  const value = app.node.tryGetContext(name);
  return value === undefined || value === null ? undefined : String(value);
}

function contextBoolean(app: App, name: string, defaultValue: boolean): boolean {
  const value = contextValue(app, name);
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`CDK context "${name}" must be "true" or "false".`);
}

function contextStringList(app: App, name: string): string[] {
  const value = app.node.tryGetContext(name);
  if (value === undefined || value === null || value === "") return [];
  const entries = Array.isArray(value) ? value : String(value).split(",");
  return [
    ...new Set(
      entries
        .map((entry) => String(entry).trim())
        .filter(Boolean)
    )
  ];
}

function contextPositiveNumber(
  app: App,
  name: string,
  defaultValue: string
): string {
  return validatedPositiveAmount(
    contextValue(app, name) ?? defaultValue,
    `CDK context "${name}"`
  );
}

function contextIntegerInRange(
  app: App,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const value = Number(contextValue(app, name) ?? defaultValue);
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `CDK context "${name}" must be an integer from ${minimum} through ${maximum}.`
    );
  }
  return value;
}

function optionalHttpsUrl(app: App, name: string): string | undefined {
  const value = contextValue(app, name)?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
  } catch {
    // Use the setting-specific error below.
  }
  throw new Error(`CDK context "${name}" must be an HTTPS URL.`);
}

function validateSourceCommitSha(value: string): string {
  const commitSha = value.trim().toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(commitSha)) {
    throw new Error(
      'CDK context "sourceCommitSha" must be a 7-64 character hexadecimal Git commit SHA.'
    );
  }
  return commitSha;
}

function resolveSourceCommitSha(app: App): string {
  const configured =
    contextValue(app, "sourceCommitSha") ??
    process.env.CI_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA;
  if (configured) return validateSourceCommitSha(configured);

  try {
    const projectRoot = path.resolve(import.meta.dir, "../../..");
    return validateSourceCommitSha(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      })
    );
  } catch {
    return "unknown";
  }
}

export function loadConfiguration(app: App): AgentCoreXrplConfiguration {
  const environmentName = contextValue(app, "environment") ?? "demo";
  if (!/^[a-z][a-z0-9-]{1,15}$/.test(environmentName)) {
    throw new Error(
      'CDK context "environment" must start with a lowercase letter and contain 2-16 lowercase letters, digits, or hyphens.'
    );
  }

  const authMode = (contextValue(app, "authMode") ?? "iam") as AuthMode;
  if (authMode !== "iam") {
    throw new Error(
      'CDK context "authMode" must be "iam"; wallet users are identified through signed XRPL challenges and AgentCore runtimeUserId.'
    );
  }

  const account = contextValue(app, "account") ?? process.env.CDK_DEFAULT_ACCOUNT;
  if (account && !/^\d{12}$/.test(account)) {
    throw new Error('CDK context "account" must be a 12-digit AWS account ID.');
  }

  const region = contextValue(app, "region") ?? process.env.CDK_DEFAULT_REGION;
  const enablePayments = contextBoolean(app, "enablePayments", false);
  const paymentBackend = (contextValue(app, "paymentBackend") ??
    "sandbox") as PaymentBackend;
  if (!["sandbox", "agentcore", "xrpl", "auto"].includes(paymentBackend)) {
    throw new Error(
      'CDK context "paymentBackend" must be "sandbox", "agentcore", "xrpl", or "auto".'
    );
  }

  const paymentAsset = (
    contextValue(app, "paymentAsset") ?? "USDC"
  ).toUpperCase() as PaymentAsset;
  if (paymentAsset !== "USDC" && paymentAsset !== "XRP") {
    throw new Error(
      'CDK context "paymentAsset" must be either "USDC" or "XRP".'
    );
  }

  const usesAgentCorePayments =
    paymentBackend === "agentcore" ||
    (paymentBackend === "auto" && paymentAsset === "USDC");
  const usesDirectXrpl =
    paymentBackend === "xrpl" ||
    (paymentBackend === "auto" && paymentAsset === "XRP");

  if (usesAgentCorePayments && !enablePayments) {
    throw new Error(
      'The selected payment backend requires "enablePayments=true".'
    );
  }
  if (paymentBackend === "agentcore" && paymentAsset !== "USDC") {
    throw new Error(
      'This demo currently supports "paymentBackend=agentcore" with USDC only. Use "paymentBackend=xrpl" for native XRP.'
    );
  }
  if (paymentBackend === "xrpl" && paymentAsset !== "XRP") {
    throw new Error(
      'CDK context "paymentBackend=xrpl" requires "paymentAsset=XRP".'
    );
  }

  const paymentMaxAmount = contextPositiveNumber(
    app,
    "paymentMaxAmount",
    "2"
  );
  const paymentSessionLimit = contextPositiveNumber(
    app,
    "paymentSessionLimit",
    DEFAULT_PAYMENT_SESSION_LIMIT
  );
  const usdcNetwork = validatedEip155Network(
    contextValue(app, "usdcNetwork") ?? DEFAULT_USDC_NETWORK,
    'CDK context "usdcNetwork"'
  );
  const usdcAsset = validatedEvmAddress(
    contextValue(app, "usdcAsset") ?? DEFAULT_USDC_ASSET,
    'CDK context "usdcAsset"'
  );
  const configuredUsdcPayTo = contextValue(app, "usdcPayTo")?.trim();
  const usdcPayTo = configuredUsdcPayTo
    ? validatedEvmAddress(
        configuredUsdcPayTo,
        'CDK context "usdcPayTo"'
      )
    : undefined;
  if (usesAgentCorePayments && !usdcPayTo) {
    throw new Error(
      'CDK context "usdcPayTo" is required for live AgentCore USDC payments.'
    );
  }

  const xrplNetwork = contextValue(app, "xrplNetwork") ?? "xrpl:1";
  if (!/^xrpl:\d+$/.test(xrplNetwork)) {
    throw new Error(
      'CDK context "xrplNetwork" must be an XRPL CAIP-2 identifier such as "xrpl:1".'
    );
  }
  const xrplHttpUrl = optionalHttpsUrl(app, "xrplHttpUrl");
  if (
    usesDirectXrpl &&
    !["xrpl:0", "xrpl:1", "xrpl:2"].includes(xrplNetwork) &&
    !xrplHttpUrl
  ) {
    throw new Error(
      'CDK context "xrplHttpUrl" is required for an XRPL network without a built-in endpoint.'
    );
  }
  const xrplMaxFeeDrops = contextPositiveNumber(
    app,
    "xrplMaxFeeDrops",
    "2000"
  );
  if (!/^\d+$/.test(xrplMaxFeeDrops)) {
    throw new Error(
      'CDK context "xrplMaxFeeDrops" must be a positive integer.'
    );
  }
  const xrplReconciliationIntervalSeconds = contextIntegerInRange(
    app,
    "xrplReconciliationIntervalSeconds",
    30,
    5,
    3600
  );
  const xrplMerchantAddress = contextValue(app, "xrplMerchantAddress");
  const xrplRuntimePayerAddress = contextValue(
    app,
    "xrplRuntimePayerAddress"
  );
  const xrplWalletSeedSecretArn = contextValue(
    app,
    "xrplWalletSeedSecretArn"
  );
  if (usesDirectXrpl) {
    if (!xrplMerchantAddress) {
      throw new Error(
        'CDK context "xrplMerchantAddress" is required for "paymentBackend=xrpl".'
      );
    }
    if (!isValidClassicAddress(xrplMerchantAddress)) {
      throw new Error(
        'CDK context "xrplMerchantAddress" must be a valid XRPL classic address.'
      );
    }
    if (!xrplRuntimePayerAddress) {
      throw new Error(
        'CDK context "xrplRuntimePayerAddress" is required for "paymentBackend=xrpl".'
      );
    }
    if (!isValidClassicAddress(xrplRuntimePayerAddress)) {
      throw new Error(
        'CDK context "xrplRuntimePayerAddress" must be a valid XRPL classic address.'
      );
    }
    if (!xrplWalletSeedSecretArn) {
      throw new Error(
        'CDK context "xrplWalletSeedSecretArn" is required for "paymentBackend=xrpl".'
      );
    }
  }

  return {
    environmentName,
    sourceCommitSha: resolveSourceCommitSha(app),
    account,
    region,
    availabilityZones: contextStringList(app, "availabilityZones"),
    authMode,
    allowedCidr: contextValue(app, "allowedCidr") ?? "0.0.0.0/0",
    allowedIpv6Cidrs: contextStringList(app, "allowedIpv6Cidrs"),
    modelId: contextValue(app, "modelId") ?? "amazon.nova-lite-v1:0",
    enablePayments,
    paymentBackend,
    paymentAsset,
    paymentMaxAmount,
    paymentSessionLimit,
    usdcNetwork,
    usdcAsset,
    usdcPayTo,
    xrplNetwork,
    xrplHttpUrl,
    xrplMaxFeeDrops,
    xrplReconciliationIntervalSeconds,
    xrplMerchantAddress,
    xrplRuntimePayerAddress,
    xrplWalletSeedSecretArn
  };
}
