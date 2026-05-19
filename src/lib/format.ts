export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r === 0 ? `${m}m` : `${m}m ${r}s`
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export function formatElapsed(ts: number, sessionStart: number): string {
  const elapsed = Math.max(ts - sessionStart, 0)
  const m = Math.floor(elapsed / 60000)
  const s = Math.floor((elapsed % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = now - ts
  const min = 60_000
  const hr = 60 * min
  const day = 24 * hr
  if (diff < min) return 'just now'
  if (diff < hr) return `${Math.round(diff / min)}m ago`
  if (diff < day) return `${Math.round(diff / hr)}h ago`
  return `${Math.round(diff / day)}d ago`
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
