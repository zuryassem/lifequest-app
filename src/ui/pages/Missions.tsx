import { useState } from 'react'
import { toDateKey } from '../../domain/recurrence'
import { CATEGORIES, DIFFICULTIES, type Category, type Difficulty } from '../../domain/types'
import { Button, Chip, Empty, Heading, Modal, Tabs, inputCls } from '../components'
import { CATEGORY_INFO, DIFFICULTY_LABEL, KIND_LABEL } from '../labels'
import { MissionCard } from '../MissionCard'
import { MissionForm } from '../MissionForm'
import { activeMissionsFor, completionFor, fmtDate, missionState, nameOf, playersOf, sortMissions } from '../selectors'
import { useApp } from '../store'

type Tab = 'today' | 'upcoming' | 'done' | 'proposals'

export function MissionsPage() {
  const { snap, active, api, run } = useApp()
  const [tab, setTab] = useState<Tab>('today')
  const [cat, setCat] = useState<Category | ''>('')
  const [diff, setDiff] = useState<Difficulty | ''>('')
  const [creating, setCreating] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!snap || !active) return null

  const players = playersOf(snap)
  const isGuardian = active.role === 'guardian'
  // Un adulto que sólo administra puede mirar las misiones de cualquier jugador.
  const viewing = players.find((p) => p.id === (viewId ?? (active.playsGame ? active.id : players[0]?.id))) ?? null
  const today = toDateKey(new Date())

  const mine = viewing ? activeMissionsFor(snap, viewing.id) : []
  const passes = (m: (typeof mine)[number]) => (!cat || m.category === cat) && (!diff || m.difficulty === diff)
  const dueToday = viewing ? sortMissions(snap, mine.filter(passes), viewing.id, today).filter((m) => missionState(snap, m, viewing.id, today) !== 'notdue') : []
  const upcoming = viewing ? mine.filter(passes).filter((m) => missionState(snap, m, viewing.id, today) === 'notdue') : []
  const doneList = viewing
    ? snap.completions.filter((c) => c.memberId === viewing.id && c.status === 'approved').sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
    : []
  const proposals = snap.missions.filter((m) => m.status === 'proposed' || ((m.status === 'rejected') && (isGuardian || m.createdBy === active.id)))
  const pendingProposals = snap.missions.filter((m) => m.status === 'proposed').length

  async function complete(missionId: string) {
    if (!viewing) return
    setBusy(true)
    const m = snap!.missions.find((x) => x.id === missionId)!
    const needsReview = m.requiresApproval && active!.role !== 'guardian'
    await run(
      () => api.completeMission({ actorId: active!.id, missionId, memberId: viewing.id }),
      needsReview ? 'Enviada a revisión. ¡Buen trabajo!' : `¡Misión completada! +${m.xp} XP · +${m.coins} 🪙`,
    )
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Heading sub={viewing ? `Misiones de ${viewing.name}` : 'Aún no hay jugadores'}>Misiones</Heading>

      {isGuardian && players.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {players.map((p) => (
            <button key={p.id} type="button" aria-pressed={viewing?.id === p.id} onClick={() => setViewId(p.id)} className={`rounded-full border px-3 py-1 text-sm ${viewing?.id === p.id ? 'border-neon-violet bg-neon-violet/20 text-neon-violet' : 'border-white/15 text-slate-300'}`}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filtrar por categoría" className={`${inputCls} !w-auto`} value={cat} onChange={(e) => setCat(e.target.value as Category | '')}>
            <option value="">Todas las categorías</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_INFO[c].label}
              </option>
            ))}
          </select>
          <select aria-label="Filtrar por dificultad" className={`${inputCls} !w-auto`} value={diff} onChange={(e) => setDiff(e.target.value as Difficulty | '')}>
            <option value="">Toda dificultad</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </select>
        </div>
        <Button tone="violet" small onClick={() => setCreating(true)}>
          {isGuardian ? '＋ Nueva misión' : '💡 Proponer misión'}
        </Button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'today', label: 'Hoy', badge: dueToday.filter((m) => viewing && missionState(snap, m, viewing.id, today) === 'todo').length },
          { id: 'upcoming', label: 'Próximas' },
          { id: 'done', label: 'Completadas' },
          { id: 'proposals', label: 'Propuestas', badge: isGuardian ? pendingProposals : 0 },
        ]}
      />

      {tab === 'today' && (
        <div className="grid gap-3">
          {dueToday.length === 0 && <Empty icon="🌠">No hay misiones para hoy{cat || diff ? ' con esos filtros' : ''}. {isGuardian ? 'Crea una nueva misión.' : 'Propón una a tu adulto.'}</Empty>}
          {dueToday.map((m) => {
            const c = viewing ? completionFor(snap, m, viewing.id, today) : undefined
            return <MissionCard key={m.id} mission={m} state={viewing ? missionState(snap, m, viewing.id, today) : 'notdue'} note={c?.note} busy={busy} onComplete={() => complete(m.id)} />
          })}
        </div>
      )}

      {tab === 'upcoming' && (
        <div className="grid gap-3">
          {upcoming.length === 0 && <Empty icon="🗓️">No hay misiones próximas: todo lo activo toca hoy.</Empty>}
          {upcoming.map((m) => (
            <MissionCard key={m.id} mission={m} state="notdue" footer={KIND_LABEL[m.kind]} />
          ))}
        </div>
      )}

      {tab === 'done' && (
        <div className="grid gap-3">
          {doneList.length === 0 && <Empty icon="🏁">Todavía no hay misiones completadas.</Empty>}
          {doneList.slice(0, 50).map((c) => {
            const m = snap.missions.find((x) => x.id === c.missionId)!
            return (
              <MissionCard
                key={c.id}
                mission={m}
                state="done"
                footer={`${fmtDate(c.completedAt)} · aprobada por ${nameOf(snap, c.reviewedBy)}${c.initiative ? ' · con iniciativa ⭐' : ''}`}
              />
            )
          })}
        </div>
      )}

      {tab === 'proposals' && (
        <div className="grid gap-3">
          {proposals.length === 0 && <Empty icon="💡">No hay propuestas.</Empty>}
          {proposals.map((m) => (
            <div key={m.id}>
              <MissionCard mission={m} state="notdue" footer={`Propuesta de ${nameOf(snap, m.createdBy)} para ${m.assigneeIds.map((id) => nameOf(snap, id)).join(', ')}`} />
              <div className="mt-1 flex items-center gap-2 px-1 text-xs">
                {m.status === 'proposed' ? <Chip color="#fbbf24">Pendiente{isGuardian ? ' · revísala en el Panel Familiar' : ' de aprobación'}</Chip> : <Chip color="#f472b6">Rechazada{m.reviewNote ? `: ${m.reviewNote}` : ''}</Chip>}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <Modal title={isGuardian ? 'Nueva misión' : 'Proponer misión'} onClose={() => setCreating(false)}>
          <MissionForm
            actor={active}
            players={players}
            isSolo={snap.family.kind === 'solo'}
            submitLabel={isGuardian ? 'Crear misión' : 'Enviar propuesta'}
            onSubmit={async (mission) => {
              const ok = await run(() => api.createMission({ actorId: active.id, mission }), isGuardian ? 'Misión creada' : 'Propuesta enviada a tu adulto')
              if (ok) setCreating(false)
              return ok
            }}
          />
        </Modal>
      )}
    </div>
  )
}
