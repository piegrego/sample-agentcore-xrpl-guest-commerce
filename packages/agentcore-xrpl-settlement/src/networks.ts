// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export function xrplHttpEndpoint(
  network: string,
  configuredUrl?: string
) {
  if (configuredUrl) return configuredUrl;
  if (network === "xrpl:0") return "https://s1.ripple.com:51234/";
  if (network === "xrpl:1")
    return "https://s.altnet.rippletest.net:51234/";
  if (network === "xrpl:2")
    return "https://s.devnet.rippletest.net:51234/";
  throw new Error(`No XRPL HTTP endpoint configured for ${network}.`);
}
