import type { CSSProperties, ReactNode } from 'react'
import { SessionHeader } from './SessionHeader'
import { SessionTabs } from './SessionTabs'
import type { Session } from '@/types'

// Single source of truth for the session tab "display area" so every tab
// (Replay / Trace / Cost / Files / Artifacts / Client Report) frames its
// content identically: fixed header + tabs, one canvas, one max-width,
// one set of gutters, one scroll region.
export const SESSION_MAX_WIDTH = 1080
export const SESSION_CANVAS = '#f8f7f4'
export const SESSION_GUTTER = 28

/**
 * Header + tabs (always fixed) over a flex body on the shared canvas.
 * Children own the body; wrap them in <SessionDoc> for the standard
 * centered, scrolling column, or render a custom body (Trace) directly.
 */
export function SessionShell({
  session,
  children,
}: {
  session: Session
  children: ReactNode
}) {
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <SessionHeader session={session} />
      <SessionTabs sessionId={session.id} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: SESSION_CANVAS,
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** The standard scrolling, centered, max-width content column. */
export function SessionDoc({
  children,
  padding = `${SESSION_GUTTER}px ${SESSION_GUTTER}px 56px`,
  style,
}: {
  children: ReactNode
  padding?: string
  style?: CSSProperties
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div
        style={{
          maxWidth: SESSION_MAX_WIDTH,
          margin: '0 auto',
          width: '100%',
          padding,
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  )
}
