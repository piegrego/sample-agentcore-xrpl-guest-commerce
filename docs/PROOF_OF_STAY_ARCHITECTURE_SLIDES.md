# Proof of Stay — Slide Outline

## Title slide

**Proof of Stay**

AgentCore-orchestrated commerce settled on the XRP Ledger

AWS + XRPL + x402

---

## Slide 1 — The blockchain developer's starting point

**Build paid, agent-driven experiences without coupling product logic to the
payment rail**

- An opaque guest session establishes the entitlement beneficiary.
- Proof of Stay supplies private application context: beneficiary, room, stay,
  and checkout time.
- The merchant protects a resource with an HTTP 402 x402 challenge.
- AgentCore Runtime discovers the challenge and requests explicit approval.
- The Runtime-managed XRPL account funds the payment.
- Validated settlement grants the application entitlement to the guest.

**Visual**

```text
Guest beneficiary -> AgentCore task -> HTTP 402 -> Runtime XRP payment -> Guest grant
```

**Speaker note**

The hotel and movie are examples. The reusable pattern is an authenticated
beneficiary, an explicitly authorized payer, a protected resource,
deterministic approval, ledger settlement, and an idempotent grant. The sample
uses different identities for the guest beneficiary and Runtime payer.

---

## Slide 2 — AgentCore is the orchestration and policy boundary

**AgentCore decides how work is coordinated; deterministic code decides whether
money can move**

- Supervisor Runtime owns the user session and payment workflow.
- Explicit approval and per-payment limits are checked outside the model.
- Secrets Manager supplies the Runtime-managed payer only on the approved path.
- AgentCore Memory stores preferences, never seeds, approval, balance, or
  finality.
- Gateway and Policy Engine constrain read-only specialist tools.
- Specialist Runtimes cannot receive payment authority.

**Visual**

```text
                         +-> Preference Memory
User -> Supervisor Runtime
                         +-> Gateway -> Policy -> Read-only tools
                         +-> Approved XRPL payer

Specialists: analysis only; no signing authority
```

**Speaker note**

Native XRP does not pass through AgentCore Payments in this implementation.
AgentCore Runtime is the host and control plane; XRPL is the settlement rail.

---

## Slide 3 — One Runtime payment API, explicit rail adapters

**The Runtime calls one paid-resource facade without hiding settlement
differences**

1. Merchant returns an HTTP 402 challenge.
2. Runtime obtains explicit approval and chooses a compatible live backend.
3. `@agentcore-xrpl-demo/x402-payments` validates the request and invokes the selected
   adapter.
4. The XRPL adapter prepares and signs native XRP; the AgentCore adapter calls
   `ProcessPayment` for a configured connector asset.
5. Both adapters retry the same protected resource and return one application
   result shape.
6. Backend receipts retain different proof and finality evidence.

**Visual**

```text
                    +-> XRPL payer -> merchant verifier -> XRPL validation
402 -> approval -> facade
                    +-> AgentCore Payments -> compatible merchant verifier
```

**Speaker note**

`PROOF_GENERATED` from AgentCore Payments and `VALIDATED` on XRPL are not the
same milestone. The facade aligns the developer call, not the ledgers or
custody models.

---

## Slide 4 — Reuse the implemented packages

**Compose the common facade with the rail and application adapters you need**

```text
Application workflow
└── @agentcore-xrpl-demo/x402-payments
    ├── XRPL adapter -> @agentcore-xrpl-demo/xrpl-settlement
    └── AgentCore Payments adapter -> ProcessPayment

Browser wallet -> XRPL merchant and settlement package
Sandbox        -> demo resolver outside the live facade
```

- Reuse the facade for Runtime-managed live payment selection and normalized
  results.
- Reuse the XRPL package for native-XRP preparation, merchant verification,
  finality inspection, and reconciliation.
- Replace host adapters for custody, authentication, invoice binding, locks,
  repositories, and the granted resource.
- Reuse for paid APIs, tickets, datasets, games, subscriptions, or digital
  downloads.
- If consumer signing is restored, keep the approved browser-wallet adapter
  separate from Runtime custody while sharing the merchant settlement
  lifecycle.
- Validate each rail end to end before claiming production support.

**Developer handoff**

See [`NEXT_STEPS_XRPL_AGENTCORE.md`](./NEXT_STEPS_XRPL_AGENTCORE.md) for the
implemented package map, extension patterns, tests, and production checklist.
See [`RUNTIME_MANAGED_XRPL.md`](./RUNTIME_MANAGED_XRPL.md) for the payer and
beneficiary decision.
