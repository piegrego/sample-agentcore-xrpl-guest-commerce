# AgentCore XRPL settlement

`@agentcore-xrpl-demo/xrpl-settlement` is an application-neutral TypeScript
package for paying and protecting HTTP resources with native XRP and x402. It
contains both sides of the exchange:

- a payer that accepts an XRPL x402 challenge, prepares and signs an exact XRP
  payment, and retries the resource;
- a merchant adapter that creates, decodes, verifies, and settles XRPL x402
  challenges;
- ledger validation, lifecycle, and reconciliation helpers for durable
  application grants.

The package does not require Amazon Bedrock AgentCore Payments. It can run
inside an AgentCore Runtime, another server process, or a browser-wallet
workflow. AgentCore Runtime is the orchestration boundary; XRPL remains the
settlement system of record.

> [!IMPORTANT]
> This package supports the x402 `exact` scheme for native XRP. It does not
> make AgentCore Payments process native XRP, and it is not a drop-in
> implementation of the AgentCore Payments `ProcessPayment` API.

AgentCore support for Machine Payments Protocol (MPP) does not remove this
bridge. MPP standardizes the HTTP payment exchange but does not add XRPL
custody, signing, settlement, or reconciliation to AgentCore Payments. See
[AgentCore Payments MPP and the XRPL bridge](../../docs/AGENTCORE_MPP_AND_XRPL.md).

The package remains private while the sample validates the extracted path on
XRPL Testnet. Publish it after Runtime-managed payments pass the end-to-end
test through these exports. If a consumer-wallet adapter is included, require
that path to pass the same test.

## Package boundary

The package owns:

- XRPL network-to-HTTP endpoint selection;
- JSON-RPC transport;
- account sequence, fee, and validated-ledger lookup;
- bounded `LastLedgerSequence` preparation;
- native-XRP x402 payer and merchant schemes;
- signed transaction hashing;
- validated-ledger invariant checks;
- settlement state transitions;
- submitted-transaction inspection.

The host application owns:

- user authentication and payment approval;
- wallet custody or browser-wallet interaction;
- durable storage and distributed locks;
- invoice and resource semantics;
- transaction-claim deduplication;
- the atomic resource grant;
- reconciliation scheduling and alerting.

This separation lets the same package unlock a movie, API response, dataset,
ticket, game item, or subscription period without learning those business
concepts.

## Compatibility and import

- Bun 1.4.4
- ECMAScript modules
- `@x402/core` 2.28.0
- `@x402/xrpl` 2.28.0
- `xrpl` 4.4.x

The current repository imports the source directly:

```ts
import {
  createXrplPayer
} from "./packages/agentcore-xrpl-settlement/src";
```

After extracting the directory into a workspace or publishing it to a private
registry, use the package name:

```ts
import {
  createXrplPayer
} from "@agentcore-xrpl-demo/xrpl-settlement";
```

## Public API

| Export | Purpose |
| --- | --- |
| `createXrplHttpRpcClient` | Creates an injectable XRPL JSON-RPC client. |
| `xrplRpc` | Performs one JSON-RPC request through the HTTP client. |
| `xrplHttpEndpoint` | Maps `xrpl:0`, `xrpl:1`, or `xrpl:2` to a default endpoint. |
| `prepareXrplPaymentTransaction` | Adds the current sequence, bounded fee, and ledger expiry before signing. |
| `createXrplPayer` | Configures an x402 client for native XRP with a per-payment drop limit. |
| `payXrplResource` | Parses an existing 402 response, signs the accepted requirement, and retries the resource. |
| `XrplMerchantSettlement` | Creates, decodes, matches, verifies, and settles merchant challenges. |
| `signedXrplTransactionHash` | Calculates the canonical hash of a signed transaction blob. |
| `validateXrplPayment` | Validates finality, result, type, payer, destination, amount, invoice, and hash. |
| `transitionSettlementRecord` | Enforces valid durable settlement state transitions. |
| `inspectSettlement` | Queries a submitted transaction and classifies it as pending, validated, or invalid. |

## Network and amount conventions

Networks use XRPL CAIP-2 identifiers:

| Network | Meaning | Default HTTP endpoint |
| --- | --- | --- |
| `xrpl:0` | Mainnet | `https://s1.ripple.com:51234/` |
| `xrpl:1` | Testnet | `https://s.altnet.rippletest.net:51234/` |
| `xrpl:2` | Devnet | `https://s.devnet.rippletest.net:51234/` |

Native XRP amounts are integer drops represented as strings. One XRP is
`1_000_000` drops. Do not use floating-point values at the package boundary.

```ts
const amount = "650000"; // 0.65 XRP
```

Inject an explicit endpoint or endpoint resolver for private nodes, additional
network IDs, failover, or provider-specific authentication.

## Payer quick start

The payer requires an x402-compatible XRPL signer. The signer owns custody; the
settlement package never loads a seed by itself.

```ts
import type { Network } from "@x402/core/types";
import { createXrplWalletSigner } from "@x402/xrpl";
import { Wallet } from "xrpl";
import {
  createXrplHttpRpcClient,
  createXrplPayer,
  payXrplResource,
  prepareXrplPaymentTransaction
} from "@agentcore-xrpl-demo/xrpl-settlement";

const network = "xrpl:1" satisfies Network;
const wallet = Wallet.fromSeed(process.env.XRPL_TESTNET_SEED!);
const signer = createXrplWalletSigner(wallet);
const rpc = createXrplHttpRpcClient({
  endpoint: "https://s.altnet.rippletest.net:51234/"
});

const payer = createXrplPayer({
  network,
  signer,
  maxAmountPerPayment: "1000000",
  preparePaymentTransaction: (transaction, requirements) =>
    prepareXrplPaymentTransaction(transaction, requirements, {
      rpc,
      feeLimitDrops: "2000"
    })
});

const resourceUrl = "https://merchant.example/paid-report";
const firstResponse = await fetch(resourceUrl, {
  headers: { accept: "application/json" }
});
const paymentRequiredBody = await firstResponse.json();

if (firstResponse.status !== 402) {
  throw new Error(`Expected HTTP 402, received ${firstResponse.status}.`);
}

// Obtain explicit application approval before this call.
const result = await payXrplResource({
  client: payer,
  firstResponse,
  paymentRequiredBody,
  resourceUrl,
  headers: {
    // Optional host authentication or narrowly scoped delegation.
    authorization: `Bearer ${process.env.RESOURCE_TOKEN}`
  }
});

if (!result.response.ok) {
  throw new Error(`Merchant retry failed with ${result.response.status}.`);
}

console.log(result.body);
console.log(result.settlement);
```

`payXrplResource` expects the original 402 `Response` and its parsed body. It
uses the x402 response headers and body together, creates a signed payment
payload, retries the same URL with the payment signature header, and returns
the optional x402 settlement response. By default it parses JSON responses as
JSON and other response types as text. Supply `parseResponse` for binary or
application-specific formats.

### Payer controls

Apply these controls before calling `payXrplResource`:

1. Require an authenticated principal.
2. Display the merchant amount, asset, network, and destination.
3. Obtain explicit approval or validate a pre-authorized policy.
4. Reject requirements outside the application's allowlist.
5. Enforce a business-level budget in addition to
   `maxAmountPerPayment`.
6. Serialize payments from one XRPL account to avoid sequence conflicts.

`createXrplPayer` independently rejects non-XRPL networks, non-XRP assets, and
payments above the configured integer-drop limit.

## Transaction preparation

`prepareXrplPaymentTransaction` reads three values in parallel:

- `account_info` for the validated account sequence;
- `fee` for the open-ledger fee;
- `ledger` for the current validated ledger index.

It adds `Sequence`, `Fee`, and a bounded `LastLedgerSequence`. The default
assumes a five-second ledger close, adds enough ledgers for the challenge
timeout, and includes a two-ledger buffer.

```ts
const prepared = await prepareXrplPaymentTransaction(
  transaction,
  requirements,
  {
    rpc,
    ledgerCloseSeconds: 5,
    feeLimitDrops: "2000"
  }
);
```

Always set `feeLimitDrops` for a production path. If the reported open-ledger
fee exceeds the cap, preparation fails before signing.

## Merchant quick start

Create one initialized merchant instance per configured network and reuse it
across requests.

```ts
import {
  XrplMerchantSettlement
} from "@agentcore-xrpl-demo/xrpl-settlement";

const merchant = await XrplMerchantSettlement.create("xrpl:1");

const challenge = await merchant.createPaymentRequired({
  network: "xrpl:1",
  payTo: process.env.XRPL_MERCHANT_ADDRESS!,
  amount: "650000",
  maxTimeoutSeconds: 60,
  invoiceId: "A".repeat(64),
  resource: {
    url: "https://merchant.example/paid-report",
    description: "Quarterly data report",
    mimeType: "application/json",
    serviceName: "Example Data"
  },
  errorMessage: "Payment is required to access this report."
});
```

Return that object using the HTTP status and headers expected by your x402
integration. On the retry, read the payment signature header, then decode and
validate it before settlement:

```ts
const decoded = merchant.decodePayment(paymentSignature);
const requirements = merchant.findRequirements(
  storedChallenge,
  decoded.payload
);

if (!requirements) {
  throw new Error("The payment does not match an accepted requirement.");
}

// Perform host checks before submission.
if (decoded.transaction.Account !== authorizedPayer) {
  throw new Error("The paying account is not authorized for this invoice.");
}
if (decoded.transaction.Destination !== configuredMerchantAddress) {
  throw new Error("The payment destination is not allowed.");
}

const verification = await merchant.verify(
  decoded.payload,
  requirements
);
if (!verification.isValid) {
  throw new Error(verification.invalidReason || "Payment verification failed.");
}

const settlement = await merchant.settle(
  decoded.payload,
  requirements
);
```

The x402 scheme validates protocol requirements. The host must also validate
the authorized payer, application beneficiary, invoice, inventory or resource
state, configured destination, and any additional business policy. The payer
and beneficiary can be the same wallet or separate identities. The sample's
Runtime-managed design documents that separation in
[Runtime-managed XRPL payer decision](../../docs/RUNTIME_MANAGED_XRPL.md).

## Durable settlement lifecycle

Model payment and resource delivery as separate durable state:

```text
CHALLENGED → SIGNED → SUBMITTED → VALIDATED → GRANTED
     │           │          │
     ├───────────┴──────────┴──→ FAILED
     └─────────────────────────→ EXPIRED
```

`transitionSettlementRecord` permits idempotent repeats and controlled recovery
transitions while rejecting backward transitions from `GRANTED`.

Create a record before signing:

```ts
import type {
  SettlementRecord
} from "@agentcore-xrpl-demo/xrpl-settlement";

const now = new Date();
const record: SettlementRecord = {
  settlementId: "xrpl:1:order-2026-00042",
  state: "CHALLENGED",
  network: "xrpl:1",
  resourceId: "report-2026-q3",
  payer: authorizedPayer,
  destination: configuredMerchantAddress,
  amount: "650000",
  asset: "XRP",
  invoiceId: "A".repeat(64),
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  expiresAt: Math.floor(now.getTime() / 1000) + 300
};
```

Persist the canonical transaction hash before or with submission. The
application repository should support:

- a distributed lock for the settlement intent or payer sequence;
- a unique claim on transaction hash;
- conditional state updates;
- an atomic `VALIDATED → GRANTED` transition and resource grant;
- lookup by settlement ID and transaction hash;
- scans or indexes for pending reconciliation.

## Reconciliation after ambiguous responses

Ledger success and HTTP success are independent. A transaction can validate
after the caller loses the response.

```ts
import {
  inspectSettlement
} from "@agentcore-xrpl-demo/xrpl-settlement";

const inspection = await inspectSettlement(record, rpc);

switch (inspection.status) {
  case "pending":
    // Retry later with bounded backoff until LastLedgerSequence expires.
    break;
  case "invalid":
    // Mark FAILED and retain inspection.errors for operations.
    break;
  case "validated":
    await repository.grantOnce({
      settlement: record,
      transactionHash: inspection.transaction!.hash!
    });
    break;
}
```

`inspectSettlement` accepts only a transaction that is validated,
`tesSUCCESS`, an XRPL `Payment`, and matches the expected payer, destination,
amount, invoice, and transaction hash.

Do not blindly resubmit after a timeout. Query by transaction hash and inspect
the original transaction first.

## Browser-wallet use

For self-custody, keep the merchant and reconciliation portions unchanged:

1. Fetch the paid resource and receive the x402 challenge.
2. Prepare an unsigned XRPL payment from the accepted requirement.
3. Ask the browser wallet to review and sign locally.
4. Encode the signed blob as the x402 payment payload.
5. Retry the resource.
6. Let the merchant use `XrplMerchantSettlement`.
7. Reconcile and grant using the same durable lifecycle.

The browser path should prove that the authenticated wallet address equals the
transaction `Account`. Never send a consumer seed to the application.

## Running inside AgentCore Runtime

AgentCore Runtime is a suitable place for approval, policy enforcement,
Secrets Manager retrieval, and signer construction. The sample calls this package
through `@agentcore-xrpl-demo/x402-payments` so the Runtime uses the same application API
for XRPL and AgentCore Payments.

Keep payment execution outside model reasoning:

```ts
if (!input.approvePayment) {
  return { status: "payment_confirmation_required", challenge };
}

policy.assertAllowed(challenge);
const signer = await signerProvider.getSigner(input.actorId);
const payer = createConfiguredPayer(signer);
const payments = createPaymentClient({
  backends: [
    createXrplPaymentBackend({
      client: payer
    })
  ]
});

return payments.payResource({
  principalId: input.actorId,
  approved: true,
  idempotencyKey: purchaseAttemptId,
  firstResponse,
  paymentRequiredBody: challengeBody,
  resourceUrl,
  headers: {
    "x-payment-delegation": input.paymentDelegationToken
  }
});
```

Applications that support only XRPL can call `payXrplResource` directly. Use
the facade when callers must move between payment backends without changing
their paid-resource contract.

Give only the payment-owning Runtime access to the signer secret. Specialist
Runtimes and the storefront should not receive `ProcessPayment`, secret-read,
or generic signing authority.

## Expanding with AgentCore Payments

Use AgentCore Payments as a second payer backend when the merchant challenge
uses a supported payment instrument, network, asset, and x402 scheme. Do not
put AgentCore Payments inside this XRPL package or represent it as an XRPL
facilitator.

Both paths can share the outer application workflow:

```text
GET resource
  → receive HTTP 402 challenge
  → authenticate and approve
  → select a compatible backend
  → generate payment proof
  → retry the same resource
  → grant application value
```

They differ below that workflow:

- the XRPL package receives an injected signer and directly prepares a native
  XRP transaction;
- AgentCore Payments receives a Payment Manager ARN, payment instrument ID,
  payment session ID, payment type, and x402 payload through
  `ProcessPayment`;
- the XRPL package has merchant verification and ledger reconciliation APIs;
- `ProcessPayment` is a payer-side managed-service API that returns proof. The
  merchant still verifies, settles, and decides whether to return the resource.

See the
[payment backend API guide](../../docs/PAYMENT_BACKENDS_API_GUIDE.md) for the
recommended shared interface, TypeScript adapters, API comparison, trust
boundaries, and migration plan.

## Testing

Run the package and persistence tests from the repository root:

```bash
bun run typecheck
bun run test
```

The suite generates case-specific addresses, hashes, identifiers, amounts,
invoice values, times, and URLs at runtime. Add generated cases for:

- an accepted exact-XRP challenge;
- unsupported network, scheme, and asset;
- amount over the configured limit;
- fee over the configured cap;
- payer, destination, amount, invoice, and hash mismatch;
- validated `tesSUCCESS`;
- validated non-success result;
- pending transaction;
- ambiguous submission followed by reconciliation;
- duplicate transaction claim;
- repeated grant.

Before Mainnet, complete a fresh Testnet run through the Runtime-managed signer
and every optional signer included in the release.

## Production checklist

- Use `xrpl:0` explicitly for Mainnet.
- Replace development seeds with reviewed custody.
- Scope secret access to one Runtime and one secret ARN.
- Enforce explicit approval and deterministic spend policy.
- Cap transaction fees.
- Use validated ledger state.
- Store transaction hashes before ambiguous network boundaries.
- Serialize use of one payer account.
- Make transaction claims and grants idempotent.
- Run reconciliation independently of request handling.
- Alert on invalid, expired, and repeatedly pending settlements.
- Keep customer data out of `InvoiceID`; store only an opaque binding.
- Test provider failure, sequence conflict, process restart, and response loss.
