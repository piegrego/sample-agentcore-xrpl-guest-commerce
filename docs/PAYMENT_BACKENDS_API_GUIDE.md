# XRPL and AgentCore Payments API guide

## Decision

The reusable XRPL package and Amazon Bedrock AgentCore Payments are close at
the x402 workflow boundary, but they are not close as concrete APIs.

Both can participate in:

```text
HTTP request → 402 challenge → authorization → signed proof → HTTP retry
```

That is the correct level for a shared `PaymentBackend` interface. Below that
line, keep each implementation explicit:

- `@agentcore-xrpl-demo/xrpl-settlement` is an in-process TypeScript library for
  exact native-XRP payment, XRPL merchant settlement, and ledger
  reconciliation.
- AgentCore Payments is a managed payer-side AWS data-plane API. It uses a
  Payment Manager, connector, payment instrument, and bounded payment session
  to check policy and return a signed proof.

They are adapters behind the same application use case, not interchangeable
payment rails.

The sample currently uses AgentCore Payments for its USDC path and the reusable
package for native XRP. Do not assume that an AgentCore connector can process
native XRP merely because both paths carry x402 messages. Backend selection
must use the connector's advertised network and asset support.

This guide reflects the repository and AWS documentation reviewed on
October 23, 2026.

For the protocol-versus-settlement implications of Machine Payments Protocol
(MPP), see [AgentCore Payments MPP and the XRPL bridge](./AGENTCORE_MPP_AND_XRPL.md).

## API similarity

| Concern | Reusable XRPL package | AgentCore Payments | Close? |
| --- | --- | --- | --- |
| Trigger | Existing HTTP 402 response and parsed x402 body | Merchant x402 payload passed to `ProcessPayment` | Yes |
| Protocol | x402 v2-compatible client/server libraries | `CRYPTO_X402`; also supports MPP | Yes for x402 |
| Scheme | `exact` | `exact` and `upto` | Partial |
| Asset and rail | Native XRP on XRPL | Instrument- and connector-supported networks/assets | No |
| Payer API | Local `createXrplPayer` and `payXrplResource` calls | Remote `ProcessPayment` call | No |
| Custody | Caller injects an XRPL signer | Connector and embedded payment instrument | No |
| Approval | Host application policy plus package spend limit | Host approval plus payment-session budget and wallet permission | Partial |
| Proof | Signed XRPL transaction encoded by x402 client | `paymentOutput.cryptoX402.payload` | Conceptually |
| HTTP retry | Performed by `payXrplResource` | Performed by the caller, SDK helper, or framework integration | Partial |
| Idempotency | Host repository, transaction hash, and grant key | `clientToken` for `ProcessPayment`; merchant grant still needs idempotency | Partial |
| Merchant API | `XrplMerchantSettlement` verifies and settles | Not supplied by the payer API; merchant must support the selected protocol and rail | No |
| Finality | `inspectSettlement` validates XRPL ledger state | `PROOF_GENERATED` means proof exists; the merchant still verifies and settles | No |
| Reconciliation | Host queries XRPL by transaction hash | Service/session records plus merchant/application reconciliation | Partial |
| Resource grant | Host-owned atomic grant | Host/merchant-owned grant | Yes |

The strongest commonality is x402. The weakest commonality is settlement
ownership.

## Current sample implementations

The Runtime uses the same application call for both live payer backends:

```ts
const payments = createPaymentClient({
  backends: [selectedPaymentBackend]
});

const result = await payments.payResource({
  principalId: invocation.actorId,
  approved: true,
  idempotencyKey,
  firstResponse,
  paymentRequiredBody,
  resourceUrl,
  headers,
  preferredBackend: selectedBackend
});
```

The Runtime first chooses `xrpl` or `agentcore` from deployment mode and the
advertised challenge, then constructs one adapter. The facade repeats the
approval and compatibility checks before it executes that adapter.

### Native XRP adapter

`createXrplPaymentBackend` delegates to `payXrplResource`, which:

1. Parses the 402 challenge.
2. Selects an exact native-XRP requirement.
3. Prepares an XRPL transaction.
4. Uses the injected signer.
5. Retries the resource with x402 proof.
6. Parses the merchant response and optional settlement header.

The merchant uses `XrplMerchantSettlement` and the application persists
`CHALLENGED → SIGNED → SUBMITTED → VALIDATED → GRANTED`.

### AgentCore Payments adapter

`createAgentCorePaymentBackend` invokes `ProcessPayment` with the configured
Payment Manager, session, instrument, agent name, principal, challenge, and
idempotency key. When the status is `PROOF_GENERATED`, the adapter reads
`payment.paymentOutput.cryptoX402.payload`, attaches that proof to the
merchant retry, requests the resource again, and returns the facade's common
result.

The Payment Manager and connector are control-plane configuration. The payment
instrument identifies the user's embedded wallet. The payment session is the
time-bounded spending context. `ProcessPayment` is the data-plane operation
that checks the session and generates the proof.

## Shared application API

The implemented `@agentcore-xrpl-demo/x402-payments` package uses a paid-resource
abstraction rather than a generic blockchain or `signTransaction`
abstraction.

```ts
export interface PaidResourceRequest {
  principalId: string;
  resourceUrl: string;
  firstResponse: Response;
  paymentRequiredBody: unknown;
  approved: boolean;
  idempotencyKey: string;
  headers?: Record<string, string>;
  preferredBackend?: "xrpl" | "agentcore";
  fetch?: PaymentFetch;
  responseParser?: (response: Response) => Promise<unknown>;
}

export interface BackendPaymentResult {
  response: Response;
  body: unknown;
  providerId?: string;
  stage: "proof_generated" | "merchant_accepted" | "settled";
  details?: unknown;
}

export interface PaidResourceResult {
  status: "resource_granted" | "merchant_retry_failed";
  response: Response;
  body: unknown;
  receipt: {
    backend: "xrpl" | "agentcore";
    providerId?: string;
    stage: "proof_generated" | "merchant_accepted" | "settled";
    details?: unknown;
  };
}

export interface PaymentBackend {
  readonly name: PaidResourceResult["receipt"]["backend"];
  supports(paymentRequiredBody: unknown): boolean;
  execute(request: PaidResourceRequest): Promise<BackendPaymentResult>;
}
```

The package exports challenge readers, the facade, both adapters, stable error
codes, and the normalized request and result contracts.

This interface shares what the caller actually needs:

- determine whether a backend accepts the challenge;
- enforce approval before spending;
- complete the payment negotiation;
- return the paid HTTP resource;
- expose correlation references without imposing one rail's transaction model
  on the other.

Do not put `transactionHash`, `paymentSessionId`, or `signedTxBlob` in the
common required result. Those fields are implementation details and not
available with the same meaning on every rail.

## XRPL backend adapter

```ts
import type { x402HTTPClient } from "@x402/core/http";
import {
  createXrplPaymentBackend
} from "@agentcore-xrpl-demo/x402-payments";

const backend = createXrplPaymentBackend({
  client: configuredXrplX402Client
});
```

The adapter still needs a durable settlement repository around it. The common
backend interface should not replace `SettlementRecord`,
`transitionSettlementRecord`, or `inspectSettlement`.

## AgentCore Payments backend adapter

```ts
import {
  createAgentCorePaymentBackend
} from "@agentcore-xrpl-demo/x402-payments";

const backend = createAgentCorePaymentBackend({
  client: agentCoreClient,
  context: (request) => paymentContextFor(request.principalId),
  supportedNetworks: connectorNetworks,
  supportedAssets: connectorAssets
});
```

This is an application adapter in `@agentcore-xrpl-demo/x402-payments`, not an export from
the XRPL settlement package. It depends on AWS resource configuration and a
payment context that has no XRPL equivalent.

Use the AWS SDK type definitions installed in the application as the
authoritative field names. AgentCore Payments evolves independently from the
XRPL package.

## Backend selection

`createPaymentClient` selects from the merchant's accepted requirements and
the available payer context. Do not select only from an application
environment variable.

```ts
const payments = createPaymentClient({
  backends: [xrplBackend, agentCoreBackend]
});

const result = await payments.payResource({
  ...request,
  preferredBackend: selectedByUser
});
```

Validate at least:

- x402 version and scheme;
- network and asset;
- amount and destination;
- configured per-payment and session budget;
- payment instrument network;
- merchant allowlist;
- signer or instrument readiness;
- challenge expiry.

For the sample's current routing, native `XRP` on an `xrpl:*` network goes to the
XRPL backend. A supported USDC challenge goes to AgentCore Payments. Do not
silently translate native XRP into an EVM token or treat a similarly named
wrapped asset as XRP.

## Approval and trust boundaries

Use three layers:

1. **Application approval.** The user approves the displayed merchant,
   destination, amount, asset, and resource, or an explicit standing policy
   authorizes it.
2. **Backend enforcement.** The XRPL adapter applies its native-XRP amount and
   network policy. AgentCore Payments applies the payment session, instrument,
   connector, wallet permission, and service authorization.
3. **Merchant verification.** The merchant validates the proof, settles on the
   selected rail, and grants the resource.

A payment session is not a substitute for application approval. Conversely,
an `approvePayment: true` field is not a substitute for a bounded AgentCore
payment session or a deterministic XRPL spend policy.

The model may propose a purchase, but deterministic code must authorize and
execute it.

## Idempotency

Use a stable purchase-attempt key derived from immutable application context:

```text
principal + merchant + resource + invoice/version + approval attempt
```

For AgentCore Payments, pass a compliant deterministic representation as
`clientToken`. The current API accepts a case-sensitive token of 33–256
characters. Reusing the token should mean "the same payment operation," not
"another purchase of the same product."

For XRPL, persist:

- the settlement ID before signing;
- the signed transaction hash before or with submission;
- a unique transaction claim;
- the merchant resource grant.

AgentCore `clientToken` prevents duplicate processing of the AWS request. It
does not make the merchant's application grant idempotent. Both backends need
an application-level grant key.

## Finality and reconciliation

`PROOF_GENERATED` and `VALIDATED` are different milestones:

- `PROOF_GENERATED` means AgentCore Payments returned signed payment proof.
- `VALIDATED` in the XRPL package means the transaction was found in a
  validated ledger, returned `tesSUCCESS`, and passed all expected invariants.

Do not normalize both to a common `settled: true` flag.

Use a rail-neutral purchase state above backend-specific records:

```text
PAYMENT_REQUIRED
  → PAYMENT_AUTHORIZED
  → PROOF_CREATED
  → MERCHANT_ACCEPTED
  → RESOURCE_GRANTED
```

Then retain backend-specific evidence:

```ts
type PaymentEvidence =
  | {
      backend: "xrpl";
      settlementId: string;
      transactionHash: string;
      ledgerState: "pending" | "validated" | "invalid";
    }
  | {
      backend: "agentcore";
      processPaymentId: string;
      paymentSessionId: string;
      status: "PROOF_GENERATED";
      merchantReceipt?: unknown;
    };
```

For XRPL, run `inspectSettlement` until the transaction validates, fails an
invariant, or expires.

For AgentCore Payments, retain the `processPaymentId`, session ID, original
client token, merchant response, and the application's grant record. Use
AgentCore payment/session observability for provider-side diagnosis, but still
reconcile whether the merchant accepted the proof and whether the application
granted the resource.

## Custody

The XRPL package deliberately accepts a signer:

```ts
createXrplPayer({ signer, ... })
```

The host can implement that signer with:

- a development XRPL wallet;
- a seed retrieved from a narrowly scoped Secrets Manager secret;
- a remote custody service;
- an approved browser-wallet adapter;
- another reviewed signing boundary compatible with the x402 XRPL signer
  contract.

AgentCore Payments delegates wallet operations through its Payment Manager,
connector, AgentCore Identity credential path, and payment instrument. The
Runtime should receive identifiers and permission to call `ProcessPayment`,
not raw provider credentials.

Do not create a common `getPrivateKey()` or `signTransaction()` interface.
That would erase the strongest security boundary AgentCore Payments provides
and overexpose the XRPL signer.

## Merchant implications

Adding an AgentCore Payments payer does not automatically add a compatible
merchant.

The merchant must advertise requirements that the selected AgentCore payment
instrument and connector support, accept the returned proof, verify it, settle
it, and return the protected resource. The sample's
`XrplMerchantSettlement` handles native XRP only.

To support both:

```text
Merchant route
  ├── XRPL exact XRP challenge → XrplMerchantSettlement
  └── supported AgentCore x402 challenge → compatible EVM/other facilitator
```

Keep invoice and grant semantics common, but use different verifier and
settlement adapters.

## Near-term expansion plan

The facade, XRPL adapter, AgentCore Payments adapter, Runtime integration, and
generated-fixture unit suite are implemented. The remaining work is live
end-to-end validation and the compatible AgentCore merchant path.

### 1. Keep native XRP stable

Finish fresh Testnet validation for:

- Runtime-managed signing;
- optional browser-wallet signing, if an approved adapter will be published;
- restart and lost-response reconciliation;
- duplicate retry and duplicate grant protection.

Do not couple this validation to AgentCore Payments readiness.

The public sample does not bundle the browser adapter. See
[Restore consumer XRPL wallet support](./CONSUMER_WALLET_RESTORATION.md).

### 2. Common paid-resource orchestrator — complete

The implementation moved approval enforcement, backend selection, paid
resource retry normalization, and application grant correlation behind
`PaymentBackend`.

The XRPL lifecycle types remain in the XRPL package.

### 3. Add an AgentCore Payments adapter — code complete

The adapter wraps `ProcessPaymentCommand` and preserves `processPaymentId`,
`paymentSessionId`, and `clientToken`. A live deployment still requires:

- a Payment Manager;
- a READY connector;
- an ACTIVE funded payment instrument;
- a time-bounded payment session with an appropriate limit;
- Runtime-only `ProcessPayment` permission.

### 4. Add a compatible merchant path

Advertise a challenge that matches the connector's supported network, asset,
and scheme. Validate the returned proof through a compatible facilitator before
describing the path as end-to-end.

This is currently the largest functional gap in the sample's AgentCore Payments
path.

### 5. Unify operations, not ledgers

Create one dashboard for:

- requests challenged;
- approvals granted or denied;
- proofs generated;
- merchant retries accepted or rejected;
- resources granted;
- duplicate attempts;
- backend latency and errors.

Link each event to backend-specific evidence rather than forcing one universal
transaction status.

## When to use each backend

Use the reusable XRPL package when:

- native XRP is a product requirement;
- the merchant already supports XRPL x402;
- self-custody or a custom custody boundary matters;
- XRPL ledger evidence must be inspected directly;
- the application can operate merchant settlement and reconciliation.

Use AgentCore Payments when:

- the merchant and configured instrument share a supported protocol, asset,
  and network;
- managed connectors, payment instruments, sessions, limits, and
  observability reduce application work;
- the agent needs a managed payment control plane across paid APIs or tools;
- native XRP is not required for that transaction.

Use both when the application needs product-level payment choice. Route each
challenge to a compatible backend and expose the choice to the user when more
than one backend can pay it.

## References

Local implementation:

- [`packages/x402-payments`](../packages/x402-payments/README.md)
- [`packages/agentcore-xrpl-settlement`](../packages/agentcore-xrpl-settlement/README.md)
- [AgentCore Payments MPP and the XRPL bridge](./AGENTCORE_MPP_AND_XRPL.md)
- [`agent/src/index.ts`](../agent/src/index.ts)
- [`server/reconciliation.ts`](../server/reconciliation.ts)
- [XRPL payment operations runbook](./PAYMENT_OPERATIONS_RUNBOOK.md)

AWS references:

- [How AgentCore Payments works](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-how-it-works.html)
- [Process a payment](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-process-payment.html)
- [ProcessPayment API](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_ProcessPayment.html)
- [Create a payment instrument](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-instrument.html)
- [Create a payment session](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-session.html)

XRPL and x402 references:

- [AWS sample: AgentCore XRPL guest commerce](https://github.com/aws-samples/sample-agentcore-xrpl-guest-commerce)
- [x402 exact XRPL scheme specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_xrpl.md)
- [XRPL agentic payments with x402](https://xrpl.org/docs/agents/agentic-payments-x402)
