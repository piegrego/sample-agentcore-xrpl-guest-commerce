# AgentCore Payments MPP and the XRPL bridge

## Decision

Machine Payments Protocol (MPP) support does not replace the sample's XRP Ledger
(XRPL) bridge.

MPP standardizes the HTTP exchange between a merchant and a paying agent.
Amazon Bedrock AgentCore Payments still limits MPP payment methods to `evm`,
`tempo`, and `solana`. It does not provide an `xrpl` method, an XRPL connector,
or native XRP custody and signing.

The existing payment strategy remains valid:

- AgentCore Payments handles supported USD Coin (USDC) payments.
- `@agentcore-xrpl-demo/xrpl-settlement` handles native XRP.
- `@agentcore-xrpl-demo/x402-payments` selects a compatible backend and returns one
  application-level result.

The sample requires no code or infrastructure change merely because AgentCore
Payments supports MPP. An MPP demo path would require a deliberate protocol
adapter and merchant implementation.

This guide reflects the repository and AWS documentation reviewed on
October 24, 2026.

## Three separate decisions

MPP answers only the first of these questions:

| Decision | Examples | MPP changes it? |
| --- | --- | --- |
| Payment protocol | x402 or MPP | Yes |
| Payment method and network | EVM, Tempo, Solana, or XRPL | No |
| Execution provider | AgentCore Payments, browser wallet, or custom bridge | No |

Treating these decisions as one capability creates the false assumption that
MPP support gives AgentCore Payments access to every payment network.

## What MPP adds

MPP uses the HTTP authentication challenge pattern:

1. The merchant returns a `WWW-Authenticate: Payment ...` challenge.
2. The agent sends that challenge to AgentCore Payments using the `MPP`
   payment type.
3. AgentCore Payments returns a payment credential.
4. The agent retries the resource with
   `Authorization: Payment <paymentCredential>`.
5. The merchant verifies the credential and grants or rejects the resource.

This flow gives merchants and agents a common challenge and authorization
format. It does not define how AgentCore Payments holds an XRPL key, signs an
XRPL transaction, submits it to a ledger, or verifies XRP settlement.

The sample's current AgentCore adapter uses `CRYPTO_X402`. MPP provides a second
protocol option for supported AgentCore payment methods; it does not
automatically upgrade the current adapter.

## Supported strategies

| Strategy | Out of the box with AgentCore MPP? | Sample component |
| --- | --- | --- |
| AgentCore-managed USDC through x402 | Yes, on a supported connector, network, and instrument | Existing AgentCore adapter |
| AgentCore-managed USDC through MPP | Yes at the service level; the sample would need an MPP adapter and merchant path | `@agentcore-xrpl-demo/x402-payments` extension |
| Native XRP through XRPL x402 | No | Existing XRPL bridge |
| Native XRP through an MPP-shaped merchant interface | No | New protocol adapter over the existing XRPL bridge |
| Browser-signed XRP through an approved adapter | No | Optional browser and retained XRPL merchant path |
| Automatic selection between USDC and XRP | No | Existing common facade and application policy |
| One receipt view across AgentCore and XRPL | No | Existing normalized receipt and application records |
| Wrapped or tokenized XRP on a supported network | Only when the connector and instrument explicitly support that asset and network | AgentCore adapter capability configuration |

The last row does not represent native XRP. An EVM token that represents XRP
has different custody, network, contract, settlement, and risk properties.

## Why the XRPL bridge remains necessary

AgentCore Payments does not expose a custom XRPL connector or bring-your-own
signer interface. The bridge must continue to own the native-XRP functions
below.

### Custody

The host supplies an XRPL signer. The sample includes a Secrets Manager-backed
Runtime signer. A user-controlled browser signer can be restored through an
approved adapter. AgentCore Payments connectors do not hold these XRPL keys.

### Transaction construction and signing

The bridge prepares XRPL fields such as `Sequence`, `Fee`, and
`LastLedgerSequence`. It signs the XRPL transaction using the selected custody
boundary. MPP does not define these operations.

### Submission and finality

The bridge submits the transaction and checks a validated ledger for
`tesSUCCESS`. AgentCore Payments' `PROOF_GENERATED` status does not establish
XRPL finality.

### Merchant verification

`XrplMerchantSettlement` verifies the payer, destination, amount, invoice,
transaction hash, and validated-ledger result. An MPP credential would not
remove these checks.

### Reconciliation

The sample persists backend-specific evidence and grants a resource once. The
reconciliation worker handles lost responses and pending XRPL transactions.
AgentCore observability cannot reconcile transactions that AgentCore did not
execute.

### Cross-rail orchestration

The common facade matches the challenge to a supported backend, enforces
approval, and normalizes the paid-resource result. MPP does not select between
AgentCore and XRPL or combine their receipts.

## Architecture with optional MPP

```text
Protected resource
  |
  +-- x402 challenge -------------------------------+
  |                                                 |
  +-- MPP WWW-Authenticate challenge --------+      |
                                             |      |
                                  Common payment facade
                                             |
                     +-----------------------+----------------------+
                     |                                              |
             AgentCore Payments backend                        XRPL backend
             - CRYPTO_X402                                     - x402 today
             - MPP when implemented                            - optional MPP
             - supported methods only                            facade later
                     |                                              |
               EVM / Tempo / Solana                         Native XRP Ledger
```

An optional MPP facade for XRP would standardize the HTTP grammar only. The
XRPL backend would still perform custody, signing, submission, verification,
and reconciliation. AgentCore `ProcessPayment` would not execute that native
XRP transaction.

## Changes required to demonstrate MPP

The sample needs no change to preserve its current behavior. To add MPP as another
AgentCore protocol, implement these changes:

1. Add a protocol discriminator such as `"x402" | "mpp"` to the normalized
   challenge model.
2. Parse the merchant's `WWW-Authenticate: Payment` header without treating it
   as an x402 JSON requirement.
3. Call `ProcessPayment` with the MPP payment type and the merchant challenge.
4. Retry the protected resource with the returned
   `Authorization: Payment` credential.
5. Add a merchant verifier that issues and accepts MPP challenges for the
   selected supported payment method.
6. Preserve the protocol in the normalized receipt while keeping backend and
   settlement evidence separate.
7. Handle expired challenges by requesting a fresh merchant challenge before
   another payment attempt.
8. Display and capture payer consent when the selected method requires the
   buyer to pay network fees.

The existing Payment Manager can remain in place. The deployment still needs a
connector and payment instrument that support the selected MPP method and
network. A new method can require another connector or instrument.

These changes apply to the AgentCore branch. The native-XRP transaction and
settlement code remains unchanged.

## Tests required for an MPP path

An MPP implementation must add tests for:

- x402 and MPP challenge detection without ambiguous fallback;
- malformed or unsupported `WWW-Authenticate` challenges;
- supported method and network matching;
- exact forwarding of the merchant challenge to `ProcessPayment`;
- exact forwarding of the returned payment credential to the merchant;
- challenge expiration and refresh;
- buyer-paid network-fee consent;
- merchant rejection after AgentCore creates a credential;
- stable idempotency across a refreshed HTTP challenge;
- receipt fields that distinguish protocol, backend, and settlement state;
- mixed x402 and MPP offers in either order;
- proof that an XRPL MPP-shaped challenge never routes to AgentCore Payments.

Generate identities, URLs, sessions, instruments, amounts, challenges,
credentials, and proofs inside the tests. Keep only protocol constants and
expected behavior static.

## Source traceability

### AWS documentation

| Source | Claims supported |
| --- | --- |
| [Process a payment](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-process-payment.html) | MPP request and response fields, the `WWW-Authenticate` input, the returned payment credential, retry behavior, and supported MPP methods |
| [Core concepts for AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-concepts.html) | Payment protocols, payment instruments, payment sessions, connectors, and network binding |
| [How AgentCore Payments works](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-how-it-works.html) | Payment Manager architecture, connector responsibilities, credential handling, and supported connector types |
| [Troubleshoot AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-troubleshooting.html) | The supported MPP method set and common MPP validation failures |
| [ProcessPayment API](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_ProcessPayment.html) | Authoritative `ProcessPayment` request and response contract |
| [Security best practices for AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-security-best-practices.html) | Approval, authorization, credential, session, and payment security guidance |
| [AgentCore Payments general availability announcement](https://aws.amazon.com/about-aws/whats-new/2026/08/bedrock-agentcore-payments-ga/) | General availability scope for MPP, x402, connectors, and supported payment capabilities |

### XRPL and x402 documentation

| Source | Claims supported |
| --- | --- |
| [XRPL agentic payments with x402](https://xrpl.org/docs/agents/agentic-payments-x402) | Native-XRP agentic payment flow and XRPL x402 concepts |
| [x402 exact XRPL scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_xrpl.md) | XRPL payment requirement and proof rules |
| [AWS sample: AgentCore XRPL guest commerce](https://github.com/aws-samples/sample-agentcore-xrpl-guest-commerce) | Reference integration between AgentCore Runtime, x402, and XRPL |

### Sample implementation

| Source | Claims supported |
| --- | --- |
| [`@agentcore-xrpl-demo/x402-payments`](../packages/x402-payments/README.md) | Common paid-resource API, backend selection, AgentCore adapter, and normalized receipts |
| [`@agentcore-xrpl-demo/xrpl-settlement`](../packages/agentcore-xrpl-settlement/README.md) | Native-XRP payer, merchant settlement, finality, and reconciliation responsibilities |
| [Payment backend API guide](./PAYMENT_BACKENDS_API_GUIDE.md) | API similarities, differences, custody boundaries, and finality model |
| [Payment operations runbook](./PAYMENT_OPERATIONS_RUNBOOK.md) | XRPL operational controls, recovery, and reconciliation |
| [`agent/src/index.ts`](../agent/src/index.ts) | Current Runtime backend selection and `CRYPTO_X402` execution path |

## Review trigger

Review this decision when AWS adds any of these capabilities:

- an AgentCore Payments MPP method for XRPL;
- an AgentCore connector that supports native XRP;
- a documented custom connector or bring-your-own signer interface;
- a native-XRP payment instrument;
- merchant verification and settlement support for XRPL.

Until AWS documents one of those capabilities, MPP and native-XRP support
remain separate.
