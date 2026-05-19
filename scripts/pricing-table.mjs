// Anthropic public-API pricing table.
//
// === HOW TO UPDATE ===
// 1. Visit https://www.anthropic.com/pricing and check the per-model rates.
// 2. Update PRICING_VERSION to today's date.
// 3. Adjust MODEL_RATES (inputPerMTok / outputPerMTok in USD per million tokens).
// 4. Cache and web-search multipliers rarely change but verify them too.
// 5. Re-run `npm run sync` to recompute costs in claudeSessions.local.json.
//
// The cost is API-equivalent: token usage × public-API rates. It is NOT a
// guarantee of what your card was charged — that depends on your subscription
// tier, monthly limits, and any credit balance, which the local logs cannot
// see. The UI surfaces PRICING_VERSION so you know what date these rates
// correspond to.

export const PRICING_SOURCE = 'anthropic-public-pricing'
export const PRICING_VERSION = '2026-04-27'
export const PRICING_OFFICIAL_URL = 'https://www.anthropic.com/pricing'

// Token rates in USD per million tokens.
export const MODEL_RATES = [
  {
    match: /^claude-opus-4-[67]/,
    label: 'Claude Opus 4.6/4.7',
    inputPerMTok: 5,
    outputPerMTok: 25,
  },
  {
    match: /^claude-opus-4/,
    label: 'Claude Opus 4.x',
    inputPerMTok: 15,
    outputPerMTok: 75,
  },
  {
    match: /^claude-sonnet-4/,
    label: 'Claude Sonnet 4.x',
    inputPerMTok: 3,
    outputPerMTok: 15,
  },
  {
    match: /^claude-haiku-4-5/,
    label: 'Claude Haiku 4.5',
    inputPerMTok: 1,
    outputPerMTok: 5,
  },
  {
    match: /^claude-3-5-haiku|^claude-haiku-3-5/,
    label: 'Claude Haiku 3.5',
    inputPerMTok: 0.8,
    outputPerMTok: 4,
  },
  {
    match: /^claude-3-haiku|^claude-haiku-3/,
    label: 'Claude Haiku 3',
    inputPerMTok: 0.25,
    outputPerMTok: 1.25,
  },
]

export const DEFAULT_RATE = {
  label: 'Unknown Claude model',
  inputPerMTok: 3,
  outputPerMTok: 15,
}

// Cache pricing is expressed as a multiplier on the model's input rate.
// Source: Anthropic prompt-caching docs.
export const CACHE_READ_MULTIPLIER = 0.1 // cache hits cost 10% of fresh input
export const CACHE_WRITE_5M_MULTIPLIER = 1.25 // 5-minute cache write is 1.25× input
export const CACHE_WRITE_1H_MULTIPLIER = 2.0 // 1-hour cache write is 2× input

// Server-side tools (independent of token pricing).
export const WEB_SEARCH_USD = 0.01 // per request
