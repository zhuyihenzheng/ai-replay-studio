import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Code2,
  Database,
  TerminalSquare,
  FileText,
  Lightbulb,
  MessageSquareQuote,
  Star,
  Copy,
  Download,
  Tag,
  Check,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { SessionShell, SessionDoc } from '@/components/SessionShell'
import { EmptyState } from '@/components/EmptyState'
import { useT } from '@/i18n'
import type { Artifact, ArtifactKind } from '@/types'

const ARTIFACT_META: Record<
  ArtifactKind,
  { labelKey: string; icon: typeof Code2; chip: { background: string; color: string } }
> = {
  code: { labelKey: 'artifacts.kind.code', icon: Code2, chip: { background: '#f5f3ff', color: '#6d28d9' } },
  sql: { labelKey: 'artifacts.kind.sql', icon: Database, chip: { background: '#eff6ff', color: '#1d4ed8' } },
  command: {
    labelKey: 'artifacts.kind.command',
    icon: TerminalSquare,
    chip: { background: '#f8f7f4', color: '#5e5644' },
  },
  markdown: { labelKey: 'artifacts.kind.markdown', icon: FileText, chip: { background: '#ecfdf5', color: '#065f46' } },
  decision: { labelKey: 'artifacts.kind.decision', icon: Lightbulb, chip: { background: '#fffbeb', color: '#92400e' } },
  'final-answer': {
    labelKey: 'artifacts.kind.final_answer',
    icon: MessageSquareQuote,
    chip: { background: '#fef6ee', color: '#b25515' },
  },
}

export function ArtifactsPage() {
  const t = useT()
  const { id = '' } = useParams()
  const session = useAppStore((s) => s.getSession(id))
  const [filterKind, setFilterKind] = useState<ArtifactKind | 'all'>('all')

  if (!session) return <EmptyState title={t('session.not_found')} />

  const presentKinds = Array.from(new Set(session.artifacts.map((a) => a.kind))) as ArtifactKind[]
  const kindOptions: (ArtifactKind | 'all')[] = ['all', ...presentKinds]

  const filtered =
    filterKind === 'all' ? session.artifacts : session.artifacts.filter((a) => a.kind === filterKind)

  return (
    <SessionShell session={session}>
      <SessionDoc>
        {session.artifacts.length === 0 ? (
          <EmptyState
            title={t('artifacts.no_artifacts')}
            description={t('artifacts.no_artifacts_desc')}
          />
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 20,
                flexWrap: 'wrap',
              }}
            >
              {kindOptions.map((k) => {
                const meta = k !== 'all' ? ARTIFACT_META[k] : null
                const active = filterKind === k
                const Icon = meta?.icon
                return (
                  <button
                    key={k}
                    onClick={() => setFilterKind(k)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      borderRadius: 9999,
                      border: '1px solid',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      borderColor: active ? '#1a1814' : '#dcd6c8',
                      background: active ? '#1a1814' : 'white',
                      color: active ? 'white' : '#5e5644',
                      transition: 'all 0.12s',
                    }}
                  >
                    {Icon && <Icon size={11} />}
                    {k === 'all' ? t('artifacts.all') : t(ARTIFACT_META[k].labelKey)}
                  </button>
                )
              })}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8d836b' }}>
                {t(filtered.length === 1 ? 'artifacts.item_count' : 'artifacts.item_count_plural', {
                  n: filtered.length,
                })}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtered.map((a) => (
                <ArtifactCard key={a.id} artifact={a} />
              ))}
            </div>
          </>
        )}
      </SessionDoc>
    </SessionShell>
  )
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [favorite, setFavorite] = useState(!!artifact.favorite)
  const meta = ARTIFACT_META[artifact.kind] ?? ARTIFACT_META.markdown
  const Icon = meta.icon
  const isCode = artifact.kind === 'code' || artifact.kind === 'sql' || artifact.kind === 'command'

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(artifact.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }

  function onExport() {
    const blob = new Blob([artifact.body], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${artifact.title.replace(/\s+/g, '_').toLowerCase()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                ...meta.chip,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 9999,
              }}
            >
              <Icon size={11} />
              {t(meta.labelKey)}
            </span>
            {artifact.tags.map((t) => (
              <span
                key={t}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 9999,
                  background: '#f8f7f4',
                  color: '#5e5644',
                  border: '1px solid #efece5',
                }}
              >
                <Tag size={9} /> {t}
              </span>
            ))}
          </div>
          <h3
            style={{
              fontFamily: '"Source Serif 4", serif',
              fontSize: 17,
              fontWeight: 600,
              color: '#0f0d0a',
              lineHeight: 1.3,
            }}
          >
            {artifact.title}
          </h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            className="btn-ghost"
            onClick={() => setFavorite((f) => !f)}
            title={t('artifacts.favorite')}
            style={{ color: favorite ? '#d97706' : '#8d836b' }}
          >
            <Star
              size={14}
              fill={favorite ? '#fbbf24' : 'none'}
              stroke={favorite ? '#d97706' : 'currentColor'}
            />
          </button>
          <button className="btn" onClick={onCopy} title={t('artifacts.copy')}>
            {copied ? (
              <Check size={13} style={{ color: '#10b981' }} />
            ) : (
              <Copy size={13} />
            )}
            {copied ? t('artifacts.copied') : t('artifacts.copy')}
          </button>
          <button className="btn" onClick={onExport} title={t('artifacts.export')}>
            <Download size={13} />
          </button>
        </div>
      </div>

      {isCode ? (
        <pre
          style={{
            fontSize: 12,
            fontFamily: '"JetBrains Mono", monospace',
            background: '#f8f7f4',
            border: '1px solid #efece5',
            borderRadius: 8,
            padding: '12px 14px',
            overflowX: 'auto',
            lineHeight: 1.6,
            color: '#2a2620',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {artifact.body}
        </pre>
      ) : (
        <div
          style={{
            fontSize: 13,
            color: '#3f3a2d',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
          }}
        >
          {artifact.body}
        </div>
      )}
    </div>
  )
}
