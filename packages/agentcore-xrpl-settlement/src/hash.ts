// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export async function signedXrplTransactionHash(signedTxBlob: string) {
  if (!/^(?:[0-9A-Fa-f]{2})+$/.test(signedTxBlob)) {
    throw new Error("The signed XRPL transaction blob is invalid.");
  }
  const transactionPrefix = [0x54, 0x58, 0x4e, 0x00];
  const bytes = new Uint8Array(
    transactionPrefix.length + signedTxBlob.length / 2
  );
  bytes.set(transactionPrefix);
  for (let index = 0; index < signedTxBlob.length / 2; index += 1) {
    bytes[transactionPrefix.length + index] = Number.parseInt(
      signedTxBlob.slice(index * 2, index * 2 + 2),
      16
    );
  }
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-512", bytes)
  );
  return [...digest.subarray(0, 32)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
