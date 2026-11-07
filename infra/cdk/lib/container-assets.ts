// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { Construct } from "constructs";

const commonExcludes = [
  ".git/**",
  ".github/**",
  "cdk.out/**",
  "docs/**",
  "infra/**",
  "node_modules/**",
  "ops-tools/**",
  "test/**",
  "*.md",
  "*.png"
];

export interface AgentCoreXrplContainerAssetsProps {
  projectRoot: string;
}

export class AgentCoreXrplContainerAssets extends Construct {
  readonly storefront: DockerImageAsset;
  readonly concierge: DockerImageAsset;
  readonly specialist: DockerImageAsset;

  constructor(
    scope: Construct,
    id: string,
    props: AgentCoreXrplContainerAssetsProps
  ) {
    super(scope, id);
    this.storefront = new DockerImageAsset(this, "Storefront", {
      directory: props.projectRoot,
      file: "Dockerfile",
      platform: Platform.LINUX_ARM64,
      exclude: [...commonExcludes, "agent/**"]
    });
    const agentExcludes = [
      ...commonExcludes,
      "server/**",
      "src/**",
      "Dockerfile",
      "server.ts"
    ];
    this.concierge = new DockerImageAsset(this, "Concierge", {
      directory: props.projectRoot,
      file: "agent/Dockerfile",
      platform: Platform.LINUX_ARM64,
      exclude: [
        ...agentExcludes,
        "agent/Dockerfile.specialist",
        "agent/src/specialist-entry.ts",
        "agent/src/specialist-runtime.ts"
      ]
    });
    this.specialist = new DockerImageAsset(this, "Specialist", {
      directory: props.projectRoot,
      file: "agent/Dockerfile.specialist",
      platform: Platform.LINUX_ARM64,
      exclude: [
        ...agentExcludes,
        "agent/Dockerfile",
        "agent/src/index.ts"
      ]
    });
  }
}
