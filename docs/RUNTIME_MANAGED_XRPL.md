# Runtime-managed XRPL payer decision

## Decision

The public sample uses Amazon Bedrock AgentCore Runtime as the XRP Ledger
(XRPL) payer. An opaque guest session receives the playback entitlement.

The payer and beneficiary are different identities:

| Role | Identity | Responsibility |
| --- | --- | --- |
| Beneficiary | Random guest-session ID in an HTTP-only cookie | Owns Proof of Stay, spending state, and playback entitlements |
| Payer | Public XRPL address configured through `xrplRuntimePayerAddress` | Funds and signs the XRPL transaction inside AgentCore Runtime |

This separation became necessary when the October 27, 2026 public-release
change removed the browser wallet adapter. The adapter's license required
permission for public-project use. Keeping wallet-owned entitlements after
that removal left no valid flow: the browser could not authenticate a wallet,
and the merchant rejected the Runtime signer because it differed from the
guest wallet.

The implementation does not weaken the old payer check. It replaces that
check with an explicit managed-payment authorization.

## Authorization boundary

The storefront creates a five-minute invoice after an authenticated guest
session requests a protected title through the concierge. The invoice binds
one beneficiary, beneficiary type, XRPL network, title, amount, expected
Runtime payer, stay reference, and payment mode.

The merchant grants access only when all invoice fields match the request and
the signed XRPL account equals `XRPL_RUNTIME_PAYER_ADDRESS`. The Runtime also
derives the address from its Secrets Manager seed and refuses to sign when the
derived address differs from the configured public address.

The flow follows this sequence:

```text
Guest session → Proof of Stay → five-minute invoice
      ↓                               ↓
entitlement beneficiary       expected Runtime payer
                                      ↓
                         signed and validated XRPL payment
                                      ↓
                    atomic grant to the guest beneficiary
```

The transaction claim, settlement state machine, and per-beneficiary lock
prevent one transaction from granting multiple resources or guest sessions.
Reconciliation restores the beneficiary from the invoice instead of treating
the payer as the entitlement owner.

## Why the merchant cannot accept any Runtime payment

A check that only verifies the merchant and amount would let a valid payment
grant access to an unrelated browser session. The invoice therefore authorizes
the Runtime payer to pay for exactly one guest, title, amount, network, and
stay. A signer mismatch returns `runtime_payer_mismatch`. A beneficiary,
title, amount, network, mode, or expiry mismatch returns
`managed_payment_authorization_mismatch`.

## Consumer-wallet compatibility

The server retains the wallet challenge and signature contracts for a future
licensed adapter. That future path must create a `consumer-wallet` invoice and
keep the wallet as both payer and beneficiary. It must not reuse a
`runtime-managed` invoice.

See [Restore consumer XRPL wallet support](./CONSUMER_WALLET_RESTORATION.md)
before adding a browser wallet.

## Deployment configuration

Live XRP deployments require three separate values:

| CDK context | Purpose |
| --- | --- |
| `xrplMerchantAddress` | Receives the XRP payment |
| `xrplRuntimePayerAddress` | Identifies the approved Runtime payer without exposing its seed |
| `xrplWalletSeedSecretArn` | Lets only the concierge Runtime retrieve the matching payer seed |

CDK validates both public addresses. The Runtime validates that the secret
matches `xrplRuntimePayerAddress` before it constructs a signer. The storefront
receives the two public addresses but never receives the payer seed.

## Production boundary

The public sample keeps one guest session in one browser. The **Preview TV
experience** action preserves that session. A production multi-device hotel
flow must exchange a single-use handoff credential between the kiosk and room
TV; it must not copy the browser cookie.

The Runtime reads decrypted seed material during signing. Production systems
must select a custody boundary and controls that match the payment value,
regulatory obligations, and incident model.
