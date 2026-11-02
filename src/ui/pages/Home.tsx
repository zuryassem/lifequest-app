import { Link } from 'react-router-dom'
import { activeConsequences } from '../../domain/engine'
import { toDateKey } from '../../domain/recurrence'
import { AvatarView, Bar, Button, Card, Coin, Empty, Heading, Xp } from '../components'
import { MissionCard } from '../MissionCard'
import { activeMissionsFor, completionFor, missionState, pendingCounts, sortMissions, statsOf } from '../selectors'
import { useApp } from '../store'

/** Centro de Aventura (§209–§213). */
export function HomePage() {
  const { snap, active, me, childMode, api, run } = useApp()
  if (!snap || !active || !me) return null
  const today = toDateKey(new Date())
  const isGuardian = active.role === 'guardian'
  const counts = pendingCounts(snap)
  const toReview = counts.completions + counts.redemptions + counts.missionProposals + counts.rewardProposals

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {active.playsGame ? renderPlayer() : <Heading sub="Estás en modo administración: no participas como jugador.">Centro de Aventura</Heading>}

      {isGuardian && !childMode && (
        <Card glow="violet" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold uppercase tracking-widest">Panel familiar</h2>
              <p className="text-sm text-slate-400">
                {snap.family.kind === 'solo' ? 'Aventura individual.' : toReview > 0 ? `${toReview} ${toReview === 1 ? 'asunto espera' : 'asuntos esperan'} tu revisión.` : 'Todo al día.'}
              </p>
            </div>
            {snap.family.kind === 'family' && (
              <Link to="/family">
                <Button tone="violet" small>
                  Abrir panel
                </Button>
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  )

  function renderPlayer() {
    const s = statsOf(snap!, active!.id)
    const list = sortMissions(snap!, activeMissionsFor(snap!, active!.id), active!.id, today).filter((m) => missionState(snap!, m, active!.id, today) !== 'notdue')
    const doneCount = list.filter((m) => missionState(snap!, m, active!.id, today) === 'done').length
    const specials = list.filter((m) => m.kind === 'special' || m.difficulty === 'special')

    return (
      <>
        <Card glow="cyan">
          <div className="flex items-center gap-4">
            <AvatarView avatar={active!.avatar} size={96} name={active!.name} />
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-widest text-neon-violet">{active!.avatar.title ?? 'Aprendiz'}</p>
              <h1 className="truncate font-display text-2xl font-extrabold">{active!.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-display text-lg font-bold text-white">Nivel {s.progress.level}</span>
                <Coin amount={s.available} />
                {s.held > 0 && <span className="text-xs text-slate-400">({s.held} reservadas)</span>}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <Xp amount={s.xp} />
              <span>
                Siguiente nivel: {s.progress.nextLevelXp} XP · faltan {s.progress.nextLevelXp - s.xp}
              </span>
            </div>
            <Bar ratio={s.progress.ratio} label="Progreso del nivel" />
          </div>
        </Card>

        {activeConsequences(snap!, active!.id).map((c) => (
          <div key={c.id} role="alert" className="mt-4 rounded-2xl border border-neon-pink/60 bg-neon-pink/10 p-4">
            <div className="font-semibold text-neon-pink">⚠ Consecuencia activa: {c.name}</div>
            {c.description && <p className="text-sm text-slate-300">{c.description}</p>}
            <p className="mt-1 text-sm text-slate-300">
              Tienes {s.available} 🪙 disponibles. Cuando vuelvas a tener {c.thresholdCoins} o más, se quita. ¡Completa misiones para recuperarte!
            </p>
          </div>
        ))}

        <div className="mb-3 mt-6 flex items-end justify-between">
          <h2 className="font-display text-lg font-bold uppercase tracking-widest">Misiones de hoy</h2>
          <span className="text-sm text-slate-400">
            {doneCount}/{list.length} completadas
          </span>
        </div>
        <Bar ratio={list.length ? doneCount / list.length : 0} color="var(--color-neon-lime)" label="Progreso del día" />

        {specials.length > 0 && <p className="mt-3 text-sm text-neon-amber">⭐ Desafío especial activo: {specials.map((m) => m.title).join(', ')}</p>}

        <div className="mt-4 grid gap-3">
          {list.length === 0 && (
            <Empty icon="🌠">
              No tienes misiones hoy.{' '}
              <Link className="text-neon-cyan underline" to="/missions">
                {isGuardian ? 'Crea una' : 'Propón una'}
              </Link>
              .
            </Empty>
          )}
          {list.slice(0, 5).map((m) => (
            <MissionCard
              key={m.id}
              mission={m}
              state={missionState(snap!, m, active!.id, today)}
              note={completionFor(snap!, m, active!.id, today)?.note}
              onComplete={() =>
                run(
                  () => api.completeMission({ actorId: active!.id, missionId: m.id, memberId: active!.id }),
                  m.requiresApproval && !isGuardian ? 'Enviada a revisión. ¡Buen trabajo!' : `¡Misión completada! +${m.xp} XP · +${m.coins} 🪙`,
                )
              }
            />
          ))}
          {list.length > 5 && (
            <Link to="/missions" className="text-center text-sm text-neon-cyan underline">
              Ver las {list.length} misiones
            </Link>
          )}
        </div>
      </>
    )
  }
}
