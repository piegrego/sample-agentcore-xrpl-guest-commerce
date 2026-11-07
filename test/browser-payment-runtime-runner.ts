// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { pathToFileURL } from "node:url";

const [entryPath, signedTxBlob, expectedHash, invoiceId, expectedInvoiceHash] =
  process.argv.slice(2);
if (
  !entryPath ||
  !signedTxBlob ||
  !expectedHash ||
  !invoiceId ||
  !expectedInvoiceHash
) {
  throw new Error(
    "Browser payment runner requires transaction and invoice hash fixtures."
  );
}

Reflect.deleteProperty(globalThis, "Buffer");

const browserBundle = (await import(pathToFileURL(entryPath).href)) as {
  signedXrplTransactionHash?: (signedBlob: string) => Promise<string>;
  browserInvoiceHash?: (invoiceId: string) => Promise<string>;
};
if (typeof browserBundle.signedXrplTransactionHash !== "function") {
  throw new Error(
    "The minified browser bundle did not export the XRPL hash function."
  );
}

const actualHash = await browserBundle.signedXrplTransactionHash(
  signedTxBlob
);
if (actualHash !== expectedHash) {
  throw new Error(
    `Browser transaction hash mismatch: expected ${expectedHash}, received ${actualHash}.`
  );
}

if (typeof browserBundle.browserInvoiceHash !== "function") {
  throw new Error(
    "The minified browser bundle did not export the invoice hash function."
  );
}
const actualInvoiceHash = await browserBundle.browserInvoiceHash(invoiceId);
if (actualInvoiceHash !== expectedInvoiceHash) {
  throw new Error(
    `Browser invoice hash mismatch: expected ${expectedInvoiceHash}, received ${actualInvoiceHash}.`
  );
}
