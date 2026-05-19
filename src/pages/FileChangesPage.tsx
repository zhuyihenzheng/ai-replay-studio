import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, FileText, Plus, Minus } from 'lucide-react'
import { useAppStore } from '@/store'
import { SessionShell, SessionDoc } from '@/components/SessionShell'
import { EmptyState } from '@/components/EmptyState'
import { useT } from '@/i18n'
import type { FileChange } from '@/types'

const langColors: Record<string, { bg: string; color: string }> = {
  typescript: { bg: '#eff6ff', color: '#1d4ed8' },
  javascript: { bg: '#fffbeb', color: '#92400e' },
  sql: { bg: '#ecfdf5', color: '#065f46' },
  markdown: { bg: '#f5f3ff', color: '#6d28d9' },
}

export function FileChangesPage() {
  const t = useT()
  const { id = '' } = useParams()
  const session = useAppStore((s) => s.getSession(id))

  if (!session) return <EmptyState title={t('session.not_found')} />

  const totalAdded = session.files.reduce((a, f) => a + f.additions, 0)
  const totalDeleted = session.files.reduce((a, f) => a + f.deletions, 0)

  return (
    <SessionShell session={session}>
      <SessionDoc>
        {session.files.length === 0 ? (
          <EmptyState title={t('files.no_changes')} description={t('files.no_changes_desc')} />
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginBottom: 20,
                fontSize: 13,
                color: '#5e5644',
              }}
            >
              <span>
                {t(
                  session.files.length === 1 ? 'files.changed_count' : 'files.changed_count_plural',
                  { n: session.files.length },
                )}
              </span>
              <span style={{ color: '#065f46', fontWeight: 600 }}>+{totalAdded}</span>
              <span style={{ color: '#9f1239', fontWeight: 600 }}>−{totalDeleted}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {session.files.map((f, i) => (
                <FileCard key={f.id} file={f} defaultOpen={i === 0} />
              ))}
            </div>
          </>
        )}
      </SessionDoc>
    </SessionShell>
  )
}

function FileCard({
  file,
  defaultOpen = false,
}: {
  file: FileChange
  defaultOpen?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)
  const lc = langColors[file.language ?? ''] ?? { bg: '#f8f7f4', color: '#5e5644' }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: 'white',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        {open ? (
          <ChevronDown size={13} style={{ color: '#8d836b', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={13} style={{ color: '#8d836b', flexShrink: 0 }} />
        )}
        <FileText size={14} style={{ color: '#8d836b', flexShrink: 0 }} />
        <code
          style={{
            fontSize: 12,
            fontFamily: '"JetBrains Mono", monospace',
            color: '#1a1814',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.path}
        </code>
        {file.language && (
          <span
            style={{
              ...lc,
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 9999,
            }}
          >
            {file.language}
          </span>
        )}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 11,
            color: '#065f46',
            fontWeight: 600,
            marginLeft: 4,
          }}
        >
          <Plus size={10} />
          {file.additions}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 11,
            color: '#9f1239',
            fontWeight: 600,
          }}
        >
          <Minus size={10} />
          {file.deletions}
        </span>
      </button>

      <div
        style={{
          padding: '8px 16px 10px 44px',
          fontSize: 12,
          color: '#8d836b',
          lineHeight: 1.5,
          borderTop: '1px solid #efece5',
        }}
      >
        {file.summary}
      </div>

      {open && file.diff && (
        <div
          style={{
            borderTop: '1px solid #efece5',
            overflowX: 'auto',
            background: '#fafaf8',
          }}
        >
          <pre
            style={{
              fontSize: 12,
              fontFamily: '"JetBrains Mono", monospace',
              lineHeight: 1.7,
              padding: '12px 0',
              margin: 0,
            }}
          >
            {file.diff.split('\n').map((line, i) => {
              const cls = line.startsWith('+')
                ? 'diff-add'
                : line.startsWith('-')
                ? 'diff-del'
                : line.startsWith('@@')
                ? 'diff-hunk'
                : ''
              return (
                <div key={i} className={cls} style={{ padding: '0 16px', display: 'block' }}>
                  {line || ' '}
                </div>
              )
            })}
          </pre>
        </div>
      )}
      {open && !file.diff && (
        <div
          style={{
            padding: '12px 16px',
            fontSize: 12,
            color: '#bdb39c',
            borderTop: '1px solid #efece5',
          }}
        >
          {t('files.diff_unavailable')}
        </div>
      )}
    </div>
  )
}
