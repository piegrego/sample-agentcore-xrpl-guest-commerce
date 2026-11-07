# Ledger Lodge hotel guide

Ledger Lodge demonstrates how a hotel can connect a Runtime-paid purchase to a
guest's room while keeping the room number off the public XRP Ledger.

The guest experience is called **Proof of Stay** and the property tagline is
**Check in. Chain out.**

## Check in at the arrival kiosk

1. Open **Check In**.
2. The server creates an opaque guest session in an HTTP-only cookie.
3. Select **Assign my room**.
4. Confirm that the kiosk displays the assigned room and 11:00 AM checkout.
5. Choose one of the session options:
   - **Preview TV experience** keeps the current browser session and opens the
     in-room TV demo.
   - **Finish at kiosk** clears the guest session from that kiosk without
     checking the guest out.

The stay remains active until 11:00 AM Ledger Lodge time on the following
calendar day. **Finish at kiosk** revokes only that device's session so the
shared kiosk does not retain guest access.

Ledger Lodge has 400 simulated rooms, numbered `101` through `500`. A room
disappears from inventory while it has an active guest. The server claims both
the beneficiary and room in one atomic operation. If all 400 rooms are
occupied, the kiosk asks the guest to try again later.

The room-and-PIN endpoint remains available as a demo linking path, but the
kiosk flow does not use it.

## Continue on the room TV

1. Select **Preview TV experience** before clearing the kiosk session.
2. Confirm that the header displays the assigned room.
3. Request a title.
4. Approve the payment sheet.
5. AgentCore Runtime signs with the configured XRPL payer account.

The public sample keeps the kiosk and TV preview in one browser. A production
hotel must exchange a one-time room handoff credential between devices. It
must not copy the HTTP-only session cookie.

## Create a room receipt

1. Ask the concierge to play a title.
2. Approve the x402 payment in the storefront payment sheet.
3. Wait for playback to unlock.
4. Open **Hotel**.
5. Select **Refresh ledger**.

The receipt row shows:

- the privately resolved room number;
- movie title;
- truncated Runtime payer address;
- validated XRP amount;
- ledger time;
- shortened opaque invoice identifier.

## How the receipt works

Proof of Stay creates three records in the retained DynamoDB table:

- an active beneficiary-to-stay association;
- an active room occupancy record;
- a stay-reference-to-room mapping retained for dashboard resolution.

At 11:00 AM on the following day, the active association is treated as expired.
The beneficiary and room enter one atomic operation: one beneficiary cannot
hold two active rooms, and two beneficiaries cannot claim the same room.
Finishing a kiosk session deletes only the kiosk's guest session. Historical
mappings and ledger receipts remain available to the hotel dashboard.

For a purchase, the server derives a versioned invoice value from the random
stay reference and title. The five-minute invoice also binds the beneficiary,
title, amount, network, expected Runtime payer, and payment mode. The official
x402 XRPL client hashes the invoice value into the transaction's 256-bit
`InvoiceID`. The hotel dashboard reads incoming transactions from the merchant
wallet with `account_tx` and resolves recognized invoice IDs through DynamoDB.

The ledger remains authoritative for payment facts. DynamoDB provides the
private room context. Losing the private mapping would not erase the payment,
but it would prevent the hotel from resolving that opaque historical invoice
back to a room.

The merchant verifies that the signed account matches the configured Runtime
payer. It grants the entitlement to the beneficiary stored in the invoice, not
to the payer account. This separation prevents every hotel guest from sharing
one entitlement namespace.

The [Runtime-managed XRPL payer decision](./RUNTIME_MANAGED_XRPL.md) records the
reason for this design and the required checks.

Arbitrary XRPL `Memos` are not used because the installed x402 XRPL verifier
rejects them as a safety control.

## Privacy properties

- The primary kiosk flow does not collect a room PIN or wallet address.
- Legacy demo room PINs are never persisted.
- Room numbers are never written to XRPL.
- Stay references are random and are not derived from room numbers.
- The ledger contains only the one-way invoice hash.
- Dashboard APIs return the truncated Runtime payer address.
- Stay mappings expire according to the demo retention policy.
- AgentCore Memory does not receive the room PIN or authoritative receipt
  mapping.

XRPL transactions are public. Use test wallets and synthetic rooms for this
demo.

## Dashboard troubleshooting

If a purchase does not appear:

1. Confirm the configured Runtime payer reported a successful XRPL Testnet
   transaction.
2. Wait for validation and refresh the dashboard.
3. Confirm the purchase occurred after Proof of Stay was linked.
4. Confirm the payment was sent to the configured merchant wallet.
5. Check the storefront logs for `hotel_ledger_unavailable` or invoice
   resolution errors.

Older transactions created before the Ledger Lodge feature have no recognized
invoice binding and are intentionally omitted from the room dashboard.
