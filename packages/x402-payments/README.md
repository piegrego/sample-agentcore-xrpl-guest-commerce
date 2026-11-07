# Common x402 payments facade

`@agentcore-xrpl-demo/x402-payments` gives XRPL and Amazon Bedrock AgentCore Payments the
same developer-facing paid-resource API.

```ts
const result = await payments.payResource({
  principalId,
  resourceUrl,
  firstResponse,
  paymentRequiredBody,
  approved: true,
  idempotencyKey,
  // Optional; both adapters use the same parser.
  responseParser: async (response) => response.arrayBuffer()
});
```

The facade owns request validation, backend selection, common error codes, and
result normalization. It also accepts one response parser for JSON, text, or
binary paid resources. Each adapter continues to own its custody, proof, and
settlement semantics.

The sample uses this facade for Runtime-managed live payments. The simulated
sandbox resolver remains outside it. An optional consumer-wallet adapter would
remain a browser flow; it would share the XRPL merchant and settlement package
rather than the Runtime payer facade. The public sample does not bundle that
adapter; see
[Restore consumer XRPL wallet support](../../docs/CONSUMER_WALLET_RESTORATION.md).

The current AgentCore adapter uses `CRYPTO_X402`. AgentCore support for Machine
Payments Protocol (MPP) does not add native-XRP settlement. See
[AgentCore Payments MPP and the XRPL bridge](../../docs/AGENTCORE_MPP_AND_XRPL.md)
for the supported strategy matrix and the changes required for an MPP path.

## Common result

```ts
interface PaidResourceResult {
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
```

Applications can use `status`, `response`, and `body` identically. Operations
and reconciliation use the discriminated `receipt`.

## XRPL configuration

```ts
import {
  createPaymentClient,
  createXrplPaymentBackend
} from "@agentcore-xrpl-demo/x402-payments";

const payments = createPaymentClient({
  backends: [
    createXrplPaymentBackend({
      client: configuredXrplX402Client
    })
  ]
});
```

The adapter accepts `exact` native-XRP challenges on `xrpl:*` networks and
delegates payment to `@agentcore-xrpl-demo/xrpl-settlement`.

## AgentCore Payments configuration

```ts
import {
  createAgentCorePaymentBackend,
  createPaymentClient
} from "@agentcore-xrpl-demo/x402-payments";

const payments = createPaymentClient({
  backends: [
    createAgentCorePaymentBackend({
      client: agentCoreClient,
      context: (request) => ({
        paymentManagerArn,
        paymentSessionId: sessionFor(request.principalId),
        paymentInstrumentId: instrumentFor(request.principalId),
        agentName: "PaidResourceAgent"
      }),
      supportedNetworks: ["eip155:8453"],
      supportedAssets: [usdcContractAddress]
    })
  ]
});
```

Callers can alternatively provide `supportsRequirement` when connector
capabilities are resolved dynamically. The callback is additive to the
configured scheme allowlist; it cannot make an unsupported scheme eligible.

The adapter:

1. validates the 33–256 character AgentCore idempotency key;
2. resolves the manager, session, instrument, and agent context;
3. sends `ProcessPayment` with `CRYPTO_X402`;
4. requires `PROOF_GENERATED` and a proof payload;
5. retries the original resource with x402 proof headers;
6. returns the same `PaidResourceResult` shape as XRPL.

## Multiple backends

```ts
const payments = createPaymentClient({
  backends: [xrplBackend, agentCoreBackend]
});

const result = await payments.payResource({
  ...request,
  preferredBackend: "agentcore"
});
```

Without `preferredBackend`, the first compatible configured backend is used.
With it, the facade fails if that backend does not accept the challenge; it
does not silently spend through another rail.

## Stable errors

`PaymentClientError.code` is one of:

- `approval_required`
- `invalid_request`
- `unsupported_challenge`
- `backend_failed`

Provider-specific responses remain available in `error.details` or
`result.receipt.details`.

## Security properties

- Approval is checked before backend selection or execution.
- The initial response must be HTTP 402.
- The principal, URL, and idempotency key must be present.
- Resource URLs must use HTTP or HTTPS.
- Proof headers override caller-supplied headers.
- AgentCore compatibility must be configured explicitly.
- XRPL and AgentCore settlement states are not collapsed into one finality
  flag.

## Tests

```bash
bun run typecheck
bun run test
```

The 25 facade and adapter tests generate addresses, identifiers, ARNs,
sessions, instruments, amounts, URLs, assets, proofs, and responses at runtime.
Static literals are limited to protocol constants and expected API behavior.
