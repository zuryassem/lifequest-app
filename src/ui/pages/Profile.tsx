import { useState } from 'react'
import { Link } from 'react-router-dom'
import { catalogItem } from '../../domain/catalog'
import { CATEGORIES } from '../../domain/types'
import { AvatarView, Button, Card, Chip, Coin, Empty, Field, Heading, Modal, Xp, inputCls } from '../components'
import { CATEGORY_INFO } from '../labels'
import { fmtDate, statsOf } from '../selectors'
import { useApp } from '../store'

export function ProfilePage() {
  const { snap, active, me, api, run, signedOut, reduceMotion, setReduceMotion, childMode } = useApp()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')
  if (!snap || !active || !me) return null
  const s = active.playsGame ? statsOf(snap, active.id) : null

  const done = snap.completions.filter((c) => c.memberId === active.id && c.status === 'approved')
  const byCategory = CATEGORIES.map((cat) => ({
    cat,
    n: done.filter((c) => snap.missions.find((m) => m.id === c.missionId)?.category === cat).length,
  }))
  const maxN = Math.max(1, ...byCategory.map((x) => x.n))
  const inventory = snap.inventory.filter((i) => i.memberId === active.id)
  const history = snap.ledger.filter((e) => e.memberId === active.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)

  function exportData() {
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lifequest-${snap!.family.code}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Heading>Perfil</Heading>

      {s && (
        <>
          <Card glow="violet">
            <div className="flex items-center gap-4">
              <AvatarView avatar={active.avatar} size={110} name={active.name} />
              <div className="flex-1">
                <p className="text-xs uppercase tracking-widest text-neon-violet">{active.avatar.title ?? 'Aprendiz'}</p>
                <h2 className="font-display text-2xl font-extrabold">{active.name}</h2>
                <p className="mt-1 text-sm">
                  Nivel {s.level} · <Xp amount={s.xp} /> · <Coin amount={s.available} />
                </p>
                <Link to="/character">
                  <Button tone="ghost" small className="mt-2">
                    Editar personaje
                  </Button>
                </Link>
              </div>
            </div>
          </Card>

          <h2 className="mb-2 mt-6 font-display text-sm font-bold uppercase tracking-widest text-slate-400">Actividad por categoría</h2>
          <Card>
            <p className="mb-3 text-sm text-slate-400">{done.length} misiones completadas. Estas cifras reflejan lo que has hecho en el juego, no tu valor como persona.</p>
            <ul className="grid gap-2">
              {byCategory.map(({ cat, n }) => (
                <li key={cat} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0">
                    {CATEGORY_INFO[cat].icon} {CATEGORY_INFO[cat].label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/40">
                    <div className="h-full rounded-full" style={{ width: `${(n / maxN) * 100}%`, background: CATEGORY_INFO[cat].color }} />
                  </div>
                  <span className="w-6 text-right tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </Card>

          <h2 className="mb-2 mt-6 font-display text-sm font-bold uppercase tracking-widest text-slate-400">Inventario</h2>
          <Card>
            <div className="flex flex-wrap gap-2">
              {inventory.map((inv) => {
                const item = catalogItem(inv.itemId)
                if (!item) return null
                return (
                  <button
                    key={inv.itemId}
                    type="button"
                    aria-pressed={inv.equipped}
                    onClick={() => run(() => api.equipItem({ actorId: active.id, memberId: active.id, itemId: item.id }))}
                    className={`rounded-xl border px-3 py-1.5 text-sm ${inv.equipped ? 'border-neon-lime bg-neon-lime/15 text-neon-lime' : 'border-white/15 text-slate-300'}`}
                  >
                    {item.slot === 'accessory' ? item.value : ''} {item.name}
                    {inv.equipped && ' ✓'}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">Toca un objeto para equiparlo o quitarlo.</p>
          </Card>

          <h2 className="mb-2 mt-6 font-display text-sm font-bold uppercase tracking-widest text-slate-400">Historial de XP y LIFECOINS</h2>
          <Card>
            {history.length === 0 ? (
              <Empty icon="📒">Todavía no hay movimientos.</Empty>
            ) : (
              <ul className="divide-y divide-white/5 text-sm">
                {history.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <div>{e.reason}</div>
                      <div className="text-xs text-slate-500">{fmtDate(e.createdAt)}</div>
                    </div>
                    <div className="flex gap-2 tabular-nums">
                      {e.xp !== 0 && <Chip color="#22d3ee">{e.xp > 0 ? '+' : ''}{e.xp} XP</Chip>}
                      {e.coins !== 0 && <Chip color="#fbbf24">{e.coins > 0 ? '+' : ''}{e.coins} 🪙</Chip>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <h2 className="mb-2 mt-6 font-display text-sm font-bold uppercase tracking-widest text-slate-400">Ajustes</h2>
      <Card>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} />
          Reducir animaciones (accesibilidad)
        </label>
        {!childMode && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button tone="ghost" small onClick={exportData}>
              Exportar datos de mi familia (JSON)
            </Button>
            <Button tone="danger" small onClick={() => setConfirmDelete(true)}>
              Eliminar mi cuenta
            </Button>
          </div>
        )}
        <div className="mt-4">
          <Button
            tone="ghost"
            small
            onClick={async () => {
              await api.signOut()
              signedOut()
            }}
          >
            Cerrar sesión
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">Sesión: {snap.account.email}</p>
      </Card>

      {confirmDelete && (
        <Modal title="Eliminar cuenta" onClose={() => setConfirmDelete(false)}>
          <p className="mb-3 text-sm text-slate-300">
            {snap.members.filter((m) => m.role === 'guardian').length > 1
              ? 'Tu perfil y tu progreso se borrarán. La familia seguirá con el otro adulto.'
              : 'Se borrará tu cuenta, tu familia, los perfiles de tus hijos y todo su progreso. No se puede deshacer.'}
          </p>
          <Field label="Escribe ELIMINAR para confirmar">{(id) => <input id={id} className={inputCls} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
          <Button
            tone="danger"
            className="w-full"
            disabled={typed !== 'ELIMINAR'}
            onClick={async () => {
              const ok = await run(() => api.deleteAccount())
              if (ok) signedOut()
            }}
          >
            Eliminar definitivamente
          </Button>
        </Modal>
      )}
    </div>
  )
}
