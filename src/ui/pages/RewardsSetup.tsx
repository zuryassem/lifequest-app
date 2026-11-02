import { useState } from 'react'
import { MIN_INITIAL_REWARDS, REWARD_TEMPLATES } from '../../domain/rewardTemplates'
import { Bar, Button, Card, Field, inputCls } from '../components'
import { useApp } from '../store'

interface Row {
  key: string
  name: string
  description: string
  conditions: string
  price: string
  checked: boolean
  custom: boolean
}

/**
 * Primer paso obligatorio de la familia: elegir al menos MIN_INITIAL_REWARDS recompensas.
 * Algunas pueden ser gratis (precio 0) y se pueden añadir tantas como se quiera.
 */
export function RewardsSetupPage() {
  const { api, run, me, signedOut } = useApp()
  const [rows, setRows] = useState<Row[]>(() =>
    REWARD_TEMPLATES.map((t) => ({ key: t.id, name: t.name, description: t.description, conditions: t.conditions, price: String(t.price), checked: false, custom: false })),
  )
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('50')
  const [busy, setBusy] = useState(false)
  if (!me) return null

  const chosen = rows.filter((r) => r.checked)
  const validPrice = (p: string) => /^\d+$/.test(p.trim()) && Number(p) <= 100000
  const invalid = chosen.filter((r) => !r.name.trim() || !validPrice(r.price))
  const ready = chosen.length >= MIN_INITIAL_REWARDS && invalid.length === 0

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  function addCustom() {
    const name = newName.trim()
    if (!name || !validPrice(newPrice)) return
    if (rows.some((r) => r.name.trim().toLowerCase() === name.toLowerCase())) return
    setRows((rs) => [...rs, { key: `c-${Date.now()}`, name, description: '', conditions: '', price: newPrice, checked: true, custom: true }])
    setNewName('')
  }

  async function submit() {
    setBusy(true)
    await run(
      () =>
        api.setupRewards({
          actorId: me!.id,
          rewards: chosen.map((r) => ({ name: r.name.trim(), description: r.description, conditions: r.conditions, price: Number(r.price) })),
        }),
      '¡Recompensas listas!',
    )
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-[0.12em]">Elige tus recompensas</h1>
      <p className="mt-2 text-slate-300">
        Antes de empezar, elige al menos <strong>{MIN_INITIAL_REWARDS}</strong> recompensas que se podrán canjear con LIFECOINS. Algunas pueden ser <strong>gratis</strong> (precio 0) y puedes poner más de {MIN_INITIAL_REWARDS}. Cada una se puede canjear todas las veces que quieran, mientras haya monedas suficientes.
      </p>

      <Card glow="violet" className="sticky top-2 z-10 mt-4">
        <div className="mb-1 flex justify-between text-sm">
          <span>
            <strong>{chosen.length}</strong> de {MIN_INITIAL_REWARDS} elegidas{chosen.length > MIN_INITIAL_REWARDS && ` (+${chosen.length - MIN_INITIAL_REWARDS} extra)`}
          </span>
          <button
            type="button"
            className="text-neon-cyan underline"
            onClick={() => setRows((rs) => rs.map((r, i) => (!r.custom && i < MIN_INITIAL_REWARDS ? { ...r, checked: true } : r)))}
          >
            Marcar {MIN_INITIAL_REWARDS} sugeridas
          </button>
        </div>
        <Bar ratio={Math.min(1, chosen.length / MIN_INITIAL_REWARDS)} color="var(--color-neon-lime)" label="Recompensas elegidas" />
      </Card>

      <ul className="mt-4 grid gap-2">
        {rows.map((r) => (
          <li key={r.key} className={`flex items-center gap-3 rounded-xl border p-3 ${r.checked ? 'border-neon-cyan/60 bg-neon-cyan/10' : 'border-white/10 bg-ink-800/60'}`}>
            <input id={`rw-${r.key}`} type="checkbox" checked={r.checked} onChange={(e) => update(r.key, { checked: e.target.checked })} className="size-5 shrink-0" />
            <label htmlFor={`rw-${r.key}`} className="min-w-0 flex-1 cursor-pointer">
              <div className="truncate font-medium">{r.name}</div>
              {r.conditions && <div className="truncate text-xs text-slate-500">{r.conditions}</div>}
            </label>
            <label className="flex shrink-0 items-center gap-1 text-sm">
              <span className="sr-only">Precio de {r.name}</span>
              <input
                inputMode="numeric"
                className={`${inputCls} !w-20 !py-1.5 text-right ${r.checked && !validPrice(r.price) ? '!border-red-400' : ''}`}
                value={r.price}
                onChange={(e) => update(r.key, { price: e.target.value.replace(/\D/g, '') })}
              />
              <span aria-hidden>🪙</span>
            </label>
            {r.checked && r.price === '0' && <span className="shrink-0 text-xs text-neon-lime">Gratis</span>}
          </li>
        ))}
      </ul>

      <Card className="mt-4">
        <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-slate-400">Añadir una propia</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label="Nombre">{(id) => <input id={id} className={inputCls} maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom()} />}</Field>
          </div>
          <div className="w-28">
            <Field label="Precio 🪙">{(id) => <input id={id} inputMode="numeric" className={inputCls} value={newPrice} onChange={(e) => setNewPrice(e.target.value.replace(/\D/g, ''))} />}</Field>
          </div>
          <Button tone="violet" className="mb-3" disabled={!newName.trim() || !validPrice(newPrice)} onClick={addCustom}>
            Añadir
          </Button>
        </div>
        <p className="text-xs text-slate-500">Las recompensas son beneficios extra: nunca condiciones para recibir comida, descanso, atención o afecto.</p>
      </Card>

      <div className="mt-6 flex flex-col gap-3">
        {invalid.length > 0 && <p role="alert" className="text-sm text-red-300">Revisa el nombre y el precio de las recompensas marcadas (el precio es un número entero, 0 o más).</p>}
        <Button className="w-full" disabled={!ready || busy} onClick={submit}>
          {ready ? `Continuar con ${chosen.length} recompensas` : `Elige ${Math.max(0, MIN_INITIAL_REWARDS - chosen.length)} más para continuar`}
        </Button>
        <button
          type="button"
          className="text-sm text-slate-500 underline"
          onClick={async () => {
            await api.signOut()
            signedOut()
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
