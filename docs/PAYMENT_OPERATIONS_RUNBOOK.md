# XRPL payment operations runbook

This runbook covers the sample's native XRP settlement path. The current deployment
uses XRPL Testnet. Operators must complete the mainnet readiness review before
changing the network to `xrpl:0`.

The AgentCore supervisor reaches this path through
`@agentcore-xrpl-demo/x402-payments`. The facade controls approval, compatibility, resource
retry, and result normalization. The XRPL package and storefront repository
remain responsible for transaction evidence, finality, reconciliation, and
the resource grant.

## Service behavior

The sample persists each payment through this state machine:

```text
CHALLENGED → SIGNED → SUBMITTED → VALIDATED → GRANTED
                         ├──────→ EXPIRED
                         └──────→ FAILED
```

The storefront stores settlement records, transaction claims, and entitlements
in the retained DynamoDB table. The `VALIDATED → GRANTED` transition and
entitlement write occur in one DynamoDB transaction.

The storefront reconciliation worker runs every 30 seconds. It reads
`SIGNED`, `SUBMITTED`, and `VALIDATED` records, checks submitted hashes against
the validated XRPL ledger, and creates any missing grant.

## Alarms

The stack creates two CloudWatch alarms:

- `agentcore-xrpl-demo-<environment>-payment-reconciliation-failed` fires after one
  validated transaction violates payer, destination, amount, invoice, result,
  or hash rules within five minutes.
- `agentcore-xrpl-demo-<environment>-payment-reconciliation-stuck` fires after six pending
  reconciliation events within five minutes.

The alarms do not have notification actions. Before production use, route both
alarms to the team's incident destination.

## Investigate a failed reconciliation

1. Open the storefront log group from the `StorefrontLogGroupName` stack output.
2. Search for the alarm time and `payment.reconciliation.failed`.
3. Copy the `settlementId`, `transactionId`, `correlationId`, and `reason`.
4. Correlate the facade receipt or Runtime trace with that settlement record.
5. Query the transaction from the configured XRPL provider.
6. Compare the ledger payer, destination, amount, `InvoiceID`, validation flag,
   and transaction result with the settlement record.
7. Keep the settlement in `FAILED` until an operator identifies the mismatch.
8. Create a new payment attempt when the signed transaction is invalid.

Use this CloudWatch Logs Insights query:

```text
fields @timestamp, event, correlationId, settlementId, transactionId, state, reason
| filter event like /^payment\./
| sort @timestamp desc
| limit 200
```

## Investigate a stuck reconciliation

1. Confirm the storefront task can reach the XRPL HTTPS endpoint.
2. Query the transaction hash from a second XRPL provider.
3. Check whether `LastLedgerSequence` has passed.
4. Check for payer sequence conflicts or an excessive network fee.
5. Wait for validation when the transaction remains within its ledger window.
6. Mark the attempt expired and request a new signature after the ledger window
   closes without validation.
7. Do not resubmit the same signed transaction without checking its hash first.

The package caps the open-ledger fee at 2,000 drops by default. Change
`XRPL_MAX_FEE_DROPS` only through a reviewed deployment.

## Reconcile after an outage

The worker runs once when the storefront starts and every 30 seconds after
startup. Restarting a task therefore resumes pending records without a manual
database edit.

For each pending settlement:

1. Read the stored transaction hash.
2. Query XRPL with `binary: false`.
3. Require `validated: true` and `tesSUCCESS`.
4. Check payer, destination, amount, invoice, and hash.
5. Move the record to `VALIDATED`.
6. Atomically write the grant and move the record to `GRANTED`.

If the record lacks a transaction hash, the worker leaves it pending. The
client must provide the hash through the recovery endpoint.

## Rotate the Runtime payer seed

Use this procedure for Testnet rotation:

1. Create and fund the replacement XRPL account.
2. Update the existing Secrets Manager secret with the new seed.
3. Confirm the Runtime role can read only that secret ARN.
4. Deploy a fresh Runtime version.
5. Start a fresh AgentCore session.
6. Complete one approved Testnet payment.
7. Confirm the transaction payer equals the replacement account.
8. Confirm the settlement reaches `GRANTED`.
9. Retain the old account until every submitted transaction reaches a terminal
   state.
10. Remove funds and retire the old seed under the team's secret-retention
    policy.

The current signer loads the seed when the Runtime initializes its XRPL client.
A secret update alone does not rotate an already running client.

## Roll back an application release

1. Stop new payment tests.
2. Record the current source SHA from the CloudFormation output.
3. Identify all `SIGNED`, `SUBMITTED`, and `VALIDATED` records created after the
   release.
4. Deploy the last verified source SHA with the same table and merchant wallet.
5. Keep the retained DynamoDB table. Do not replace or clear it.
6. Confirm the reconciliation worker processes the recorded settlements.
7. Complete one Testnet payment and one lost-response recovery test.
8. Resume testing after both paths reach `GRANTED`.

Application rollback must preserve the settlement table because XRPL finality
does not roll back with the container image.

## Verify a payment change

Run the repository checks from the project root:

```bash
bun run typecheck
bun run test
```

Payment tests generate addresses, transaction hashes, identifiers, invoice
values, URLs, amounts, sessions, instruments, and proof payloads at runtime.
Do not add fixed payment identities or provider resources to test fixtures.

## Mainnet readiness gate

The owner must approve all seven conditions before mainnet:

1. A signer service removes plaintext seed access from the Runtime process.
2. Two independent XRPL providers pass failover tests.
3. Alarm notifications reach an owned incident queue.
4. Operators complete a seed rotation exercise.
5. Operators complete an application rollback exercise.
6. Reconciliation handles provider outage, sequence conflict, and lost HTTP
   response tests.
7. Finance and product owners approve limits, refunds, and exception handling.
