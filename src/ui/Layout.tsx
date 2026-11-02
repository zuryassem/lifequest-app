import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button, Field, Modal, inputCls } from './components'
import { AvatarView } from './components'
import { pendingCounts, playersOf } from './selectors'
import { useApp } from './store'
import { LocalNotice } from './pages/Auth'

export function Layout() {
  const { snap, active, me, childMode, api, setActive } = useApp()
  const nav = useNavigate()
  const [switching, setSwitching] = useState(false)
  const [pinFor, setPinFor] = useState(false)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  if (!snap || !active || !me) return null

  const counts = pendingCounts(snap)
  const reviewBadge = counts.completions + counts.redemptions + counts.missionProposals + counts.rewardProposals
  const players = playersOf(snap)
  const canSwitch = snap.family.kind === 'family' && (players.length > 1 || (players.length === 1 && players[0].id !== me.id))

  const links = [
    { to: '/', label: 'Aventura', icon: '🏠', end: true },
    { to: '/missions', label: 'Misiones', icon: '🎯' },
    { to: '/shop', label: 'Tienda', icon: '🛒' },
    ...(!childMode && snap.family.kind === 'family' ? [{ to: '/family', label: 'Familia', icon: '👪', badge: reviewBadge }] : []),
    { to: '/profile', label: 'Perfil', icon: '👤' },
  ]

  async function backToAdult() {
    if (me!.pinHash) {
      setPinFor(true)
      return
    }
    setActive(me!.id)
    setSwitching(false)
  }

  async function submitPin() {
    const ok = await api.verifyPin({ actorId: me!.id, pin })
    if (ok) {
      setActive(me!.id)
      setPinFor(false)
      setSwitching(false)
      setPin('')
      setPinError('')
      nav('/')
    } else {
      setPinError('PIN incorrecto')
    }
  }

  return (
    <div className="min-h-screen pb-24 md:pb-0 md:pl-56">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-white/10 bg-ink-900/80 p-4 backdrop-blur md:flex">
        <div className="mb-6 font-display text-xl font-extrabold uppercase tracking-[0.2em] text-neon-cyan drop-shadow-[0_0_10px_var(--color-neon-cyan)]">LifeQuest</div>
        <nav className="flex flex-col gap-1">
          {links.map((l) => (
            <NavItem key={l.to} {...l} />
          ))}
        </nav>
        <div className="mt-auto text-xs text-slate-500">{snap.family.kind === 'family' ? snap.family.name : 'Aventura individual'}</div>
      </aside>

      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-ink-950/80 px-4 py-2 backdrop-blur">
        <div className="font-display text-lg font-extrabold uppercase tracking-[0.2em] text-neon-cyan md:hidden">LifeQuest</div>
        <div className="hidden text-sm text-slate-400 md:block">{childMode ? '🧒 Modo niño' : active.playsGame ? 'Modo jugador' : 'Modo administración'}</div>
        <button type="button" onClick={() => setSwitching(true)} disabled={!canSwitch && !childMode} className="flex items-center gap-2 rounded-full border border-white/15 py-1 pl-1 pr-3 text-sm hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent" aria-label="Cambiar de jugador">
          <AvatarView avatar={active.avatar} size={30} name={active.name} />
          <span className="max-w-28 truncate">{active.name}</span>
          {(canSwitch || childMode) && <span aria-hidden>⇄</span>}
        </button>
      </header>

      {api.mode === 'local' && (
        <div className="mx-auto max-w-3xl px-4 pt-3">
          <LocalNotice compact />
        </div>
      )}

      <main>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-white/10 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Navegación principal">
        {links.map((l) => (
          <NavItem key={l.to} {...l} compact />
        ))}
      </nav>

      {switching && (
        <Modal title="¿Quién juega?" onClose={() => { setSwitching(false); setPinFor(false) }}>
          {!pinFor ? (
            <div className="grid gap-2">
              {players.map((p) => (
                <button key={p.id} type="button" onClick={() => { if (p.id === me.id) { backToAdult() } else { setActive(p.id); setSwitching(false); nav('/') } }} className={`flex items-center gap-3 rounded-xl border p-3 text-left ${p.id === active.id ? 'border-neon-cyan bg-neon-cyan/10' : 'border-white/10 hover:bg-white/5'}`}>
                  <AvatarView avatar={p.avatar} size={44} name={p.name} />
                  <span className="font-semibold">{p.name}</span>
                  {p.id === me.id && <span className="text-xs text-slate-500">(adulto)</span>}
                </button>
              ))}
              {!me.playsGame && childMode && (
                <button type="button" onClick={backToAdult} className="rounded-xl border border-neon-violet/50 p-3 text-left hover:bg-neon-violet/10">
                  🔒 Volver al modo administración
                </button>
              )}
              {childMode && !me.pinHash && <p className="text-xs text-slate-500">Consejo: define un PIN en Familia → Ajustes para que los niños no puedan volver al modo adulto.</p>}
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); submitPin() }}>
              <Field label="PIN de adulto">{(id) => <input id={id} autoFocus inputMode="numeric" type="password" maxLength={8} className={inputCls} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}</Field>
              {pinError && <p role="alert" className="mb-2 text-sm text-red-300">{pinError}</p>}
              <Button type="submit" className="w-full" disabled={pin.length < 4}>
                Entrar
              </Button>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}

function NavItem({ to, label, icon, end, badge, compact }: { to: string; label: string; icon: string; end?: boolean; badge?: number; compact?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        compact
          ? `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'text-neon-cyan' : 'text-slate-400'}`
          : `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${isActive ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-slate-300 hover:bg-white/5'}`
      }
    >
      <span className={compact ? 'text-xl' : 'text-lg'} aria-hidden>
        {icon}
      </span>
      {label}
      {!!badge && <span className={`rounded-full bg-neon-pink px-1.5 text-xs text-ink-950 ${compact ? 'absolute right-1/4 top-1' : 'ml-auto'}`}>{badge}</span>}
    </NavLink>
  )
}
