import { useState } from 'react'
import type { MissionInput } from '../domain/engine'
import { DEFAULT_REWARDS, REWARD_CAPS } from '../domain/progression'
import { WEEKDAY_LABELS } from '../domain/recurrence'
import { CATEGORIES, DIFFICULTIES, type Category, type Difficulty, type Member, type Mission, type Recurrence } from '../domain/types'
import { Button, Field, inputCls } from './components'
import { CATEGORY_INFO, DIFFICULTY_LABEL, KIND_LABEL } from './labels'

interface Props {
  /** Quién usa el formulario: un niño sólo propone para sí. */
  actor: Member
  players: Member[]
  isSolo: boolean
  initial?: Mission
  submitLabel: string
  onSubmit(input: MissionInput): Promise<boolean>
}

export function MissionForm({ actor, players, isSolo, initial, submitLabel, onSubmit }: Props) {
  const isChild = actor.role === 'child'
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState<Category>(initial?.category ?? 'discipline')
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'easy')
  const [kind, setKind] = useState<Mission['kind']>(initial?.kind ?? 'daily')
  const [xp, setXp] = useState(initial?.xp ?? DEFAULT_REWARDS.easy.xp)
  const [coins, setCoins] = useState(initial?.coins ?? DEFAULT_REWARDS.easy.coins)
  const [initXp, setInitXp] = useState(initial?.initiativeXp ?? 0)
  const [initCoins, setInitCoins] = useState(initial?.initiativeCoins ?? 0)
  const [minutes, setMinutes] = useState(initial?.estimatedMinutes ?? 10)
  const [criteria, setCriteria] = useState(initial?.criteria ?? '')
  const [recType, setRecType] = useState<Recurrence['type']>(initial?.recurrence.type ?? 'daily')
  const [days, setDays] = useState<number[]>(initial?.recurrence.type === 'days' ? initial.recurrence.days : [1, 2, 3, 4, 5])
  const [assignees, setAssignees] = useState<string[]>(initial?.assigneeIds ?? (isChild ? [actor.id] : players.length === 1 ? [players[0].id] : []))
  const [requiresApproval, setRequiresApproval] = useState(initial?.requiresApproval ?? true)
  const [busy, setBusy] = useState(false)

  const caps = REWARD_CAPS[difficulty]

  function pickDifficulty(d: Difficulty) {
    setDifficulty(d)
    setXp(DEFAULT_REWARDS[d].xp)
    setCoins(DEFAULT_REWARDS[d].coins)
  }

  function pickKind(k: Mission['kind']) {
    setKind(k)
    if (k === 'daily') setRecType('daily')
    if (k === 'weekly') setRecType('weekly')
    if (k === 'special') setRecType('once')
  }

  async function submit() {
    setBusy(true)
    const recurrence: Recurrence = recType === 'days' ? { type: 'days', days } : ({ type: recType } as Recurrence)
    await onSubmit({
      title, description, category, difficulty, kind, xp, coins, initiativeXp: initXp, initiativeCoins: initCoins,
      estimatedMinutes: minutes, criteria, recurrence, assigneeIds: assignees, requiresApproval,
    })
    setBusy(false)
  }

  const num = (v: string) => (v === '' ? 0 : Number(v))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Field label="Nombre de la misión">{(id) => <input id={id} className={inputCls} required maxLength={80} placeholder="Tender la cama" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="Descripción (opcional)">{(id) => <textarea id={id} className={inputCls} rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <Field label="¿Cuándo se considera terminada?" hint="Condiciones claras, por ejemplo: «sábanas estiradas y almohada arriba».">
        {(id) => <input id={id} className={inputCls} maxLength={300} value={criteria} onChange={(e) => setCriteria(e.target.value)} />}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoría">
          {(id) => (
            <select id={id} className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_INFO[c].icon} {CATEGORY_INFO[c].label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Dificultad">
          {(id) => (
            <select id={id} className={inputCls} value={difficulty} onChange={(e) => pickDifficulty(e.target.value as Difficulty)}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Tipo">
          {(id) => (
            <select id={id} className={inputCls} value={kind} onChange={(e) => pickKind(e.target.value as Mission['kind'])}>
              {(Object.keys(KIND_LABEL) as Mission['kind'][]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Minutos estimados">{(id) => <input id={id} className={inputCls} type="number" min={0} max={600} value={minutes} onChange={(e) => setMinutes(num(e.target.value))} />}</Field>
        <Field label="XP" hint={`Máx. ${caps.xp}`}>{(id) => <input id={id} className={inputCls} type="number" min={0} max={caps.xp} value={xp} onChange={(e) => setXp(num(e.target.value))} />}</Field>
        <Field label="LIFECOINS" hint={`Máx. ${caps.coins}`}>{(id) => <input id={id} className={inputCls} type="number" min={0} max={caps.coins} value={coins} onChange={(e) => setCoins(num(e.target.value))} />}</Field>
      </div>

      <Field label="Repetición">
        {(id) => (
          <select id={id} className={inputCls} value={recType} onChange={(e) => setRecType(e.target.value as Recurrence['type'])}>
            <option value="once">Una sola vez</option>
            <option value="daily">Todos los días</option>
            <option value="days">Ciertos días de la semana</option>
            <option value="weekly">Una vez por semana</option>
          </select>
        )}
      </Field>
      {recType === 'days' && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Días de la semana">
          {WEEKDAY_LABELS.map((l, i) => (
            <button key={l} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i])} className={`rounded-lg border px-2.5 py-1 text-sm ${days.includes(i) ? 'border-neon-cyan bg-neon-cyan/20 text-neon-cyan' : 'border-white/15 text-slate-400'}`}>
              {l}
            </button>
          ))}
        </div>
      )}

      {!isChild && (
        <fieldset className="mb-3">
          <legend className="mb-1 text-sm font-medium text-slate-300">Asignar a</legend>
          <div className="flex flex-wrap gap-2">
            {players.map((p) => (
              <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${assignees.includes(p.id) ? 'border-neon-violet bg-neon-violet/15' : 'border-white/15'}`}>
                <input type="checkbox" checked={assignees.includes(p.id)} onChange={() => setAssignees(assignees.includes(p.id) ? assignees.filter((x) => x !== p.id) : [...assignees, p.id])} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!isChild && !isSolo && (
        <>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
            Un adulto debe aprobar cada vez que se complete
          </label>
          <details className="mb-3 rounded-xl border border-white/10 p-3">
            <summary className="cursor-pointer text-sm text-slate-300">Bonificación por iniciativa (opcional)</summary>
            <p className="my-2 text-xs text-slate-500">Se suma si al aprobar marcas que lo hizo sin recordatorios.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="XP extra">{(id) => <input id={id} className={inputCls} type="number" min={0} max={caps.xp} value={initXp} onChange={(e) => setInitXp(num(e.target.value))} />}</Field>
              <Field label="LIFECOINS extra">{(id) => <input id={id} className={inputCls} type="number" min={0} max={caps.coins} value={initCoins} onChange={(e) => setInitCoins(num(e.target.value))} />}</Field>
            </div>
          </details>
        </>
      )}

      {isChild && <p className="mb-3 rounded-lg bg-neon-violet/10 p-3 text-sm text-neon-violet">Es una propuesta: tu adulto decidirá si la acepta, la cambia o la rechaza.</p>}

      <Button type="submit" className="w-full" disabled={busy || !title.trim() || assignees.length === 0}>
        {submitLabel}
      </Button>
    </form>
  )
}
