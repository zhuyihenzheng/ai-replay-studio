import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { LayoutDashboard, Sparkles, Settings } from 'lucide-react'
import { useAppStore } from '@/store'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useT } from '@/i18n'
import type { SessionStatus } from '@/types'

const navItems = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
]

const statusDotColor: Record<SessionStatus, string> = {
  success: '#10b981',
  partial: '#f59e0b',
  failed: '#f43f5e',
  running: '#3b82f6',
}

export function Layout() {
  const t = useT()
  const sessions = useAppStore((s) => s.sessions)
  const navigate = useNavigate()
  const params = useParams()
  const location = useLocation()
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recentSessions = sessions.filter((s) => s.startedAt >= weekAgo)
  const activeSessionId = params.id ?? null
  const onDashboard = location.pathname === '/'

  return (
    <div className="h-full flex">
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: '1px solid #efece5',
          background: 'white',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #efece5' }}>
          <div className="flex items-center gap-2.5">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#b25515',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
              }}
            >
              <Sparkles size={15} />
            </div>
            <div>
              <div
                style={{
                  fontFamily: '"Source Serif 4", serif',
                  fontWeight: 600,
                  fontSize: 14,
                  color: '#0f0d0a',
                  lineHeight: 1.2,
                }}
              >
                AI Replay
              </div>
              <div style={{ fontSize: 10, color: '#bdb39c', letterSpacing: '0.04em' }}>
                Studio · preview
              </div>
            </div>
          </div>
        </div>

        <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto' }}>
          {navItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '7px 10px',
                marginBottom: 2,
                borderRadius: 8,
                border: 'none',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                background: isActive ? '#f8f7f4' : 'transparent',
                color: isActive ? '#0f0d0a' : '#5e5644',
                transition: 'all 0.12s',
                textDecoration: 'none',
              })}
            >
              <it.icon size={14} />
              {t(it.labelKey)}
            </NavLink>
          ))}

          <div style={{ marginTop: 16, marginBottom: 6, padding: '0 10px' }}>
            <div className="section-label" style={{ fontSize: 10 }}>
              {t('nav.recent_sessions')}
            </div>
          </div>
          {recentSessions.map((s) => {
            const active = activeSessionId === s.id && !onDashboard
            return (
              <button
                key={s.id}
                onClick={() => navigate(`/sessions/${s.id}`)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 7,
                  width: '100%',
                  padding: '6px 10px',
                  marginBottom: 1,
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? '#f8f7f4' : 'transparent',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'background 0.12s',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: statusDotColor[s.status],
                    flexShrink: 0,
                    marginTop: 5,
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    lineHeight: 1.4,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    color: active ? '#0f0d0a' : '#5e5644',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {s.title}
                </span>
              </button>
            )
          })}
        </nav>

        <div style={{ padding: '8px 8px 16px', borderTop: '1px solid #efece5' }}>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              color: '#8d836b',
              background: 'transparent',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f7f4')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Settings size={14} />
            {t('nav.settings')}
          </button>

          <LanguageSwitcher />

          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: '#fef6ee',
              border: '1px solid #fde9d3',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#b25515',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              {t('nav.local_first_title')}
            </div>
            <div style={{ fontSize: 11, color: '#8d836b', lineHeight: 1.4 }}>
              {t('nav.local_first_desc')}
            </div>
          </div>
        </div>
      </aside>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Outlet />
      </main>
    </div>
  )
}
