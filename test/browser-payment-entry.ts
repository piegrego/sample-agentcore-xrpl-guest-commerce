// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { installBrowserGlobals } from "../src/browserGlobals";

installBrowserGlobals(globalThis);

export async function signedXrplTransactionHash(signedTxBlob: string) {
  const paymentModule = await import(
    "../packages/agentcore-xrpl-settlement/src/hash"
  );
  return paymentModule.signedXrplTransactionHash(signedTxBlob);
}

export async function browserInvoiceHash(invoiceId: string) {
  const paymentModule = await import("../src/lib/browserXrplScheme");
  return paymentModule.browserInvoiceIdToInvoiceIdField(invoiceId);
}
