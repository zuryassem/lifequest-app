import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LifeQuestApi, SessionInfo } from '../data/api'
import { DomainError, type Member, type Snapshot } from '../domain/types'
import { statsOf } from './selectors'
import { ERROR_FALLBACK } from './labels'

interface Toast {
  id: number
  kind: 'ok' | 'error'
  text: string
}

interface LevelUp {
  memberName: string
  level: number
  isActive: boolean
}

interface AppState {
  api: LifeQuestApi
  ready: boolean
  session: SessionInfo | null
  snap: Snapshot | null
  /** Perfil de la cuenta conectada (adulto administrador). */
  me: Member | null
  /** Perfil que está jugando ahora. Si es un niño, la interfaz se simplifica y se bloquea la administración. */
  active: Member | null
  childMode: boolean
  setActive(id: string): void
  refresh(): Promise<void>
  /** Ejecuta una operación, muestra el resultado y refresca. Devuelve false si falló. */
  run(op: () => Promise<unknown>, okMessage?: string): Promise<boolean>
  toasts: Toast[]
  levelUp: LevelUp | null
  dismissLevelUp(): void
  reduceMotion: boolean
  setReduceMotion(v: boolean): void
  signedOut(): void
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp fuera de AppProvider')
  return v
}

const safe = {
  get(store: Storage | undefined, k: string): string | null {
    try {
      return store?.getItem(k) ?? null
    } catch {
      return null
    }
  },
  set(store: Storage | undefined, k: string, v: string) {
    try {
      store?.setItem(k, v)
    } catch {
      /* almacenamiento no disponible: la app sigue funcionando sin recordar este detalle */
    }
  },
}

export function AppProvider({ api, children }: { api: LifeQuestApi; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [activeId, setActiveId] = useState<string | null>(() => safe.get(globalThis.sessionStorage, 'lq.active'))
  const [toasts, setToasts] = useState<Toast[]>([])
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null)
  const [reduceMotion, setReduceMotionState] = useState(() => safe.get(globalThis.localStorage, 'lq.reduceMotion') === '1')
  const toastId = useRef(0)

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduceMotion)
  }, [reduceMotion])

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200)
  }, [])

  /** Compara niveles con los últimos vistos para celebrar una subida (§116). */
  const detectLevelUps = useCallback((s: Snapshot, activeMemberId: string | null) => {
    for (const m of s.members.filter((x) => x.playsGame)) {
      const level = statsOf(s, m.id).level
      const key = `lq.seenLevel.${m.id}`
      const seen = Number(safe.get(globalThis.localStorage, key))
      safe.set(globalThis.localStorage, key, String(level))
      if (seen && level > seen) {
        const isActive = m.id === activeMemberId
        setLevelUp((prev) => (prev && prev.isActive ? prev : { memberName: m.name, level, isActive }))
      }
    }
  }, [])

  const load = useCallback(async () => {
    const sess = await api.getSession()
    setSession(sess)
    if (!sess) {
      setSnap(null)
      return
    }
    const s = await api.getSnapshot()
    setSnap(s)
    if (s) {
      const mine = s.members.find((m) => m.accountId === sess.accountId)
      const stored = safe.get(globalThis.sessionStorage, 'lq.active')
      const valid = s.members.find((m) => m.id === stored && m.playsGame)
      const next = valid?.id ?? (mine?.playsGame ? mine.id : mine?.id ?? null)
      setActiveId(next)
      detectLevelUps(s, next)
    }
  }, [api, detectLevelUps])

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setReady(true))
  }, [load])

  // Otra pestaña modificó los datos locales → sincroniza.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('lifequest.local.')) load().catch(() => {})
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [load])

  const run = useCallback(
    async (op: () => Promise<unknown>, okMessage?: string) => {
      try {
        await op()
        await load()
        if (okMessage) pushToast('ok', okMessage)
        return true
      } catch (e) {
        pushToast('error', e instanceof DomainError ? e.message : e instanceof Error && e.message ? e.message : ERROR_FALLBACK)
        return false
      }
    },
    [load, pushToast],
  )

  const value = useMemo<AppState>(() => {
    const me = snap?.members.find((m) => m.accountId === session?.accountId) ?? null
    const active = snap?.members.find((m) => m.id === activeId) ?? me
    return {
      api,
      ready,
      session,
      snap,
      me,
      active,
      childMode: active?.role === 'child',
      setActive: (id) => {
        safe.set(globalThis.sessionStorage, 'lq.active', id)
        setActiveId(id)
      },
      refresh: load,
      run,
      toasts,
      levelUp,
      dismissLevelUp: () => setLevelUp(null),
      reduceMotion,
      setReduceMotion: (v) => {
        safe.set(globalThis.localStorage, 'lq.reduceMotion', v ? '1' : '0')
        setReduceMotionState(v)
      },
      signedOut: () => {
        try {
          globalThis.sessionStorage?.removeItem('lq.active')
        } catch {
          /* sin almacenamiento */
        }
        setSession(null)
        setSnap(null)
        setActiveId(null)
      },
    }
  }, [api, ready, session, snap, activeId, load, run, toasts, levelUp, reduceMotion])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
