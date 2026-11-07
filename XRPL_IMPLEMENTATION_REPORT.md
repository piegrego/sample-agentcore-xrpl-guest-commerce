# XRP and AgentCore implementation report

- Initial XRP validation: October 11, 2026
- Operational verification updated: October 13, 2026
- Ledger Lodge receipt flow added: October 14, 2026
- Settlement package and reconciliation added: October 23, 2026
- Common XRPL and AgentCore Payments facade added: October 23, 2026
- Restricted browser-wallet dependency removed: October 27, 2026

## Outcome

The application supports AgentCore Runtime independently of AgentCore
Payments. XRP and USDC remain configuration choices rather than replacements:

- `sandbox` simulates USDC or XRP.
- `agentcore` retains the AgentCore Payments path for USDC.
- `xrpl` settles native XRP directly on XRPL.
- `auto` selects the appropriate rail for the configured asset.

Native XRP is not represented as an AgentCore Payments transaction. AgentCore
Runtime calls the common `@agentcore-xrpl-demo/x402-payments` facade for both live payer
backends. The facade delegates native XRP to
`@agentcore-xrpl-demo/xrpl-settlement` and USDC to the AgentCore Payments adapter.
AgentCore Payments resources are disabled in the current XRP deployment.

The built-in native-XRP experience uses AgentCore Runtime with the Secrets
Manager wallet. The provider-neutral browser identity, preparation, merchant,
and recovery contracts remain available for an optional approved consumer
wallet adapter.

## Validated architecture

```text
Browser -> CloudFront HTTPS -> private ALB -> ECS storefront/merchant
                             ^                  ^
                             |                  | private Cloud Map DNS
                             |                  | and port 4173
                                      AgentCore Runtime in private subnet
                                        |       |        |
                                     Bedrock  Memory  x402 facade
                                                       /       \
                                           XRPL payer adapter  AgentCore adapter
                                                |                  |
                                         Secrets Manager      ProcessPayment
                                                |
                                      XRPL Testnet HTTPS JSON-RPC
```

The Runtime is VPC-attached and calls
`http://storefront.agentcore-xrpl.local:4173`. CloudFront supplies the public
HTTPS endpoint and reaches an internal ALB through a VPC origin. Deployments
can set `allowedCidr` to apply an edge allowlist. One NAT gateway supplies
outbound connectivity and incurs ongoing AWS charges.

AgentCore Runtime Availability Zone support can differ by account, so this
sample attaches the Runtime to one private subnet. This is a deliberate
single-AZ demo constraint, not the desired production availability design.

## Native XRP flow

1. The merchant returns an x402 `exact` requirement for `xrpl:1`, with XRP
   expressed in drops.
2. Without approval, Runtime returns a deterministic human-readable amount and
   does not retrieve or use the payer seed.
3. After approval, Runtime creates the XRPL facade adapter. The adapter repeats
   the approval and challenge-compatibility checks.
4. Runtime retrieves the exact Secrets Manager secret it is permitted to read.
5. The XRPL package uses HTTPS JSON-RPC to read account sequence, fee, and the
   validated ledger, then signs with `@x402/xrpl`.
6. The package retries with the `PAYMENT-SIGNATURE` header.
7. The merchant verifies and submits the transaction.
8. The facade returns the normalized resource and backend receipt. A successful
   settlement unlocks playback and terminates the tool loop, preventing a
   second payment attempt.

For an optional restored consumer mode, steps 3-5 are replaced by:

1. The browser confirms the approved wallet is available, connected, and on
   the XRPL network advertised by the x402 challenge.
2. The official x402 XRPL client prepares the payment and asks the wallet
   adapter to sign it.
3. The browser sends only the signed x402 payload to the merchant.
4. The same merchant facilitator verifies and settles it.

Before either consumer payment path, Proof of Stay links the verified wallet
to a synthetic Ledger Lodge room. The link is stored privately in DynamoDB.
Each title challenge includes an x402 `extra.invoiceId`; the XRPL client writes
its SHA-256 value to the transaction's `InvoiceID` field. The public ledger
therefore carries an opaque receipt key rather than a room number.

The x402 XRPL facilitator rejects arbitrary `Memos`, so this implementation
uses its supported invoice-binding mechanism. Settlement and recovery verify
the invoice along with payer, destination, amount, status, and title.

The built-in payment sheet now exposes only Runtime-managed approval. A
restored consumer mode would not call the Runtime payer facade; it would share
the merchant verifier, settlement repository, reconciliation worker, and
entitlement grant. See
[Restore consumer XRPL wallet support](./docs/CONSUMER_WALLET_RESTORATION.md).

## Common facade boundary

`@agentcore-xrpl-demo/x402-payments` owns the application-level contract for live
Runtime-managed payments:

- validate the principal, resource URL, HTTP 402 response, approval, and
  idempotency key;
- select a compatible `xrpl` or `agentcore` adapter;
- retry the paid resource with backend proof;
- parse JSON, text, or a caller-defined response format;
- return a common resource result with backend-specific receipt evidence.

The sandbox resolver stays outside the facade because it simulates payment.
XRPL finality also stays outside the common result:
`PROOF_GENERATED` from AgentCore Payments does not mean an XRPL transaction is
`VALIDATED`.

## AWS authorization and secret handling

AWS access is STS/profile-based; no static AWS key is stored in the repository
or application. The XRPL payer seed is stored in an operator-created AWS
Secrets Manager secret. CDK supplies only its ARN and grants the Runtime
`secretsmanager:GetSecretValue` for that secret. The merchant receiving address
is public configuration supplied at deployment.

## End-to-end Testnet result

An authorized 0.65 XRP purchase settled successfully:

```text
Validated:          true
Transaction result: tesSUCCESS
Amount delivered:   650000 drops (0.65 XRP)
```

Deployment, wallet, transaction, ledger, sequence, and balance identifiers are
intentionally omitted from this public report.

The ledger transaction is authoritative. At the time of this validation, a
later storefront deployment reset the in-memory session display to zero spent;
it did not affect settlement. The current implementation persists
wallet entitlements and session-scoped sandbox state in DynamoDB and serializes
settlement and recovery by wallet identity. No additional payment was
submitted during post-deployment validation.

The Ledger Lodge dashboard queries the merchant account's validated
transactions and joins recognized `InvoiceID` values to private stay records.
Wallet addresses are truncated server-side before the dashboard response is
returned. Transactions from before this feature remain valid but cannot be
attributed to a room and are omitted from the property view.

## Validation checklist

- CloudFormation deployment: `UPDATE_COMPLETE`
- CloudFront distribution: `Deployed`
- HTTPS storefront: reachable
- AgentCore supervisor, DevOps, and Security Runtime endpoints: `READY`
- Runtime network mode: `VPC`
- Runtime storefront origin: private Cloud Map DNS
- Payment configuration: `xrpl`, `XRP`, `xrpl:1`
- AgentCore Payment Manager and connector: disabled
- Health endpoint: successful
- Fresh no-approval invocation: stopped at 0.65 XRP confirmation
- Memory reserved namespace-key error: absent after the fix
- TypeScript typecheck: passed
- Repository typecheck and `bun run test`: passed on October 23, 2026. Coverage
  includes payment facade selection, both payment adapters, dynamic fixtures,
  XRPL settlement transitions and reconciliation, AgentCore delegation and
  inspection, deployment provenance, wallet-owned entitlements, Proof of Stay,
  opaque ledger-receipt resolution, the hotel dashboard, and browser-target
  startup without Node globals.
- Deployment provenance: the `SourceCommitSha` CloudFormation output and
  read-only DevOps response identify the deployed Git revision.

Runtime sessions are version-pinned. Validation after each deployment used a
fresh session so it reached the new Runtime image.

## Source control and release boundary

Source review and tests are separate from deployment. The repository does not
require CI credentials or an automated deployment job.

CDK resolves the source revision from an explicit context value, CI commit
environment, or local Git `HEAD`, then stores the full SHA as a stack output
and operations-tool environment value. The operations Lambda includes that
value in deployment-health evidence. The DevOps Runtime can report it through
AgentCore Gateway without repository access.

This boundary is intentionally lightweight for a sample. It improves
traceability while avoiding long-lived CI credentials and autonomous
deployment. It does not replace protected branches, artifact signing,
attestations, or production release controls.

## Remaining work before production

- Replace general-purpose Runtime seed access with a dedicated custody/signing
  design where appropriate.
- Restore a licensed consumer XRPL wallet through the documented adapter
  boundary if the public sample requires that experience.
- Route the two reconciliation alarms to an owned incident destination.
- Run a fresh end-to-end Testnet payment through the extracted package.
- Validate the supported-AZ multi-AZ Runtime selection in the target account
  and Region.
- Validate the separate AgentCore Payments/USDC connector and merchant proof
  path when Marketplace access is available.
- Confirm connector-advertised cbXRP support before adding it as an EVM asset.

AgentCore Payments Marketplace and Coinbase authorization are not required for
the validated native XRP path.
