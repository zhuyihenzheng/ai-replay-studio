import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAppStore } from '@/store'
import { SessionShell, SessionDoc } from '@/components/SessionShell'
import { EmptyState } from '@/components/EmptyState'
import { HorizontalBarChart, StackedAreaChart } from '@/components/Charts'
import { formatTokens } from '@/lib/format'
import { useT } from '@/i18n'

const tokensOfCall = (c?: { tokensIn?: number; tokensOut?: number }) =>
  c ? (c.tokensIn ?? 0) + (c.tokensOut ?? 0) : 0

const STAGE_PALETTE = [
  '#b25515', // accent terracotta
  '#6d28d9', // violet
  '#1d4ed8', // blue
  '#065f46', // emerald
  '#92400e', // amber
  '#5e5644', // ink
]


export function CostAnalysisPage() {
  const t = useT()
  const { id = '' } = useParams()
  const session = useAppStore((s) => s.getSession(id))

  const retryWaste = useMemo(() => {
    if (!session) return 0
    return session.toolCalls
      .filter((tc) => tc.status === 'failed' || (tc.retries ?? 0) > 0)
      .reduce((a, tc) => a + tokensOfCall(tc), 0)
  }, [session])

  const stageData = useMemo(() => {
    if (!session) return []
    const callById = new Map(session.toolCalls.map((c) => [c.id, c]))
    return session.stages.map((st, i) => ({
      label: st.name,
      value: st.toolCallIds.reduce((a, cid) => a + tokensOfCall(callById.get(cid)), 0),
      color: STAGE_PALETTE[i % STAGE_PALETTE.length],
      status: st.status,
    }))
  }, [session])

  const stagedSeries = useMemo(() => {
    if (!session) return { perStep: [], stages: [] as { name: string; color: string }[] }
    const stageIdxByCallId = new Map<string, number>()
    session.stages.forEach((st, idx) => {
      st.toolCallIds.forEach((tcId) => stageIdxByCallId.set(tcId, idx))
    })
    const perStep = session.toolCalls.map((tc) => ({
      stageIndex: stageIdxByCallId.get(tc.id) ?? 0,
      cost: tokensOfCall(tc),
    }))
    const stages = session.stages.map((st, i) => ({
      name: st.name,
      color: STAGE_PALETTE[i % STAGE_PALETTE.length],
    }))
    return { perStep, stages }
  }, [session])

  if (!session) return <EmptyState title={t('session.not_found')} />

  const mostHeavyStage = [...stageData].sort((a, b) => b.value - a.value)[0]
  const totalTokens = session.tokensIn + session.tokensOut

  const u = session.usage
  const tokenMix = u
    ? [
        { key: 'fresh_input', n: u.inputTokens, mult: 1 as number | null, color: '#8d836b' },
        { key: 'output', n: u.outputTokens, mult: null as number | null, color: '#5e5644' },
        { key: 'cache_read', n: u.cacheReadTokens, mult: 0.1 as number | null, color: '#5e8b6a' },
        { key: 'cache_write_5m', n: u.cacheWrite5mTokens, mult: 1.25 as number | null, color: '#b25515' },
        { key: 'cache_write_1h', n: u.cacheWrite1hTokens, mult: 2 as number | null, color: '#a83352' },
      ].filter((r) => r.n > 0)
    : []
  const tokenMixTotal = tokenMix.reduce((a, r) => a + r.n, 0)
  const cards: { label: string; value: string; sub: string | null; accent?: boolean }[] = [
    {
      label: t('cost.total_tokens'),
      value: formatTokens(totalTokens),
      sub: t('cost.input_output', {
        input: formatTokens(session.tokensIn),
        output: formatTokens(session.tokensOut),
      }),
    },
    {
      label: t('cost.most_expensive_stage'),
      value: mostHeavyStage?.label ?? '—',
      sub: mostHeavyStage
        ? t('session_card.tokens', { n: formatTokens(mostHeavyStage.value) })
        : null,
    },
    {
      label: t('cost.retry_waste'),
      value: t('session_card.tokens', { n: formatTokens(retryWaste) }),
      sub: retryWaste > 0 ? t('cost.recoverable') : t('cost.clean_run'),
      accent: retryWaste > 0,
    },
  ]


  return (
    <SessionShell session={session}>
      <SessionDoc>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {cards.map((c) => (
            <div key={c.label} className="card" style={{ padding: '16px 20px' }}>
              <div className="section-label" style={{ marginBottom: 4 }}>
                {c.label}
              </div>
              <div
                style={{
                  fontFamily: '"Source Serif 4", serif',
                  fontSize: 24,
                  fontWeight: 600,
                  color: c.accent ? '#b45309' : '#0f0d0a',
                  marginBottom: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={c.value}
              >
                {c.value}
              </div>
              {c.sub && <div style={{ fontSize: 11, color: '#8d836b' }}>{c.sub}</div>}
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="section-label" style={{ marginBottom: 4 }}>
            {t('cost.token_mix.title')}
          </div>
          <div style={{ fontSize: 12, color: '#8d836b', marginBottom: 14, lineHeight: 1.5 }}>
            {t('cost.token_mix.caption')}
          </div>
          {tokenMixTotal === 0 ? (
            <div style={{ fontSize: 13, color: '#8d836b' }}>{t('cost.token_mix.none')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tokenMix.map((r) => {
                const pct = (r.n / tokenMixTotal) * 100
                return (
                  <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 156, flexShrink: 0, fontSize: 12, color: '#3f3a2d' }}>
                      {t(`cost.token_mix.${r.key}`)}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: 8,
                        background: '#efece5',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(pct, 1)}%`,
                          height: '100%',
                          background: r.color,
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        width: 88,
                        flexShrink: 0,
                        textAlign: 'right',
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 12,
                        color: '#0f0d0a',
                      }}
                    >
                      {formatTokens(r.n)}
                    </div>
                    <div
                      style={{
                        width: 40,
                        flexShrink: 0,
                        textAlign: 'right',
                        fontSize: 11,
                        color: '#8d836b',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {Math.round(pct)}%
                    </div>
                    <div
                      style={{
                        width: 116,
                        flexShrink: 0,
                        textAlign: 'right',
                        fontSize: 11,
                        color: r.mult != null && r.mult < 1 ? '#5e8b6a' : '#8d836b',
                      }}
                    >
                      {r.mult == null
                        ? t('cost.token_mix.output_rate')
                        : t('cost.token_mix.mult', { m: r.mult })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div className="card" style={{ padding: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div className="section-label">{t('cost.cost_by_stage')}</div>
              <div style={{ fontSize: 11, color: '#bdb39c' }}>
                {t(session.stages.length === 1 ? 'cost.stages_count' : 'cost.stages_count_plural', {
                  n: session.stages.length,
                })}
              </div>
            </div>
            <HorizontalBarChart
              data={stageData}
              formatY={(v) => formatTokens(v)}
            />
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div className="section-label">{t('cost.cumulative_cost_over_steps')}</div>
              <div style={{ fontSize: 11, color: '#bdb39c' }}>{t('cost.by_stage')}</div>
            </div>
            <StackedAreaChart
              perStep={stagedSeries.perStep}
              stages={stagedSeries.stages}
              formatY={(v) => formatTokens(v)}
            />
          </div>
        </div>

      </SessionDoc>
    </SessionShell>
  )
}
