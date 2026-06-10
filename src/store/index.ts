import { create } from 'zustand'
import type { Session, TokenProfile } from '@/types'
import { mockSessions } from '@/data/mockSessions'
import claudeSessionsStub from '@/data/claudeSessions.json'
import tokenProfilesStub from '@/data/tokenProfiles.json'

// Source resolution order:
//   1. If VITE_FORCE_DEMO is set, always use the bundled demo dataset.
//      Used by the screenshot script so captures never include real local
//      transcripts.
//   2. In dev, prefer the local sync output (gitignored, may not exist).
//   3. Fall back to the tracked stub (`[]`).
//   4. Fall back to the bundled demo dataset.
//
// Why DEV-only for the local glob: `import.meta.glob({ eager: true })` is
// resolved at build time, so including it unconditionally would bundle
// `claudeSessions.local.json` into `dist/` whenever a user runs
// `npm run build` after `npm run sync`. That would silently leak real
// transcripts through any production deployment of the dashboard.
// Vite statically replaces `import.meta.env.DEV`, so the production
// branch tree-shakes the glob away entirely.
const forceDemo = import.meta.env.VITE_FORCE_DEMO === '1'
const useLocalSync = import.meta.env.DEV && !forceDemo

const localModules = useLocalSync
  ? import.meta.glob<{ default: Session[] }>(
      '@/data/claudeSessions.local.json',
      { eager: true },
    )
  : {}
const localSessions = (Object.values(localModules)[0]?.default ?? []) as Session[]
const stubSessions = (claudeSessionsStub as unknown as Session[]) ?? []

const realSessions = forceDemo
  ? []
  : localSessions.length > 0
    ? localSessions
    : stubSessions
const rawSessions: Session[] = realSessions.length > 0 ? realSessions : mockSessions
// Sort by most recent activity (endedAt = last tool call end). A session may
// have been created long ago but still be active, so creation time is wrong.
const initialSessions: Session[] = [...rawSessions].sort((a, b) => b.endedAt - a.endedAt)

// Token profiles (scripts/token-profiler.mjs --export) follow the same
// privacy rules as sessions: DEV-only glob for the gitignored local file,
// tracked stub stays `[]` so builds never bundle real prompts/paths.
const localProfileModules = useLocalSync
  ? import.meta.glob<{ default: TokenProfile[] }>(
      '@/data/tokenProfiles.local.json',
      { eager: true },
    )
  : {}
const localProfiles = (Object.values(localProfileModules)[0]?.default ?? []) as TokenProfile[]
const initialProfiles: TokenProfile[] = forceDemo
  ? []
  : localProfiles.length > 0
    ? localProfiles
    : ((tokenProfilesStub as unknown as TokenProfile[]) ?? [])

interface AppState {
  sessions: Session[]
  profiles: TokenProfile[]
  usingMockData: boolean
  getSession: (id: string) => Session | undefined
  getProfile: (sessionId: string) => TokenProfile | undefined
}

export const useAppStore = create<AppState>((_set, get) => ({
  sessions: initialSessions,
  profiles: initialProfiles,
  usingMockData: realSessions.length === 0,
  getSession: (id) => get().sessions.find((s) => s.id === id),
  getProfile: (sessionId) => get().profiles.find((p) => p.sessionId === sessionId),
}))
