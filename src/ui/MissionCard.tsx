import { recurrenceLabel, CATEGORY_INFO, DIFFICULTY_LABEL } from './labels'
import type { Mission } from '../domain/types'
import type { MissionState } from './selectors'
import { Button, Chip, Coin, Xp } from './components'

interface Props {
  mission: Mission
  state: MissionState
  /** Mensaje de rechazo del adulto, si lo hay. */
  note?: string | null
  onComplete?: () => void
  busy?: boolean
  footer?: React.ReactNode
}

export function MissionCard({ mission, state, note, onComplete, busy, footer }: Props) {
  const cat = CATEGORY_INFO[mission.category]
  return (
    <article
      className={`rounded-2xl border bg-ink-800/70 p-4 transition ${state === 'done' ? 'opacity-60' : ''}`}
      style={{ borderColor: `${cat.color}55`, boxShadow: state === 'todo' ? `0 0 22px -14px ${cat.color}` : undefined }}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl text-2xl" style={{ background: `${cat.color}22` }} aria-hidden>
          {cat.icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-tight text-white">{mission.title}</h3>
          {mission.description && <p className="mt-0.5 text-sm text-slate-400">{mission.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip color={cat.color}>{cat.label}</Chip>
            <Chip>{DIFFICULTY_LABEL[mission.difficulty]}</Chip>
            <Chip>⏱ {mission.estimatedMinutes} min</Chip>
            <Chip>🔁 {recurrenceLabel(mission.recurrence)}</Chip>
          </div>
          {mission.criteria && (
            <p className="mt-2 text-xs text-slate-500">
              <span className="text-slate-400">Se completa cuando:</span> {mission.criteria}
            </p>
          )}
          {state === 'rejected' && note && <p className="mt-2 rounded-lg bg-neon-pink/10 p-2 text-sm text-neon-pink">Tu adulto dice: {note}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
          <Xp amount={mission.xp} />
          <Coin amount={mission.coins} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500">{footer}</div>
        {onComplete && state === 'todo' && (
          <Button tone="lime" small disabled={busy} onClick={onComplete}>
            ✔ {mission.requiresApproval ? 'Marcar como hecha' : 'Completar'}
          </Button>
        )}
        {onComplete && state === 'rejected' && (
          <Button tone="pink" small disabled={busy} onClick={onComplete}>
            ↺ Reintentar
          </Button>
        )}
        {state === 'pending' && <Chip color="#fbbf24">⏳ Esperando aprobación</Chip>}
        {state === 'done' && <Chip color="#a3e635">✓ Completada</Chip>}
      </div>
    </article>
  )
}
