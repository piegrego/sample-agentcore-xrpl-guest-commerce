# Ops Copilot guide

The Ops Copilot lets users investigate a deployed sample environment
through a dedicated, read-only DevOps agent. It is designed to show AgentCore
supervision, Runtime-to-Runtime delegation, Gateway tools, policy enforcement,
memory, and distributed trace correlation in one interaction.

## Start an investigation

1. Open the sample storefront.
2. Select the **Operations** tab.
3. Select **DevOps Agent**.
4. Choose an example or enter a question.
5. Select **Ask DevOps Agent**.
6. Review the response and the Session Inspector immediately below it.

No wallet connection is required for an operations request. The current public
sample associates extracted operational context with the opaque guest
beneficiary in that browser session. A future consumer-wallet mode can instead
use a verified wallet identity.

The separate **Hotel** tab is a business-facing Ledger Lodge console, not an
operations tool. It reads validated merchant-wallet receipts and privately
resolves opaque invoice identifiers to simulated rooms. DevOps and Security
specialists do not receive room mappings, PINs, or hotel-dashboard mutation
authority.

## Useful prompts

- `Is the storefront healthy right now?`
- `Which source commit is deployed?`
- `Why did the latest deployment take several minutes?`
- `Show me deployment and service events from the last 30 minutes.`
- `Were there application errors in the last two hours?`
- `Summarize the current CloudFormation and ECS state.`

The agent always gathers the current CloudFormation stack status and ECS service
state, including the Git commit recorded when CDK synthesized the deployment.
It also retrieves recent CloudFormation events, ECS service events, and filtered
storefront errors for the requested lookback window.

## Source and deployment provenance

An operator deploys an explicitly reviewed checkout with temporary profile
credentials, and CDK records that checkout's full Git SHA in the
`SourceCommitSha` stack output.

The DevOps agent reads the SHA from live CloudFormation evidence through
`get_deployment_health`. It does not clone, browse, or authenticate to a source
repository.
This preserves a useful review link between source and runtime without making
the specialist a repository principal.

The tools consume a stable set of named CloudFormation outputs for the ECS
cluster, service, log group, Runtime roles, distribution, table, and security
groups. They do not infer resources from generated CDK logical IDs, so routine
construct refactors do not silently break the operations console.

After a release:

1. Confirm that typecheck and the full test suite passed for the reviewed commit.
2. Ask `Which source commit is deployed?`
3. Compare the returned full SHA with the reviewed Git commit.
4. Treat a mismatch or `unknown` value as a release-process issue.

The SHA proves what the deployment declared; it does not prove authorship,
review, artifact integrity, or that the checkout had no uncommitted changes.

## Reading the inspector

The handoff should show:

```text
Supervisor Agent → DevOps Agent → AgentCore Gateway → read-only AWS tools
```

Important trace entries include:

- **Supervisor route**: the public Runtime delegated to the isolated DevOps
  Runtime.
- **AgentCore Gateway policy**: the request was evaluated by the attached
  policy engine.
- **OpsTools___get_deployment_health**: CloudFormation and ECS health evidence.
- **OpsTools___get_recent_service_events**: recent deployment, service, and log
  evidence.
- **Bedrock Converse**: the specialist synthesized the tool results.
- **CreateEvent**: the investigation was sent to Operations Memory.

The top-level AgentCore trace ID identifies the supervisor invocation. The
handoff panel also records the specialist trace ID so both Runtime executions
can be correlated in AgentCore and CloudWatch observability.

## What the DevOps agent can do

The DevOps Runtime can invoke only these Gateway tools:

- `get_deployment_health`
- `get_recent_service_events`

It can describe the environment and propose troubleshooting steps. It cannot:

- deploy or roll back a stack;
- restart or update an ECS service;
- execute commands in a container;
- change IAM, networking, storage, or CloudFront;
- approve or process a payment.

These restrictions exist in both IAM and AgentCore Policy. The Runtime role has
no direct permissions to inspect the AWS services; it must pass through the
policy-controlled Gateway.

The DevOps and Security agents also run in a specialist-only image. That image
has no concierge handler, common payment facade, or payment delegation path,
and the supervisor builds their invocation from an explicit allowlist. Only
the supervisor concierge imports and calls the Runtime payment facade.

## Expected healthy result

A healthy deployed demo normally reports:

- CloudFormation stack status `CREATE_COMPLETE` or `UPDATE_COMPLETE`;
- ECS service status `ACTIVE`;
- desired and running task counts equal;
- pending task count `0`;
- deployment rollout state `COMPLETED`;
- a source commit SHA that matches the reviewed Git revision;
- no recent error log events.

Recent ECS stabilization messages during a deployment are normal. Interpret
them together with the final rollout state rather than treating any individual
event as a failure.

## Troubleshooting the sample

If the inspector reports a Gateway or policy error:

1. Confirm the DevOps Runtime and its `live` endpoint are ready.
2. Confirm the Operations Gateway and `OpsTools` target are ready.
3. Confirm `DevOpsReadOnly` is active in the Operations Policy Engine.
4. Check the operations-tools Lambda log group.
5. Use the specialist trace ID to inspect the failed Runtime invocation.

If the answer says evidence is unavailable, trust the trace over the prose. The
agent is instructed not to infer a healthy or unhealthy state when its tools
did not return evidence.

If the CDK synthesis test times out in a constrained CI environment, retain its
scoped 20-second timeout rather than disabling infrastructure tests.

If the Hotel dashboard cannot read receipts:

1. Confirm the configured XRPL merchant address is correct.
2. Confirm the storefront task has outbound access to its XRPL HTTP endpoint.
3. Confirm the payment contains the expected `InvoiceID`.
4. Confirm the corresponding private invoice and stay records still exist in
   the entitlement table.
5. Treat the ledger transaction as authoritative even if private room
   enrichment is unavailable.
