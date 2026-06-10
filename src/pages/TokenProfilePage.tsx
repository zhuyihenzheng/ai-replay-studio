import type { CSSProperties, ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useAppStore } from '@/store'
import { SessionShell, SessionDoc } from '@/components/SessionShell'
import { EmptyState } from '@/components/EmptyState'
import { HorizontalBarChart, LineChart } from '@/components/Charts'
import { formatCost, formatDateTime, formatDuration, formatTokens } from '@/lib/format'
import { useT } from '@/i18n'
import type { TokenProfile } from '@/types'

const PHASE_COLORS: Record<string, string> = {
  explore: '#1d4ed8',
  edit: '#b25515',
  execute: '#5e5644',
  test: '#065f46',
  subagent: '#6d28d9',
  mcp: '#92400e',
  other: '#8d836b',
  respond: '#bdb39c',
}

const th: CSSProperties = {
  textAlign: 'right',
  padding: '6px 10px',
  fontSize: 11,
  color: '#8d836b',
  fontWeight: 500,
  borderBottom: '1px solid #efece5',
  whiteSpace: 'nowrap',
}
const thLeft: CSSProperties = { ...th, textAlign: 'left' }
const td: CSSProperties = {
  textAlign: 'right',
  padding: '6px 10px',
  fontSize: 12,
  color: '#0f0d0a',
  fontFamily: '"JetBrains Mono", monospace',
  fontVariantNumeric: 'tabular-nums',
  borderBottom: '1px solid #f8f7f4',
  whiteSpace: 'nowrap',
}
const tdLeft: CSSProperties = {
  ...td,
  textAlign: 'left',
  fontFamily: 'inherit',
  maxWidth: 320,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div className="section-label" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: '"Source Serif 4", serif',
          fontSize: 24,
          fontWeight: 600,
          color: accent ? '#b45309' : '#0f0d0a',
          marginBottom: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#8d836b' }}>{sub}</div>}
    </div>
  )
}

function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div className="section-label" style={{ marginBottom: 4 }}>
        {title}
      </div>
      {caption && (
        <div style={{ fontSize: 12, color: '#8d836b', marginBottom: 14, lineHeight: 1.5 }}>{caption}</div>
      )}
      {children}
    </div>
  )
}

function WasteTable({ rows, t }: { rows: TokenProfile['waste']['repeatedReads']; t: (k: string, p?: Record<string, string | number>) => string }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>{t('profiler.waste.reads')}</th>
          <th style={thLeft}>{t('profiler.waste.target')}</th>
          <th style={th}>{t('profiler.waste.total_est')}</th>
          <th style={th}>{t('profiler.waste.wasted_est')}</th>
          <th style={thLeft}>{t('profiler.waste.turns')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td style={td}>{r.count}×</td>
            <td style={tdLeft} title={r.key}>
              {r.key}
            </td>
            <td style={td}>{formatTokens(r.totalEstTokens)}</td>
            <td style={{ ...td, color: r.wastedEstTokens > 0 ? '#b45309' : '#0f0d0a' }}>
              {formatTokens(r.wastedEstTokens)}
            </td>
            <td style={tdLeft}>{r.turns.join(', ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TokenProfilePage() {
  const t = useT()
  const { id = '' } = useParams()
  const session = useAppStore((s) => s.getSession(id))
  const profile = useAppStore((s) => s.getProfile(id))

  if (!session) return <EmptyState title={t('session.not_found')} />

  if (!profile) {
    return (
      <SessionShell session={session}>
        <SessionDoc>
          <EmptyState title={t('profiler.empty_title')} description={t('profiler.empty_desc')} />
          <div
            className="card"
            style={{
              padding: '14px 20px',
              marginTop: 16,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 13,
              color: '#3f3a2d',
            }}
          >
            npm run profile -- --export
          </div>
        </SessionDoc>
      </SessionShell>
    )
  }

  const g = profile.totals.grand
  const cacheWrite = g.cacheWrite5m + g.cacheWrite1h
  const totalCost = profile.turnRows.reduce((a, r) => a + r.costUsd, 0) || 1
  const totalPhaseResult = profile.phases.reduce((a, p) => a + p.resultEstTokens, 0) || 1
  const contextData = profile.contextSeries.map((v, i) => ({ step: i + 1, tokens: v }))
  const gapRewrite = profile.expiryGaps.reduce((a, gp) => a + gp.rewriteTokens, 0)

  return (
    <SessionShell session={session}>
      <SessionDoc>
        {/* Summary cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <Card
            label={t('profiler.cards.cache_hit_rate')}
            value={`${(profile.totals.cacheHitRate * 100).toFixed(1)}%`}
            sub={t('profiler.cards.cache_hit_sub', { read: formatTokens(g.cacheRead), write: formatTokens(cacheWrite) })}
          />
          <Card
            label={t('profiler.cards.peak_context')}
            value={formatTokens(profile.totals.peakContext)}
            sub={t('profiler.cards.peak_context_sub')}
          />
          <Card
            label={t('profiler.cards.repeat_waste')}
            value={formatTokens(profile.waste.repeatedReadWasteEstTokens)}
            sub={
              profile.waste.repeatedReads.length > 0
                ? t('profiler.cards.repeat_waste_sub', { n: profile.waste.repeatedReads.length })
                : t('profiler.cards.repeat_waste_clean')
            }
            accent={profile.waste.repeatedReadWasteEstTokens > 0}
          />
          <Card
            label={t('profiler.cards.failed_calls')}
            value={String(profile.counts.failedToolCalls)}
            sub={t('profiler.cards.failed_calls_sub', { n: profile.counts.toolCalls })}
            accent={profile.counts.failedToolCalls > 0}
          />
          <Card
            label={t('profiler.cards.est_cost')}
            value={formatCost(profile.totals.estCostUsd)}
            sub={t('profiler.cards.est_cost_sub', { v: profile.pricingVersion })}
          />
        </div>

        {/* Context growth */}
        {contextData.length > 1 && (
          <Section title={t('profiler.context.title')} caption={t('profiler.context.caption')}>
            <LineChart data={contextData} xKey="step" yKey="tokens" formatY={(v) => formatTokens(v)} />
            {profile.compacts.length > 0 && (
              <div style={{ fontSize: 11, color: '#8d836b', marginTop: 6 }}>
                {t('profiler.context.compacts_hint', { n: profile.compacts.length })}
              </div>
            )}
          </Section>
        )}

        {/* Per-turn breakdown */}
        <Section title={t('profiler.turns.title')} caption={t('profiler.turns.caption')}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thLeft}>#</th>
                  <th style={thLeft}>{t('profiler.turns.prompt')}</th>
                  <th style={th}>{t('profiler.turns.tools')}</th>
                  <th style={th}>{t('profiler.turns.fresh')}</th>
                  <th style={th}>{t('profiler.turns.cache_w')}</th>
                  <th style={th}>{t('profiler.turns.cache_r')}</th>
                  <th style={th}>{t('profiler.turns.out')}</th>
                  <th style={th}>{t('profiler.turns.results')}</th>
                  <th style={th}>{t('profiler.turns.cost')}</th>
                  <th style={th}>{t('profiler.turns.share')}</th>
                </tr>
              </thead>
              <tbody>
                {profile.turnRows.map((r) => (
                  <tr key={r.turn}>
                    <td style={tdLeft}>{r.turn}</td>
                    <td style={tdLeft} title={r.prompt}>
                      {r.failed > 0 && <span style={{ color: '#f43f5e', marginRight: 6 }}>{r.failed}✗</span>}
                      {r.prompt}
                    </td>
                    <td style={td}>{r.toolCalls}</td>
                    <td style={td}>{formatTokens(r.usage.input)}</td>
                    <td style={td}>{formatTokens(r.usage.cacheWrite5m + r.usage.cacheWrite1h)}</td>
                    <td style={td}>{formatTokens(r.usage.cacheRead)}</td>
                    <td style={td}>{formatTokens(r.usage.output)}</td>
                    <td style={td}>{formatTokens(r.resultEstTokens)}</td>
                    <td style={td}>{formatCost(r.costUsd)}</td>
                    <td style={td}>{Math.round((r.costUsd / totalCost) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Phase breakdown */}
        <Section title={t('profiler.phases.title')} caption={t('profiler.phases.caption')}>
          <HorizontalBarChart
            data={profile.phases.map((p) => ({
              label: `${t(`profiler.phases.${p.phase}`)} (${p.toolCalls})`,
              value: p.resultEstTokens,
              color: PHASE_COLORS[p.phase] ?? '#8d836b',
              status: p.failed > 0 ? 'partial' : 'success',
            }))}
            formatY={(v) => `${formatTokens(v)} · ${Math.round((v / totalPhaseResult) * 100)}%`}
            valueWidth={110}
          />
        </Section>

        {/* Waste signals */}
        <Section title={t('profiler.waste.repeated_reads')} caption={t('profiler.waste.repeated_reads_caption')}>
          {profile.waste.repeatedReads.length === 0 ? (
            <div style={{ fontSize: 13, color: '#5e8b6a' }}>{t('profiler.waste.none_repeated')}</div>
          ) : (
            <WasteTable rows={profile.waste.repeatedReads} t={t} />
          )}
          {profile.waste.repeatedCommands.length > 0 && (
            <>
              <div className="section-label" style={{ margin: '16px 0 6px' }}>
                {t('profiler.waste.repeated_commands')}
              </div>
              <WasteTable rows={profile.waste.repeatedCommands} t={t} />
            </>
          )}
        </Section>

        <Section title={t('profiler.waste.top_title')} caption={t('profiler.waste.top_caption')}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>{t('profiler.waste.est_tokens')}</th>
                <th style={thLeft}>{t('profiler.phases.phase')}</th>
                <th style={thLeft}>{t('profiler.waste.tool_call')}</th>
                <th style={th}>{t('profiler.waste.turn')}</th>
              </tr>
            </thead>
            <tbody>
              {profile.waste.topResults.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td style={td}>{formatTokens(r.resultEstTokens)}</td>
                  <td style={{ ...tdLeft, color: PHASE_COLORS[r.phase] ?? '#8d836b' }}>
                    {t(`profiler.phases.${r.phase}`)}
                  </td>
                  <td style={tdLeft} title={r.label}>
                    {r.failed && <span style={{ color: '#f43f5e', marginRight: 6 }}>✗</span>}
                    {r.label}
                  </td>
                  <td style={td}>{r.turn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Compacts */}
        {profile.compacts.length > 0 && (
          <Section title={t('profiler.compacts.title')} caption={t('profiler.compacts.caption')}>
            {profile.compacts.map((k, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, color: '#0f0d0a', fontWeight: 600 }}>
                  {k.ts ? formatDateTime(k.ts) : '—'} · {k.trigger}
                  {!k.explicit && ` (${t('profiler.compacts.inferred')})`}
                  {k.preTokens != null && k.postTokens != null && (
                    <span style={{ color: '#8d836b', fontWeight: 400 }}>
                      {' '}
                      — {formatTokens(k.preTokens)} → {formatTokens(k.postTokens)}
                    </span>
                  )}
                </div>
                {k.reReadFiles.length > 0 ? (
                  <div style={{ fontSize: 12, color: '#8d836b', marginTop: 4 }}>
                    {t('profiler.compacts.re_read', { tokens: formatTokens(k.reReadEstTokens) })}
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {k.reReadFiles.slice(0, 8).map((f) => (
                        <li key={f.file} style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
                          {f.file} (~{formatTokens(f.reReadEstTokens)})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#5e8b6a', marginTop: 4 }}>
                    {t('profiler.compacts.none_re_read')}
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

        {/* Cache-expiry gaps */}
        {profile.expiryGaps.length > 0 && (
          <Section
            title={t('profiler.gaps.title')}
            caption={t('profiler.gaps.caption', { n: profile.expiryGaps.length, tokens: formatTokens(gapRewrite) })}
          >
            {profile.expiryGaps.slice(0, 10).map((gp, i) => (
              <div key={i} style={{ fontSize: 12, color: '#3f3a2d', padding: '4px 0' }}>
                {formatDateTime(gp.ts)} ·{' '}
                {t('profiler.gaps.line', {
                  gap: formatDuration(gp.gapMs),
                  tokens: formatTokens(gp.rewriteTokens),
                })}
              </div>
            ))}
          </Section>
        )}

        {/* Recommendations */}
        {profile.recommendations.length > 0 && (
          <Section title={t('profiler.recs.title')} caption={t('profiler.recs.caption')}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {profile.recommendations.map((r, i) => (
                <li key={i} style={{ fontSize: 13, color: '#3f3a2d', lineHeight: 1.6, marginBottom: 6 }}>
                  {typeof r === 'string' ? r : t(`profiler.recs.${r.id}`, r.params)}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <div style={{ fontSize: 11, color: '#bdb39c', marginTop: 8 }}>{t('profiler.est_note')}</div>
      </SessionDoc>
    </SessionShell>
  )
}
