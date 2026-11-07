// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  CfnResource,
  CustomResource,
  RemovalPolicy
} from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import {
  Construct,
  type IDependable
} from "constructs";

export interface AgentCoreRuntimeReadiness {
  waitForAgentCoreRuntime(
    id: string,
    runtimeId: string,
    runtimeVersion: string
  ): CustomResource;
}

export type AgentCoreRuntimeEndpointProps = Omit<
  agentcore.CfnRuntimeEndpointProps,
  "agentRuntimeId" | "agentRuntimeVersion"
>;

export interface AgentCoreRuntimeConstructProps {
  readonly runtime: agentcore.CfnRuntimeProps;
  readonly endpoint: AgentCoreRuntimeEndpointProps;
  readonly resourceReadiness: AgentCoreRuntimeReadiness;
  readonly runtimeDependencies?: readonly IDependable[];
  readonly removalPolicy?: RemovalPolicy;
  /**
   * Creates migrated Runtime and endpoint resources at their original stack
   * paths. New consumers should omit this option so the construct owns them.
   */
  readonly preserveLegacyResourcePaths?: boolean;
  readonly legacyRuntimeId?: string;
  readonly legacyEndpointId?: string;
  readonly readinessId?: string;
}

export class AgentCoreRuntimeConstruct extends Construct {
  readonly runtime: agentcore.CfnRuntime;
  readonly endpoint: agentcore.CfnRuntimeEndpoint;
  readonly readiness: CustomResource;

  constructor(
    scope: Construct,
    id: string,
    props: AgentCoreRuntimeConstructProps
  ) {
    super(scope, id);

    if (
      props.preserveLegacyResourcePaths &&
      (!props.legacyRuntimeId || !props.legacyEndpointId)
    ) {
      throw new Error(
        "Legacy AgentCore Runtime paths require both legacyRuntimeId and legacyEndpointId."
      );
    }

    const resourceScope = props.preserveLegacyResourcePaths
      ? scope
      : this;
    const runtimeId = props.preserveLegacyResourcePaths
      ? props.legacyRuntimeId!
      : "Runtime";
    const endpointId = props.preserveLegacyResourcePaths
      ? props.legacyEndpointId!
      : "LiveEndpoint";
    const removalPolicy =
      props.removalPolicy ?? RemovalPolicy.DESTROY;

    this.runtime = new agentcore.CfnRuntime(
      resourceScope,
      runtimeId,
      props.runtime
    );
    this.runtime.applyRemovalPolicy(removalPolicy);
    if (props.runtimeDependencies?.length) {
      this.runtime.node.addDependency(
        ...props.runtimeDependencies
      );
    }

    this.readiness =
      props.resourceReadiness.waitForAgentCoreRuntime(
        props.readinessId ?? `${id}Ready`,
        this.runtime.attrAgentRuntimeId,
        this.runtime.attrAgentRuntimeVersion
      );

    this.endpoint = new agentcore.CfnRuntimeEndpoint(
      resourceScope,
      endpointId,
      {
        ...props.endpoint,
        agentRuntimeId: this.runtime.attrAgentRuntimeId,
        agentRuntimeVersion:
          this.runtime.attrAgentRuntimeVersion
      }
    );
    this.endpoint.applyRemovalPolicy(removalPolicy);
    this.endpoint.addResourceDependency(
      this.readiness.node.defaultChild as CfnResource
    );
  }
}
