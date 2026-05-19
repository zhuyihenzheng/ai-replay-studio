import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAppStore } from '@/store'
import { SessionShell, SessionDoc } from '@/components/SessionShell'
import { EmptyState } from '@/components/EmptyState'
import { HorizontalBarChart, StackedAreaChart } from '@/components/Charts'
import {
  apiEquivalentFor,
  billableFor,
  billingSubtext,
  billingTitle,
  billingValue,
} from '@/lib/cost'
import { formatCost, formatTokens } from '@/lib/format'
import { useT } from '@/i18n'

const STAGE_PALETTE = [
  '#b25515', // accent terracotta
  '#6d28d9', // violet
  '#1d4ed8', // blue
  '#065f46', // emerald
  '#92400e', // amber
  '#5e5644', // ink
]

const TOP_N = 20

export function CostAnalysisPage() {
  const t = useT()
  const { id = '' } = useParams()
  const session = useAppStore((s) => s.getSession(id))

  const retryWaste = useMemo(() => {
    if (!session) return 0
    return session.toolCalls
      .filter((tc) => tc.status === 'failed' || (tc.retries ?? 0) > 0)
      .reduce((a, tc) => a + apiEquivalentFor(tc), 0)
  }, [session])

  const stageData = useMemo(() => {
    if (!session) return []
    return session.stages.map((st, i) => ({
      label: st.name,
      value: parseFloat(apiEquivalentFor(st).toFixed(4)),
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
      cost: apiEquivalentFor(tc),
    }))
    const stages = session.stages.map((st, i) => ({
      name: st.name,
      color: STAGE_PALETTE[i % STAGE_PALETTE.length],
    }))
    return { perStep, stages }
  }, [session])

  const breakdown = useMemo(() => {
    if (!session) return { top: [], restCost: 0, restCount: 0, restFailed: 0 }
    const sorted = [...session.toolCalls].sort(
      (a, b) => apiEquivalentFor(b) - apiEquivalentFor(a),
    )
    const top = sorted.slice(0, TOP_N)
    const rest = sorted.slice(TOP_N)
    return {
      top,
      restCost: rest.reduce((a, tc) => a + apiEquivalentFor(tc), 0),
      restCount: rest.length,
      restFailed: rest.filter((tc) => tc.status === 'failed').length,
    }
  }, [session])

  if (!session) return <EmptyState title={t('session.not_found')} />

  const mostExpensive = [...session.stages].sort((a, b) => apiEquivalentFor(b) - apiEquivalentFor(a))[0]
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
  const billing = session.billing
  const sessionApiEquivalent = apiEquivalentFor(session)
  const sessionBillable = billableFor(session)

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
      label: t('cost.api_equivalent_value'),
      value: formatCost(sessionApiEquivalent),
      sub: session.costEstimate?.confidence
        ? t('cost.confidence', { confidence: session.costEstimate.confidence })
        : t('cost.list_price_estimate'),
    },
    {
      label: t('cost.billable_estimate'),
      value: billingValue(billing, t),
      sub: billingSubtext(billing, t),
      accent: sessionBillable > 0 || (billing?.unknownUsdEquivalent ?? 0) > 0,
    },
    {
      label: t('cost.billing_mode'),
      value: billingTitle(billing, t),
      sub: billing?.limitHit
        ? billing.limitResetText ?? t('cost.limit_observed')
        : billing?.planName ?? t('cost.not_classified'),
    },
    {
      label: t('cost.most_expensive_stage'),
      value: mostExpensive?.name ?? '—',
      sub: mostExpensive ? formatCost(apiEquivalentFor(mostExpensive)) : null,
    },
    {
      label: t('cost.retry_waste'),
      value: formatCost(retryWaste),
      sub: retryWaste > 0 ? t('cost.recoverable') : t('cost.clean_run'),
      accent: retryWaste > 0,
    },
  ]

  const breakdownMax = Math.max(
    ...breakdown.top.map((tc) => apiEquivalentFor(tc)),
    breakdown.restCost,
    0.0001,
  )

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
          className="card"
          style={{
            padding: '14px 18px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'center',
            background: '#fbfaf7',
          }}
        >
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>
              {t('cost.billing_interpretation')}
            </div>
            <div style={{ fontSize: 13, color: '#3f3a2d', lineHeight: 1.5 }}>
              {t('cost.billing_interpretation_desc')}
            </div>
          </div>
          <div
            style={{
              fontSize: 12,
              color: '#8d836b',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}
          >
            {t('cost.value_billable', {
              value: formatCost(sessionApiEquivalent),
              billable: billingValue(billing, t),
            })}
          </div>
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
              formatY={(v) => formatCost(v)}
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
              formatY={(v) => `$${v.toFixed(2)}`}
            />
          </div>
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
            <div className="section-label">
              {t('cost.top_expensive_steps', { n: Math.min(TOP_N, session.toolCalls.length) })}
            </div>
            <div style={{ fontSize: 11, color: '#bdb39c' }}>
              {t('cost.of_steps', { n: session.toolCalls.length })}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {breakdown.top.map((tc) => {
              const cost = apiEquivalentFor(tc)
              const pct = (cost / breakdownMax) * 100
              const isFailed = tc.status === 'failed'
              return (
                <div key={tc.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 200,
                      fontSize: 12,
                      color: '#3f3a2d',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                    title={tc.title}
                  >
                    {tc.title}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      background: '#efece5',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max(0.5, pct)}%`,
                        background: isFailed ? '#f43f5e' : '#1a1814',
                        borderRadius: 3,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      width: 64,
                      textAlign: 'right',
                      fontSize: 11,
                      color: '#8d836b',
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    {formatCost(cost)}
                  </div>
                  {isFailed && (
                    <span style={{ fontSize: 10, color: '#f43f5e', fontWeight: 600 }}>
                      {t('cost.failed')}
                    </span>
                  )}
                </div>
              )
            })}
            {breakdown.restCount > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  paddingTop: 8,
                  marginTop: 4,
                  borderTop: '1px dashed #efece5',
                }}
              >
                <div
                  style={{
                    width: 200,
                    fontSize: 12,
                    color: '#8d836b',
                    fontStyle: 'italic',
                    flexShrink: 0,
                  }}
                >
                  {t(
                    breakdown.restCount === 1 ? 'cost.other_steps' : 'cost.other_steps_plural',
                    { n: breakdown.restCount },
                  )}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    background: '#efece5',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.max(0.5, (breakdown.restCost / breakdownMax) * 100)}%`,
                      background: '#bdb39c',
                      borderRadius: 3,
                      opacity: 0.7,
                    }}
                  />
                </div>
                <div
                  style={{
                    width: 64,
                    textAlign: 'right',
                    fontSize: 11,
                    color: '#8d836b',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}
                >
                  {formatCost(breakdown.restCost)}
                </div>
                {breakdown.restFailed > 0 && (
                  <span style={{ fontSize: 10, color: '#f43f5e', fontWeight: 600 }}>
                    {breakdown.restFailed} {t('cost.failed')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </SessionDoc>
    </SessionShell>
  )
}
