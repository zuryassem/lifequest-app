import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AVATAR_COLORS, AVATAR_STYLES, GOALS, INTERESTS } from '../../domain/catalog'
import type { Avatar } from '../../domain/types'
import { AvatarView, Button, Card, Field, Heading, inputCls } from '../components'
import { useApp } from '../store'

/** Creación y edición de personaje con vista previa en vivo (§51–§73). */
export function CharacterPage() {
  const { snap, active, me, api, run } = useApp()
  const { memberId } = useParams()
  const nav = useNavigate()
  const target = snap?.members.find((m) => m.id === (memberId ?? active?.id))
  const [name, setName] = useState(target?.name ?? '')
  const [style, setStyle] = useState<Avatar['style']>(target?.avatar.style ?? 'runner')
  const [color, setColor] = useState(target?.avatar.color ?? AVATAR_COLORS[0])
  const [interests, setInterests] = useState<string[]>(target?.interests ?? [])
  const [goals, setGoals] = useState<string[]>(target?.goals ?? [])

  if (!snap || !target || !active || !me) return null
  // Un niño sólo edita su propio personaje; un adulto puede editar el de sus hijos (§64).
  if (active.role === 'child' && active.id !== target.id) return null

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function save() {
    const ok = await run(
      () => api.updateCharacter({ actorId: active!.id, memberId: target!.id, patch: { name, avatar: { style, color }, interests, goals } }),
      'Personaje guardado',
    )
    if (ok) nav('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Heading sub="Los cambios se ven al instante; guárdalos cuando estés listo.">Tu personaje</Heading>
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          <AvatarView avatar={{ ...target.avatar, style, color }} size={150} name={name} />
          <span className="font-display text-lg font-bold">{name || 'Sin nombre'}</span>
        </div>
        <Card>
          <Field label="Nombre de jugador">{(id) => <input id={id} className={inputCls} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <p className="mb-1 text-sm font-medium text-slate-300">Estilo</p>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AVATAR_STYLES.map((s) => (
              <button key={s.id} type="button" aria-pressed={style === s.id} onClick={() => setStyle(s.id)} className={`rounded-xl border p-2 text-center text-sm ${style === s.id ? 'border-neon-cyan bg-neon-cyan/15' : 'border-white/10'}`}>
                <div className="text-2xl">{s.glyph}</div>
                {s.label}
              </button>
            ))}
          </div>
          <p className="mb-1 text-sm font-medium text-slate-300">Color de energía</p>
          <div className="mb-3 flex gap-2">
            {AVATAR_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`size-8 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} />
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <p className="mb-2 text-sm font-medium text-slate-300">Intereses (recibirás ideas de actividades sobre ellos)</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {INTERESTS.map((i) => (
            <button key={i} type="button" aria-pressed={interests.includes(i)} onClick={() => toggle(interests, setInterests, i)} className={`rounded-full border px-3 py-1 text-sm ${interests.includes(i) ? 'border-neon-violet bg-neon-violet/20 text-neon-violet' : 'border-white/15 text-slate-300'}`}>
              {i}
            </button>
          ))}
        </div>
        <p className="mb-2 text-sm font-medium text-slate-300">Objetivos personales</p>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <button key={g} type="button" aria-pressed={goals.includes(g)} onClick={() => toggle(goals, setGoals, g)} className={`rounded-full border px-3 py-1 text-sm ${goals.includes(g) ? 'border-neon-lime bg-neon-lime/15 text-neon-lime' : 'border-white/15 text-slate-300'}`}>
              {g}
            </button>
          ))}
        </div>
      </Card>

      <div className="mt-5 flex gap-3">
        <Button className="flex-1" disabled={!name.trim()} onClick={save}>
          Guardar personaje
        </Button>
        <Button tone="ghost" onClick={() => nav(-1)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
