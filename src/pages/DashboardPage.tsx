import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Filter, Calendar, Sparkles, Clock, Wrench, FileDiff, RotateCw } from 'lucide-react'
import { useAppStore } from '@/store'
import { SourceBadge, StatusBadge } from '@/components/Badge'
import { MiniTimeline } from '@/components/MiniTimeline'
import { EmptyState } from '@/components/EmptyState'
import { formatDuration, formatRelative, formatTokens } from '@/lib/format'
import { useT } from '@/i18n'
import type { AgentSource, Session, SessionStatus } from '@/types'

const statusFilters: (SessionStatus | 'all')[] = ['all', 'success', 'partial', 'failed', 'running']

const sourceFilters: { value: AgentSource | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'dashboard.source.all' },
  { value: 'claude-code', labelKey: 'dashboard.source.claude_code' },
  { value: 'cursor', labelKey: 'dashboard.source.cursor' },
  { value: 'codex', labelKey: 'dashboard.source.codex' },
]

type TimeRange = 'all' | '24h' | '7d' | '30d'

const DAY_MS = 24 * 60 * 60 * 1000
const rangeFilters: { value: TimeRange; labelKey: string; ms: number }[] = [
  { value: 'all', labelKey: 'dashboard.range.all', ms: 0 },
  { value: '24h', labelKey: 'dashboard.range.last_24h', ms: DAY_MS },
  { value: '7d', labelKey: 'dashboard.range.last_7d', ms: 7 * DAY_MS },
  { value: '30d', labelKey: 'dashboard.range.last_30d', ms: 30 * DAY_MS },
]

export function DashboardPage() {
  const t = useT()
  const sessions = useAppStore((s) => s.sessions)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<SessionStatus | 'all'>('all')
  const [source, setSource] = useState<AgentSource | 'all'>('all')
  const [range, setRange] = useState<TimeRange>('7d')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const now = Date.now()
    const rangeMs = rangeFilters.find((r) => r.value === range)?.ms ?? 0
    return sessions.filter((s) => {
      if (status !== 'all' && s.status !== status) return false
      if (source !== 'all' && s.source !== source) return false
      if (rangeMs > 0 && s.startedAt < now - rangeMs) return false
      if (q && !s.title.toLowerCase().includes(q) && !s.summary.toLowerCase().includes(q)) return false
      return true
    })
  }, [sessions, query, status, source, range])

  const totals = useMemo(() => {
    const successful = filtered.filter((s) => s.status === 'success').length
    const settled = filtered.filter((s) => s.status !== 'running').length
    const tokens = filtered.reduce((a, s) => a + s.tokensIn + s.tokensOut, 0)
    const cacheRead = filtered.reduce((a, s) => a + (s.usage?.cacheReadTokens ?? 0), 0)
    const inputish = filtered.reduce(
      (a, s) =>
        a +
        (s.usage
          ? s.usage.inputTokens +
            s.usage.cacheReadTokens +
            s.usage.cacheWrite5mTokens +
            s.usage.cacheWrite1hTokens
          : s.tokensIn),
      0,
    )
    return {
      sessions: filtered.length,
      successRate: settled === 0 ? 0 : successful / settled,
      tokens,
      cacheShare: inputish > 0 ? cacheRead / inputish : 0,
      artifacts: filtered.reduce((a, s) => a + s.artifacts.length, 0),
    }
  }, [filtered])

  const stats = [
    { label: t('dashboard.stat.total_sessions'), value: String(totals.sessions) },
    { label: t('dashboard.stat.success_rate'), value: `${Math.round(totals.successRate * 100)}%` },
    { label: t('dashboard.stat.saved_artifacts'), value: String(totals.artifacts) },
  ]

  return (
    <div className="fade-in" style={{ padding: '32px 32px 48px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="section-label" style={{ marginBottom: 4 }}>
          {t('dashboard.workspace')}
        </div>
        <h1
          style={{
            fontFamily: '"Source Serif 4", serif',
            fontSize: 30,
            fontWeight: 600,
            color: '#0f0d0a',
            lineHeight: 1.2,
            marginBottom: 6,
          }}
        >
          {t('dashboard.title')}
        </h1>
        <p style={{ fontSize: 14, color: '#8d836b', maxWidth: 480 }}>
          {t('dashboard.subtitle')}
        </p>
      </div>

      <div className="card" style={{ padding: '20px 24px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 230px', minWidth: 0 }}>
            <div
              style={{
                fontFamily: '"Source Serif 4", serif',
                fontSize: 28,
                fontWeight: 600,
                color: '#0f0d0a',
                lineHeight: 1.15,
              }}
            >
              {t('dashboard.hero.tokens_label')} {formatTokens(totals.tokens)}
            </div>
          </div>
          <div style={{ flex: '1 1 230px', minWidth: 0, textAlign: 'right' }}>
            <div
              style={{
                fontFamily: '"Source Serif 4", serif',
                fontSize: 28,
                fontWeight: 600,
                color: '#5e8b6a',
                lineHeight: 1.15,
              }}
            >
              {t('dashboard.hero.cache_label')} {Math.round(totals.cacheShare * 100)}%
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #efece5', fontSize: 13, color: '#8d836b', lineHeight: 1.5 }}>
          {t('dashboard.hero.caption')}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
        {stats.map((c) => (
          <div key={c.label} className="card" style={{ padding: '16px 20px' }}>
            <div className="section-label" style={{ marginBottom: 4 }}>
              {c.label}
            </div>
            <div
              style={{
                fontFamily: '"Source Serif 4", serif',
                fontSize: 26,
                fontWeight: 600,
                color: '#0f0d0a',
              }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ position: 'relative', flexGrow: 1, minWidth: 220, maxWidth: 380 }}>
          <span
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#8d836b',
              display: 'flex',
            }}
          >
            <Search size={13} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('dashboard.search_placeholder')}
            style={{
              width: '100%',
              paddingLeft: 30,
              paddingRight: 12,
              paddingTop: 7,
              paddingBottom: 7,
              fontSize: 13,
              border: '1px solid #dcd6c8',
              borderRadius: 8,
              outline: 'none',
              fontFamily: 'inherit',
              background: 'white',
              color: '#0f0d0a',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#bdb39c')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#dcd6c8')}
          />
        </div>

        <div
          style={{
            display: 'flex',
            background: '#f8f7f4',
            borderRadius: 8,
            padding: 3,
            border: '1px solid #efece5',
            gap: 1,
          }}
        >
          {statusFilters.map((f) => {
            const active = status === f
            return (
              <button
                key={f}
                onClick={() => setStatus(f)}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? 'white' : 'transparent',
                  color: active ? '#0f0d0a' : '#8d836b',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.07)' : 'none',
                  transition: 'all 0.12s',
                  fontFamily: 'inherit',
                }}
              >
                {t(`dashboard.filter.${f}`)}
              </button>
            )
          })}
        </div>

        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#8d836b',
              display: 'flex',
              pointerEvents: 'none',
            }}
          >
            <Filter size={12} />
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as AgentSource | 'all')}
            style={{
              paddingLeft: 28,
              paddingRight: 28,
              paddingTop: 7,
              paddingBottom: 7,
              fontSize: 13,
              border: '1px solid #dcd6c8',
              borderRadius: 8,
              outline: 'none',
              fontFamily: 'inherit',
              background: 'white',
              color: '#3f3a2d',
              cursor: 'pointer',
              appearance: 'none',
            }}
          >
            {sourceFilters.map((f) => (
              <option key={f.value} value={f.value}>
                {t(f.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#8d836b',
              display: 'flex',
              pointerEvents: 'none',
            }}
          >
            <Calendar size={12} />
          </span>
          <select
            value={range}
            aria-label={t('dashboard.range.label')}
            onChange={(e) => setRange(e.target.value as TimeRange)}
            style={{
              paddingLeft: 28,
              paddingRight: 28,
              paddingTop: 7,
              paddingBottom: 7,
              fontSize: 13,
              border: '1px solid #dcd6c8',
              borderRadius: 8,
              outline: 'none',
              fontFamily: 'inherit',
              background: 'white',
              color: '#3f3a2d',
              cursor: 'pointer',
              appearance: 'none',
            }}
          >
            {rangeFilters.map((f) => (
              <option key={f.value} value={f.value}>
                {t(f.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={t('dashboard.empty_match')} description={t('dashboard.empty_match_desc')} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 16,
          }}
        >
          {filtered.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionCard({ session: s }: { session: Session }) {
  const t = useT()
  const stats = [
    { icon: Clock, label: formatDuration(s.durationMs) },
    { icon: Wrench, label: t('session_card.calls', { n: s.toolCallCount }) },
    { icon: FileDiff, label: t('session_card.files', { n: s.changedFileCount }) },
    { icon: Sparkles, label: t('session_card.tokens', { n: formatTokens(s.tokensIn + s.tokensOut) }) },
  ] as { icon: typeof Clock; label: string }[]
  if (s.retryCount > 0) {
    stats.push({ icon: RotateCw, label: t('session_card.retries', { n: s.retryCount }) })
  }

  return (
    <Link
      to={`/sessions/${s.id}`}
      className="card card-hover"
      style={{ padding: 20, cursor: 'pointer', display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <SourceBadge source={s.source} />
        <StatusBadge status={s.status} />
      </div>
      <h3
        style={{
          fontFamily: '"Source Serif 4", serif',
          fontSize: 16,
          fontWeight: 600,
          color: '#0f0d0a',
          lineHeight: 1.35,
          marginBottom: 4,
        }}
      >
        {s.title}
      </h3>
      <p
        style={{
          fontSize: 12,
          color: '#8d836b',
          lineHeight: 1.5,
          marginBottom: 14,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {s.summary}
      </p>

      <div style={{ marginBottom: 14 }}>
        <MiniTimeline values={s.miniTimeline} highlightStatus={s.status} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 12px',
          fontSize: 11,
          color: '#8d836b',
        }}
      >
        {stats.map((st, i) => {
          const Icon = st.icon
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon size={11} />
              <span>{st.label}</span>
            </div>
          )
        })}
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid #efece5',
          fontSize: 11,
          color: '#bdb39c',
        }}
      >
        {formatRelative(s.startedAt)}
      </div>
    </Link>
  )
}
