// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export type PaymentBackend = "sandbox" | "agentcore" | "xrpl" | "auto";
export type PaymentAsset = "USDC" | "XRP";

export const DEFAULT_PAYMENT_SESSION_LIMIT = "2";
export const DEFAULT_USDC_NETWORK = "eip155:84532";
export const DEFAULT_USDC_ASSET =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const SANDBOX_USDC_PAY_TO =
  "0x1111111111111111111111111111111111111111";

export function validatedPositiveAmount(
  value: string,
  settingName: string
): string {
  const amount = value.trim();
  const number = Number(amount);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${settingName} must be a positive number.`);
  }
  return amount;
}

export function validatedEip155Network(
  value: string,
  settingName: string
): string {
  const network = value.trim();
  if (!/^eip155:[1-9]\d*$/.test(network)) {
    throw new Error(
      `${settingName} must be an EIP-155 CAIP-2 network such as "eip155:84532".`
    );
  }
  return network;
}

export function validatedEvmAddress(
  value: string,
  settingName: string
): string {
  const address = value.trim();
  if (
    !/^0x[0-9a-f]{40}$/i.test(address) ||
    /^0x0{40}$/i.test(address)
  ) {
    throw new Error(
      `${settingName} must be a nonzero 20-byte EVM address.`
    );
  }
  return address;
}

export function resolveUsdcPayTo(
  backend: PaymentBackend,
  asset: PaymentAsset,
  configuredValue?: string
): string {
  if (configuredValue?.trim()) {
    return validatedEvmAddress(configuredValue, "USDC_PAY_TO");
  }
  if (
    asset.toUpperCase() === "USDC" &&
    (backend === "agentcore" || backend === "auto")
  ) {
    throw new Error(
      "USDC_PAY_TO is required for live AgentCore USDC payments."
    );
  }
  return SANDBOX_USDC_PAY_TO;
}

export function paymentNetworkLabel(
  asset: PaymentAsset,
  xrplNetwork: string,
  usdcNetwork: string
): string {
  if (asset === "XRP") {
    if (xrplNetwork === "xrpl:0") return "XRPL Mainnet";
    if (xrplNetwork === "xrpl:1") return "XRPL Testnet";
    if (xrplNetwork === "xrpl:2") return "XRPL Devnet";
    return `XRPL ${xrplNetwork}`;
  }
  const knownEvmNetworks: Readonly<Record<string, string>> = {
    "eip155:1": "Ethereum Mainnet",
    "eip155:8453": "Base",
    "eip155:84532": "Base Sepolia",
    "eip155:11155111": "Ethereum Sepolia"
  };
  return knownEvmNetworks[usdcNetwork] ?? usdcNetwork;
}
