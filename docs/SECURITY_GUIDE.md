# Security Agent guide

The Security Agent performs a live, read-only review of the deployed sample.
It demonstrates how AgentCore Gateway and AgentCore Policy can constrain
an autonomous specialist to approved inspection tools while preserving a clear
audit trail.

## Run a security review

1. Open the sample storefront.
2. Select the **Operations** tab.
3. Select **Security Agent**.
4. Ask `Audit this demo for its biggest security risks.`
5. Review the findings cards and execution trace in the Session Inspector.

The finding states are:

- **PASS**: the inspected control matched the expected secure configuration.
- **REVIEW**: the configuration may be intentional for a demo but should be
  reconsidered for production.
- **FAIL**: the live evidence did not satisfy the expected control.

Severity describes potential impact; it is separate from the control state. An
informational passing control is expected, while a medium review item deserves
an explicit acceptance or remediation decision.

## Controls inspected

The current audit checks:

- HTTPS redirection at CloudFront;
- private Application Load Balancer scheme;
- unrestricted IPv4 ingress on tagged security groups;
- DynamoDB server-side encryption;
- DynamoDB point-in-time recovery configuration;
- public viewer scope configured through `allowedCidr` and
  `allowedIpv6Cidrs`;
- wildcard-resource statements on the three Runtime roles;
- absence of mutation authority for specialist agents.

The IAM summary returns policy action names and whether a statement uses the
wildcard resource. It does not return credentials, secret values, payment
payloads, wallet signatures, or XRPL private keys.

## Agent and policy boundary

The expected path is:

```text
Supervisor Agent → Security Agent → IAM-authenticated AgentCore Gateway
                                      ↓
                              AgentCore Policy Engine
                                      ↓
                         approved read-only Lambda tools
```

The Security Runtime may invoke only:

- `audit_security_posture`
- `get_iam_summary`

The DevOps tools are not authorized for its principal by the Cedar policy. Any
tool not explicitly permitted is denied by default. The specialist Runtime IAM
role also contains explicit denies for common CloudFormation, ECS, IAM,
DynamoDB, EC2 security-group, and CloudFront mutation actions.

The concierge and specialist agents are built as separate container images and
entry points. The specialist request contract explicitly omits payment session
IDs, instruments, approvals, and payment delegation tokens. This limits both
accidental propagation and the impact of a compromised operations prompt.
Only the concierge imports and calls `@agentcore-xrpl-demo/x402-payments`; specialists
receive neither the facade context nor backend credentials.

## Safe demo usage

- Use test wallets and test networks for payment demonstrations.
- Never enter credentials, seeds, access tokens, private customer data, or
  confidential incident details into prompts.
- Treat Operations Memory as non-authoritative context. Confirm findings
  against live evidence before acting.
- Do not interpret the Security Agent as a replacement for Security Hub,
  Inspector, GuardDuty, Config, IAM Access Analyzer, or a human security review.
- Keep remediation proposal-only. Apply infrastructure changes through the
  reviewed CDK deployment process.
- Use only the seeded synthetic Ledger Lodge rooms and PINs. Never use a real
  guest name, room assignment, folio identifier, or production hotel code.

Anonymous users receive the answer and sanitized trace, but recalled memory
details are not exposed. Detailed recalled records are returned only for a
verified XRPL wallet actor.

The browser's wallet session token stays in an HTTP-only storefront cookie.
Only the concierge can receive a short-lived, opaque payment delegation, and
the stored delegation is hashed. DevOps and Security invocations never receive
that capability. Anonymous sandbox payment state is scoped to a separate
HTTP-only session and persisted rather than shared in process memory.

## Ledger Lodge privacy boundary

Proof of Stay keeps the public payment receipt separate from private hotel
context:

- the short room PIN is verified server-side and never persisted;
- the room number is stored only in DynamoDB;
- a random stay reference prevents room-number derivation;
- XRPL receives only a SHA-256 `InvoiceID` supported by the x402 XRPL scheme;
- the dashboard resolves only invoice IDs created by this application;
- payer addresses are truncated before the dashboard response reaches the
  browser.

Do not replace the invoice binding with an arbitrary XRPL memo. The installed
x402 verifier deliberately rejects `Memos`, and relaxing that verification
would weaken the tested payment profile.

The Hotel tab is intentionally unauthenticated for this synthetic hackathon
demo. A real property deployment must add staff authentication and
authorization, tenant isolation, retention policy enforcement, and audit logs
before displaying room-linked purchase data.

## Expected demo review item

When `allowedCidr=0.0.0.0/0`, the audit reports the shareable CloudFront viewer
scope as **REVIEW**. This is intentional for a public demo link, not proof that
the origin is public: CloudFront reaches an internal ALB through a VPC origin.

For restricted deployments, configure both address families. CDK disables
viewer IPv6 when `allowedCidr` is restrictive and `allowedIpv6Cidrs` is empty.
Adding one or more IPv6 CIDRs enables dual-stack viewing and applies the same
fail-closed edge policy to IPv6 requests. The VPC origin remains IPv4.

Before adapting the stack for production, restrict viewer access or add an
appropriate identity layer, review all wildcard-resource IAM statements,
reduce outbound network access, configure WAF and organization security
services, and establish operational ownership for findings.

## Responding to a finding

For each review or failure:

1. Capture the finding, resource, prompt, time, and both AgentCore trace IDs.
2. Verify the result with the owning AWS service.
3. Decide whether the condition is intended, accepted temporarily, or requires
   remediation.
4. Make changes in CDK and review the resulting diff.
5. Redeploy through the normal process.
6. Run the same prompt again and retain the new trace as validation evidence.

The agents deliberately cannot perform step 4 or step 5 themselves.

## Repository and deployment boundary

The sample keeps source control, deployment credentials, and the specialist
agents in separate trust zones:

- Source control stores code and review history but does not need deployment
  credentials.
- Deployment uses a human-selected checkout and temporary local AWS profile.
- CDK records the selected Git SHA in CloudFormation.
- The DevOps agent reads that SHA through its existing read-only Gateway tool.
- Neither specialist receives a source-control token, SSH key, repository clone, or
  write authority.
- ECS tasks run without public IP addresses behind a private load balancer.

A commit SHA is operational provenance, not a cryptographic attestation. Before
production, add protected branches, mandatory review, signed or attestable
artifacts, a controlled deployment role, and separation of duties appropriate
to the environment. Do not put long-lived AWS keys or XRPL secrets in
repository or CI variables.
