// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export class XrplSettlementError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "XrplSettlementError";
  }
}
