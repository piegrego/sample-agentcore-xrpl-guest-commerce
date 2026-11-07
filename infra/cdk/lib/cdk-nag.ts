// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Validations } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

export function acknowledgeCdkNagFinding(
  scope: IConstruct,
  id: string,
  reason: string
) {
  if (!id.startsWith("AwsSolutions-") || !reason.trim()) {
    throw new Error(
      "A cdk-nag acknowledgment requires an AwsSolutions rule ID and a reason."
    );
  }
  scope.node.addMetadata(
    Validations.ACKNOWLEDGED_RULES_METADATA_KEY,
    { [id]: reason }
  );
}
