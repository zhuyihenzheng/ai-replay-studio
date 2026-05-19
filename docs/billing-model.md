# Billing Model

AI Replay Studio separates token value from actual spend.

## Concepts

- `costUsd`: Backward-compatible API-equivalent list-price estimate.
- `costEstimate.apiEquivalentUsd`: Model-aware public API price estimate, including cache reads/writes and supported server tool charges.
- `billing.actualBillableUsd`: Best estimate of what should appear on a bill.
- `billing.includedUsdEquivalent`: Claude Code subscription usage that has API value but is included in a paid plan.
- `billing.extraUsageUsd`: Usage likely billed after a Claude Code subscription limit was reached.
- `billing.unknownUsdEquivalent`: Usage that has API value, but local logs cannot prove whether it was included or billed.

## Sync Configuration

Set these before running `npm run sync`:

```bash
CLAUDE_REPLAY_BILLING_MODE=subscription
CLAUDE_REPLAY_EXTRA_USAGE=unknown
CLAUDE_REPLAY_PLAN=Max
```

`CLAUDE_REPLAY_BILLING_MODE` accepts:

- `subscription`: Claude Code Pro/Max/Team style usage. API-equivalent value is treated as included unless a limit window is detected.
- `api`: Treat all usage as API/pay-as-you-go billable.
- `extra-usage`: Treat all usage as subscription extra usage.
- `unknown`: Keep API value but do not estimate billable spend.

`CLAUDE_REPLAY_EXTRA_USAGE` accepts `true`, `false`, or `unknown`. When local Claude Code logs show `You've hit your limit`, usage inside that reset window is classified as extra usage only when this flag is `true`; otherwise it is kept as unknown because local JSONL logs do not reliably prove the billing switch.

## Accuracy Boundary

Local Claude Code JSONL files contain message usage, model IDs, cache counters, and some limit errors. They do not reliably contain the account-level billing source. For exact team/org accounting, reconcile with Anthropic Usage and Cost API or Claude Code Analytics API.
