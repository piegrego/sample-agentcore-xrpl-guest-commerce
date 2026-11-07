# Restore consumer XRPL wallet support

The public sample does not bundle a browser-wallet SDK. Runtime-managed
payments remain available through Amazon Bedrock AgentCore, and the reusable
XRPL settlement packages remain wallet-provider neutral.

The original `@gemwallet/api` integration was removed before public release
because its bundled license requires permission for public-project use. Do not
restore that dependency unless the repository owner has documented permission
for the intended distribution. An alternative wallet SDK must also have a
license compatible with this repository.

## Preserve the payment-mode boundary

The public flow now separates the guest beneficiary from the Runtime-managed
XRPL payer. See
[Runtime-managed XRPL payer decision](./RUNTIME_MANAGED_XRPL.md).

A restored consumer-wallet flow changes that custody decision for its own
payments: the verified wallet becomes both beneficiary and payer. It must
create an invoice with `paymentMode: "consumer-wallet"` and set the expected
payer to the verified wallet address. It must not submit a wallet-signed
transaction against a `runtime-managed` invoice or remove the Runtime payer
validation from that path.

## Retained integration boundary

The removal does not change the server-side wallet and settlement contracts:

- `POST /api/wallet/challenge` creates a short-lived identity challenge.
- `POST /api/wallet/verify` verifies the signed challenge.
- `POST /api/wallet/logout` clears the browser session.
- `POST /api/session/handoff` clears a shared kiosk session without ending the
  stay.
- `POST /api/xrpl/prepare` completes an unsigned XRPL payment with ledger
  fields.
- `POST /api/xrpl/recover` checks a submitted transaction and recovers an
  entitlement after an ambiguous browser response.
- `BrowserExactXrplScheme` in `src/lib/browserXrplScheme.ts` converts an
  approved wallet signature into the x402 XRPL payload.
- `XrplMerchantSettlement` remains responsible for validation, settlement,
  durable records, reconciliation, and idempotent grants.

These boundaries allow another approved wallet to be added without changing
the merchant verifier or Runtime-managed payment facade.

## Adapter contract

Implement a local adapter around the selected wallet SDK. Keep provider types
and error handling inside that adapter.

```ts
import type { Payment } from "xrpl";

export interface ConsumerWalletAdapter {
  isAvailable(): Promise<boolean>;
  getIdentity(): Promise<{
    address: string;
    publicKey: string;
    network: "Mainnet" | "Testnet" | "Devnet";
  }>;
  signMessage(message: string): Promise<string>;
  signTransaction(
    transaction: Payment
  ): Promise<{ signedTxBlob: string }>;
}
```

The adapter must never return a seed or private key to the application.

## Restoration steps

1. Confirm that the wallet SDK license permits this repository's public use.
2. Add the SDK with an exact version and regenerate `bun.lock`.
3. Implement `ConsumerWalletAdapter` in a provider-specific module.
4. Reintroduce a provider-neutral identity client:
   - read the wallet address, public key, and selected network;
   - request `/api/wallet/challenge`;
   - ask the wallet to sign the returned message;
   - submit the signature to `/api/wallet/verify`.
5. Reintroduce the browser payment client:
   - request the paid resource and parse the x402 challenge;
   - validate network, asset, amount, and spend policy;
   - call `/api/xrpl/prepare`;
   - ask the adapter to review and sign the transaction;
   - use `BrowserExactXrplScheme` to create the x402 payload;
   - retry the resource;
   - call `/api/xrpl/recover` when settlement may have succeeded but the
     response was lost.
6. Add `"wallet"` back to `ApprovalMode`, return it from
   `supportedApprovalModes()`, and restore the wallet choice in
   `PaymentSheet`.
7. Restore the Check-In and header controls through the provider-neutral
   identity client. Keep provider names out of shared components.
8. Update this guide, the root README, the hotel guide, and the architecture
   diagrams to identify the selected provider and custody boundary.

## Required tests

Use generated fixtures. Do not hardcode wallet addresses, transaction hashes,
seeds, challenge IDs, session IDs, or invoice identifiers.

Add tests for:

- wallet unavailable, locked, and user-rejected requests;
- unsupported or mismatched XRPL network;
- invalid, expired, and replayed identity signatures;
- transaction payer differing from the authenticated wallet;
- unsupported scheme, asset, or amount;
- fee and session-limit enforcement;
- lost-response recovery and duplicate settlement submission;
- one durable grant for repeated requests;
- browser bundle startup without Node-only globals;
- Runtime-managed and consumer-wallet paths using the same merchant
  validation and reconciliation rules.

Before release, rerun dependency, license, secret, source, container, and CDK
security scans. Record written approval for any dependency whose license is
not clearly compatible with MIT-0 distribution.
