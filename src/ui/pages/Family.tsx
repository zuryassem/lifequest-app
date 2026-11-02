import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { activeConsequences } from '../../domain/engine'
import type { AgeBand, Completion, Member, Mission, Redemption } from '../../domain/types'
import { AvatarView, Bar, Button, Card, Chip, Coin, Empty, Field, Heading, Modal, Tabs, Xp, inputCls } from '../components'
import { KIND_LABEL, recurrenceLabel } from '../labels'
import { MissionForm } from '../MissionForm'
import { fmtDate, nameOf, pendingCounts, playersOf, statsOf } from '../selectors'
import { useApp } from '../store'

type Tab = 'approvals' | 'members' | 'agreements' | 'settings'

interface Prompt {
  title: string
  label: string
  required: boolean
  withDate?: boolean
  confirm: string
  onConfirm(note: string, date: string): Promise<boolean>
}

export function FamilyPage() {
  const { snap, active, me, childMode } = useApp()
  const [tab, setTab] = useState<Tab>('approvals')
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  if (!snap || !active || !me) return null
  // La administración nunca se muestra en modo niño (§36).
  if (childMode || active.role !== 'guardian') return <Navigate to="/" replace />
  const c = pendingCounts(snap)
  const total = c.completions + c.redemptions + c.missionProposals + c.rewardProposals

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Heading sub={`Código de familia: ${snap.family.code}`}>{snap.family.kind === 'solo' ? 'Mi aventura' : snap.family.name}</Heading>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'approvals', label: 'Aprobaciones', badge: total },
          { id: 'members', label: 'Integrantes' },
          { id: 'agreements', label: 'Acuerdos' },
          { id: 'settings', label: 'Ajustes' },
        ]}
      />
      {tab === 'approvals' && <Approvals ask={setPrompt} />}
      {tab === 'members' && <Members ask={setPrompt} />}
      {tab === 'agreements' && <Agreements />}
      {tab === 'settings' && <Settings />}
      {prompt && <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} />}
    </div>
  )
}

function PromptDialog({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const invalid = (prompt.required && !note.trim()) || (prompt.withDate && !date)
  return (
    <Modal title={prompt.title} onClose={onClose}>
      <Field label={prompt.label}>{(id) => <textarea id={id} className={inputCls} rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      {prompt.withDate && <Field label="Nueva fecha">{(id) => <input id={id} type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>}
      <Button
        className="w-full"
        disabled={invalid || busy}
        onClick={async () => {
          setBusy(true)
          const ok = await prompt.onConfirm(note, date)
          setBusy(false)
          if (ok) onClose()
        }}
      >
        {prompt.confirm}
      </Button>
    </Modal>
  )
}

// ---------- Aprobaciones ----------

function Approvals({ ask }: { ask: (p: Prompt) => void }) {
  const { snap, active, api, run } = useApp()
  const [editing, setEditing] = useState<Mission | null>(null)
  if (!snap || !active) return null
  const actorId = active.id
  const pendingC = snap.completions.filter((c) => c.status === 'pending')
  const proposals = snap.missions.filter((m) => m.status === 'proposed')
  const rewardProps = snap.rewards.filter((r) => r.status === 'proposed')
  const redemptions = snap.redemptions.filter((r) => r.status === 'pending' || r.status === 'rescheduled')
  const approvedRedemptions = snap.redemptions.filter((r) => r.status === 'approved').slice(-5)
  const nothing = !pendingC.length && !proposals.length && !rewardProps.length && !redemptions.length

  const missionOf = (c: Completion) => snap.missions.find((m) => m.id === c.missionId)!

  return (
    <div className="grid gap-5">
      {nothing && <Empty icon="✅">No hay nada pendiente de revisar.</Empty>}

      {pendingC.length > 0 && (
        <Section title="Misiones por verificar">
          {pendingC.map((c) => {
            const m = missionOf(c)
            return (
              <Card key={c.id}>
                <div className="flex justify-between gap-2">
                  <div>
                    <div className="font-semibold">{m.title}</div>
                    <div className="text-xs text-slate-500">
                      {nameOf(snap, c.memberId)} · {fmtDate(c.completedAt)}
                    </div>
                    {m.criteria && <div className="mt-1 text-xs text-slate-400">Debe cumplir: {m.criteria}</div>}
                  </div>
                  <div className="text-right text-sm">
                    <Xp amount={m.xp} />
                    <div>
                      <Coin amount={m.coins} />
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button tone="pink" small onClick={() => ask({ title: 'Rechazar misión', label: 'Explica qué falta (opcional)', required: false, confirm: 'Rechazar', onConfirm: (note) => run(() => api.reviewCompletion({ actorId, completionId: c.id, decision: 'reject', note }), 'Misión devuelta') })}>
                    Rechazar
                  </Button>
                  {(m.initiativeXp > 0 || m.initiativeCoins > 0) && (
                    <Button tone="amber" small onClick={() => run(() => api.reviewCompletion({ actorId, completionId: c.id, decision: 'approve', initiative: true }), `Aprobada con bono: +${m.initiativeXp} XP · +${m.initiativeCoins} 🪙 extra`)}>
                      ⭐ Con iniciativa
                    </Button>
                  )}
                  <Button tone="lime" small onClick={() => run(() => api.reviewCompletion({ actorId, completionId: c.id, decision: 'approve' }), 'Misión aprobada')}>
                    Aprobar
                  </Button>
                </div>
              </Card>
            )
          })}
        </Section>
      )}

      {redemptions.length > 0 && (
        <Section title="Canjes solicitados">
          {redemptions.map((r) => (
            <RedemptionRow key={r.id} r={r} ask={ask} />
          ))}
        </Section>
      )}

      {proposals.length > 0 && (
        <Section title="Misiones propuestas">
          {proposals.map((m) => (
            <Card key={m.id}>
              <div className="flex justify-between gap-2">
                <div>
                  <div className="font-semibold">{m.title}</div>
                  <div className="text-xs text-slate-500">
                    Propuesta de {nameOf(snap, m.createdBy)} · {recurrenceLabel(m.recurrence)}
                  </div>
                  {m.description && <p className="text-sm text-slate-400">{m.description}</p>}
                </div>
                <div className="text-right text-sm">
                  <Xp amount={m.xp} />
                  <div>
                    <Coin amount={m.coins} />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button tone="pink" small onClick={() => ask({ title: 'Rechazar propuesta', label: 'Explica el motivo o sugiere una alternativa', required: false, confirm: 'Rechazar', onConfirm: (note) => run(() => api.reviewMissionProposal({ actorId, missionId: m.id, decision: 'reject', note }), 'Propuesta rechazada') })}>
                  Rechazar
                </Button>
                <Button tone="ghost" small onClick={() => setEditing(m)}>
                  Editar y aprobar
                </Button>
                <Button tone="lime" small onClick={() => run(() => api.reviewMissionProposal({ actorId, missionId: m.id, decision: 'approve' }), 'Misión aprobada y activa')}>
                  Aprobar
                </Button>
              </div>
            </Card>
          ))}
        </Section>
      )}

      {rewardProps.length > 0 && (
        <Section title="Recompensas propuestas">
          {rewardProps.map((r) => (
            <Card key={r.id}>
              <div className="flex justify-between">
                <div>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-slate-500">Propuesta de {nameOf(snap, r.createdBy)}</div>
                </div>
                <Coin amount={r.price} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button tone="pink" small onClick={() => run(() => api.reviewReward({ actorId, rewardId: r.id, decision: 'reject' }), 'Propuesta rechazada')}>
                  Rechazar
                </Button>
                <Button tone="lime" small onClick={() => run(() => api.reviewReward({ actorId, rewardId: r.id, decision: 'approve' }), 'Recompensa disponible en la tienda')}>
                  Aprobar
                </Button>
              </div>
            </Card>
          ))}
        </Section>
      )}

      {approvedRedemptions.length > 0 && (
        <Section title="Canjes aprobados recientes">
          {approvedRedemptions.map((r) => {
            const reward = snap.rewards.find((x) => x.id === r.rewardId)
            return (
              <Card key={r.id}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div>{reward?.name}</div>
                    <div className="text-xs text-slate-500">
                      {nameOf(snap, r.memberId)}
                      {r.scheduledFor && ` · para el ${r.scheduledFor}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button tone="ghost" small onClick={() => ask({ title: 'Reprogramar', label: 'Motivo (opcional)', required: false, withDate: true, confirm: 'Reprogramar', onConfirm: (note, date) => run(() => api.reviewRedemption({ actorId, redemptionId: r.id, decision: 'reschedule', note, scheduledFor: date }), 'Reprogramado') })}>
                      Reprogramar
                    </Button>
                    <Button tone="danger" small onClick={() => ask({ title: 'Devolver monedas', label: 'Motivo (opcional)', required: false, confirm: `Devolver ${r.price} 🪙`, onConfirm: (note) => run(() => api.refundRedemption({ actorId, redemptionId: r.id, note }), 'Monedas devueltas') })}>
                      Devolver
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </Section>
      )}

      {editing && (
        <Modal title="Editar y aprobar" onClose={() => setEditing(null)}>
          <MissionForm
            actor={active}
            players={playersOf(snap)}
            isSolo={false}
            initial={editing}
            submitLabel="Aprobar con estos cambios"
            onSubmit={async (input) => {
              const ok = await run(() => api.reviewMissionProposal({ actorId, missionId: editing.id, decision: 'approve', edits: input }), 'Misión aprobada con cambios')
              if (ok) setEditing(null)
              return ok
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function RedemptionRow({ r, ask }: { r: Redemption; ask: (p: Prompt) => void }) {
  const { snap, active, api, run } = useApp()
  if (!snap || !active) return null
  const actorId = active.id
  const reward = snap.rewards.find((x) => x.id === r.rewardId)
  return (
    <Card>
      <div className="flex justify-between gap-2">
        <div>
          <div className="font-semibold">{reward?.name}</div>
          <div className="text-xs text-slate-500">
            {nameOf(snap, r.memberId)} · {fmtDate(r.requestedAt)}
            {r.status === 'rescheduled' && r.scheduledFor && ` · reprogramado al ${r.scheduledFor}`}
          </div>
          {reward?.conditions && <div className="mt-1 text-xs text-slate-400">Condiciones: {reward.conditions}</div>}
        </div>
        <Coin amount={r.price} />
      </div>
      <p className="mt-2 text-xs text-slate-500">Las monedas están reservadas; se descuentan sólo al aprobar.</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button tone="pink" small onClick={() => ask({ title: 'Rechazar canje', label: 'Explica el motivo', required: true, confirm: 'Rechazar con explicación', onConfirm: (note) => run(() => api.reviewRedemption({ actorId, redemptionId: r.id, decision: 'reject', note }), 'Canje rechazado') })}>
          Rechazar
        </Button>
        <Button tone="ghost" small onClick={() => ask({ title: 'Proponer otra fecha', label: 'Mensaje (opcional)', required: false, withDate: true, confirm: 'Proponer fecha', onConfirm: (note, date) => run(() => api.reviewRedemption({ actorId, redemptionId: r.id, decision: 'reschedule', note, scheduledFor: date }), 'Fecha propuesta') })}>
          Otra fecha
        </Button>
        <Button tone="lime" small onClick={() => run(() => api.reviewRedemption({ actorId, redemptionId: r.id, decision: 'approve' }), 'Canje aprobado')}>
          Aprobar
        </Button>
      </div>
    </Card>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-slate-400">{title}</h2>
      <div className="grid gap-3">{children}</div>
    </div>
  )
}

// ---------- Integrantes ----------

function Members({ ask }: { ask: (p: Prompt) => void }) {
  const { snap, active, api, run, setActive } = useApp()
  const nav = useNavigate()
  const [adding, setAdding] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  if (!snap || !active) return null
  const actorId = active.id
  const isFamily = snap.family.kind === 'family'

  return (
    <div className="grid gap-3">
      {snap.members.map((m) => (
        <MemberCard key={m.id} m={m} ask={ask} onPlayAs={() => { setActive(m.id); nav('/') }} />
      ))}
      {isFamily && (
        <div className="flex flex-wrap gap-2">
          <Button tone="violet" onClick={() => setAdding(true)}>
            ＋ Añadir hijo/a
          </Button>
          {snap.members.filter((m) => m.role === 'guardian').length < 2 && (
            <Button tone="ghost" onClick={async () => { await run(async () => setInviteCode(await api.createInvite({ actorId }))) }}>
              Invitar a otro adulto
            </Button>
          )}
        </div>
      )}
      {inviteCode && (
        <Card glow="cyan">
          <p className="text-sm text-slate-300">Comparte este código con el otro adulto (caduca en 48 h). Debe crear su cuenta y elegir «Tengo un código de invitación».</p>
          <p className="mt-2 text-center font-mono text-3xl font-bold tracking-[0.3em] text-neon-cyan">{inviteCode}</p>
        </Card>
      )}
      {adding && <AddChild onClose={() => setAdding(false)} />}
    </div>
  )
}

function MemberCard({ m, ask, onPlayAs }: { m: Member; ask: (p: Prompt) => void; onPlayAs(): void }) {
  const { snap, active, api, run } = useApp()
  if (!snap || !active) return null
  const actorId = active.id
  const s = m.playsGame ? statsOf(snap, m.id) : null
  const done = snap.completions.filter((c) => c.memberId === m.id && c.status === 'approved').length
  const pending = snap.completions.filter((c) => c.memberId === m.id && c.status === 'pending').length

  return (
    <Card>
      <div className="flex items-center gap-3">
        <AvatarView avatar={m.avatar} size={64} name={m.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display font-bold">{m.name}</span>
            <Chip color={m.role === 'guardian' ? '#a78bfa' : '#22d3ee'}>{m.role === 'guardian' ? 'Adulto' : 'Jugador/a'}</Chip>
            {m.id === active.id && <Chip color="#a3e635">Tú</Chip>}
          </div>
          {s ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm">
                <span>Nivel {s.level}</span>
                <Xp amount={s.xp} />
                <Coin amount={s.available} />
              </div>
              <div className="mt-1.5">
                <Bar ratio={s.progress.ratio} label={`Progreso de ${m.name}`} />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {done} misiones completadas · {pending} por verificar
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">Sólo administra</div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {m.playsGame && m.id !== active.id && (
          <Button tone="cyan" small onClick={onPlayAs}>
            Jugar como {m.name}
          </Button>
        )}
        {m.accountId === null || m.id === active.id ? (
          <Link to={`/character/${m.id}`}>
            <Button tone="ghost" small>
              Personaje
            </Button>
          </Link>
        ) : null}
        {m.playsGame && <CorrectionButton member={m} />}
        {m.role === 'child' && (
          <Button tone="danger" small onClick={() => ask({ title: `Eliminar a ${m.name}`, label: 'Escribe ELIMINAR para confirmar. Se borrará todo su progreso.', required: true, confirm: 'Eliminar perfil', onConfirm: async (note) => (note.trim() === 'ELIMINAR' ? run(() => api.removeChild({ actorId, childId: m.id }), 'Perfil eliminado') : false) })}>
            Eliminar
          </Button>
        )}
      </div>
    </Card>
  )
}

function CorrectionButton({ member }: { member: Member }) {
  const { api, run, active } = useApp()
  const [open, setOpen] = useState(false)
  const [xp, setXp] = useState(0)
  const [coins, setCoins] = useState(0)
  const [reason, setReason] = useState('')
  if (!active) return null
  return (
    <>
      <Button tone="ghost" small onClick={() => setOpen(true)}>
        Corregir saldo
      </Button>
      {open && (
        <Modal title={`Corrección para ${member.name}`} onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm text-slate-400">Sirve para arreglar un error. Queda registrada en el historial y nunca deja saldos negativos.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="XP (+/−)">{(id) => <input id={id} type="number" className={inputCls} value={xp} onChange={(e) => setXp(Number(e.target.value))} />}</Field>
            <Field label="LIFECOINS (+/−)">{(id) => <input id={id} type="number" className={inputCls} value={coins} onChange={(e) => setCoins(Number(e.target.value))} />}</Field>
          </div>
          <Field label="Motivo">{(id) => <input id={id} className={inputCls} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Button
            className="w-full"
            disabled={reason.trim().length < 3 || (xp === 0 && coins === 0)}
            onClick={async () => {
              const ok = await run(() => api.correctLedger({ actorId: active.id, memberId: member.id, xp, coins, reason }), 'Corrección registrada')
              if (ok) setOpen(false)
            }}
          >
            Aplicar corrección
          </Button>
        </Modal>
      )}
    </>
  )
}

function AddChild({ onClose }: { onClose: () => void }) {
  const { api, run, active } = useApp()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [age, setAge] = useState<AgeBand>('kid')
  const [consent, setConsent] = useState(false)
  if (!active) return null
  return (
    <Modal title="Añadir hijo/a" onClose={onClose}>
      <Field label="Nombre o apodo" hint="No hace falta el nombre real ni ningún dato de contacto.">
        {(id) => <input id={id} className={inputCls} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Edad aproximada">
        {(id) => (
          <select id={id} className={inputCls} value={age} onChange={(e) => setAge(e.target.value as AgeBand)}>
            <option value="kid">Niño/a (hasta 12 años)</option>
            <option value="teen">Adolescente (13 a 17 años)</option>
          </select>
        )}
      </Field>
      <label className="mb-4 flex gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        Soy su madre, padre o tutor legal y autorizo crear este perfil. Entiendo que sólo se guardará su nombre/apodo, personaje y progreso del juego.
      </label>
      <Button
        className="w-full"
        disabled={!name.trim() || !consent}
        onClick={async () => {
          const before = new Set((await api.getSnapshot())?.members.map((m) => m.id))
          const ok = await run(() => api.addChild({ actorId: active.id, name, ageBand: age }), 'Perfil creado')
          if (ok) {
            onClose()
            const after = (await api.getSnapshot())?.members.find((m) => !before.has(m.id))
            if (after) nav(`/character/${after.id}`)
          }
        }}
      >
        Crear perfil y personaje
      </Button>
    </Modal>
  )
}

// ---------- Acuerdos ----------

function Agreements() {
  const { snap, active, api, run } = useApp()
  const [editing, setEditing] = useState<Mission | null>(null)
  if (!snap || !active) return null
  const actorId = active.id
  const list = snap.missions.filter((m) => m.status === 'active' || m.status === 'suspended')
  return (
    <div className="grid gap-3">
      <p className="text-sm text-slate-400">Misiones vigentes de tu familia. Cambiar o suspender una misión no quita lo que ya se ganó.</p>
      {list.length === 0 && <Empty icon="📜">Aún no hay acuerdos. Crea misiones desde la sección Misiones.</Empty>}
      {list.map((m) => (
        <Card key={m.id} className={m.status === 'suspended' ? 'opacity-60' : ''}>
          <div className="flex justify-between gap-2">
            <div>
              <div className="font-semibold">
                {m.title} {m.status === 'suspended' && <Chip color="#fbbf24">Suspendida</Chip>}
              </div>
              <div className="text-xs text-slate-500">
                {KIND_LABEL[m.kind]} · {recurrenceLabel(m.recurrence)} · para {m.assigneeIds.map((id) => nameOf(snap, id)).join(', ')}
              </div>
              <div className="text-xs text-slate-500">
                Creada por {nameOf(snap, m.createdBy)}
                {m.reviewedBy ? ` · aprobada por ${nameOf(snap, m.reviewedBy)}` : ''} · verifica: {m.requiresApproval ? 'un adulto' : 'automática'}
              </div>
            </div>
            <div className="text-right text-sm">
              <Xp amount={m.xp} />
              <div>
                <Coin amount={m.coins} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button tone="ghost" small onClick={() => setEditing(m)}>
              Editar
            </Button>
            <Button tone="amber" small onClick={() => run(() => api.setMissionStatus({ actorId, missionId: m.id, status: m.status === 'active' ? 'suspended' : 'active' }), m.status === 'active' ? 'Misión suspendida (vacaciones, enfermedad…)' : 'Misión reactivada')}>
              {m.status === 'active' ? 'Suspender' : 'Reanudar'}
            </Button>
            <Button tone="danger" small onClick={() => run(() => api.setMissionStatus({ actorId, missionId: m.id, status: 'archived' }), 'Misión archivada')}>
              Archivar
            </Button>
          </div>
        </Card>
      ))}
      <ConsequencesSection />
      {editing && (
        <Modal title="Editar misión" onClose={() => setEditing(null)}>
          <MissionForm
            actor={active}
            players={playersOf(snap)}
            isSolo={snap.family.kind === 'solo'}
            initial={editing}
            submitLabel="Guardar cambios"
            onSubmit={async (input) => {
              const ok = await run(() => api.updateMission({ actorId, missionId: editing.id, edits: input }), 'Misión actualizada')
              if (ok) setEditing(null)
              return ok
            }}
          />
        </Modal>
      )}
    </div>
  )
}

// ---------- Consecuencias ----------

function ConsequencesSection() {
  const { snap, active, api, run } = useApp()
  const [open, setOpen] = useState(false)
  if (!snap || !active) return null
  const rules = snap.consequences.filter((c) => c.status === 'active')
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-sm font-bold uppercase tracking-widest text-slate-400">Consecuencias acordadas</h2>
        <Button tone="violet" small onClick={() => setOpen(true)}>
          ＋ Nueva consecuencia
        </Button>
      </div>
      <p className="mb-3 text-sm text-slate-400">
        Se activan cuando las monedas disponibles de un jugador bajan de un número que tú eliges. La app las muestra con claridad al jugador; no quita XP ni monedas, y tú las haces efectivas. Nunca pueden afectar comida, sueño, descanso, educación ni afecto.
      </p>
      <div className="grid gap-3">
        {rules.length === 0 && <Empty icon="⚖️">Aún no hay consecuencias. Son opcionales.</Empty>}
        {rules.map((r) => {
          const affected = r.appliesTo.filter((id) => activeConsequences(snap, id).some((c) => c.id === r.id))
          return (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{r.name}</div>
                  {r.description && <p className="text-sm text-slate-400">{r.description}</p>}
                  <p className="mt-1 text-xs text-slate-500">
                    Si tiene menos de <strong>{r.thresholdCoins} 🪙</strong> disponibles · para {r.appliesTo.map((id) => nameOf(snap, id)).join(', ')}
                  </p>
                </div>
                <Button tone="ghost" small onClick={() => run(() => api.archiveConsequence({ actorId: active.id, ruleId: r.id }), 'Consecuencia retirada')}>
                  Retirar
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {affected.length === 0 ? <Chip color="#a3e635">Nadie la tiene activa ahora</Chip> : affected.map((id) => <Chip key={id} color="#f472b6">⚠ Activa para {nameOf(snap, id)}</Chip>)}
              </div>
            </Card>
          )
        })}
      </div>
      {open && <ConsequenceForm onClose={() => setOpen(false)} />}
    </div>
  )
}

function ConsequenceForm({ onClose }: { onClose: () => void }) {
  const { snap, active, api, run } = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [threshold, setThreshold] = useState('')
  const [who, setWho] = useState<string[]>([])
  const [confirm, setConfirm] = useState(false)
  if (!snap || !active) return null
  const players = playersOf(snap)
  const valid = name.trim() && /^\d+$/.test(threshold) && Number(threshold) >= 1 && who.length > 0 && confirm
  return (
    <Modal title="Nueva consecuencia" onClose={onClose}>
      <Field label="¿Qué pasa?">{(id) => <input id={id} className={inputCls} maxLength={80} placeholder="Describe la consecuencia" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Detalles (opcional)">{(id) => <input id={id} className={inputCls} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <Field label="Se activa si tiene menos de… (LIFECOINS disponibles)" hint="Cuentan las monedas libres: las reservadas en canjes pendientes no.">
        {(id) => <input id={id} inputMode="numeric" className={`${inputCls} !w-40`} value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))} />}
      </Field>
      <fieldset className="mb-3">
        <legend className="mb-1 text-sm font-medium text-slate-300">Se aplica a</legend>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${who.includes(p.id) ? 'border-neon-violet bg-neon-violet/15' : 'border-white/15'}`}>
              <input type="checkbox" checked={who.includes(p.id)} onChange={() => setWho(who.includes(p.id) ? who.filter((x) => x !== p.id) : [...who, p.id])} />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mb-4 flex gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />
        Confirmo que es proporcional, que la familia la conoce y que no afecta comida, sueño, descanso, educación ni afecto.
      </label>
      <Button
        className="w-full"
        disabled={!valid}
        onClick={async () => {
          const ok = await run(
            () => api.createConsequence({ actorId: active.id, name, description, thresholdCoins: Number(threshold), appliesTo: who, confirmNoEssentials: confirm }),
            'Consecuencia creada',
          )
          if (ok) onClose()
        }}
      >
        Crear consecuencia
      </Button>
    </Modal>
  )
}

// ---------- Ajustes ----------

function Settings() {
  const { snap, active, api, run } = useApp()
  const [coins, setCoins] = useState(snap?.family.startingCoins ?? 0)
  const [pin, setPin] = useState('')
  if (!snap || !active) return null
  const actorId = active.id
  const solo = snap.family.kind === 'solo'

  return (
    <div className="grid gap-4">
      {!solo && (
        <Card>
          <h2 className="font-display font-bold uppercase tracking-widest">Mi modo de uso</h2>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active.playsGame} onChange={(e) => run(() => api.setPlaysGame({ actorId, playsGame: e.target.checked }), e.target.checked ? 'Ahora también juegas' : 'Ahora sólo administras')} />
            Además de administrar, quiero jugar con mi propio avatar
          </label>
          <p className="mt-1 text-xs text-slate-500">Puedes cambiarlo cuando quieras sin perder la información de tu familia.</p>
        </Card>
      )}
      {!solo && (
        <Card>
          <h2 className="font-display font-bold uppercase tracking-widest">LIFECOINS de bienvenida</h2>
          <p className="text-xs text-slate-500">Se entregan a cada jugador nuevo.</p>
          <div className="mt-2 flex gap-2">
            <input aria-label="Monedas iniciales" type="number" min={0} max={1000} className={`${inputCls} !w-28`} value={coins} onChange={(e) => setCoins(Number(e.target.value))} />
            <Button small onClick={() => run(() => api.setStartingCoins({ actorId, coins }), 'Guardado')}>
              Guardar
            </Button>
          </div>
        </Card>
      )}
      {!solo && (
        <Card>
          <h2 className="font-display font-bold uppercase tracking-widest">PIN de adulto</h2>
          <p className="text-xs text-slate-500">Protege el regreso al modo adulto cuando un niño está jugando en este dispositivo. {active.pinHash ? 'Ya tienes un PIN.' : 'Aún no has definido uno.'}</p>
          <div className="mt-2 flex gap-2">
            <input aria-label="Nuevo PIN" inputMode="numeric" type="password" maxLength={8} placeholder="4 a 8 dígitos" className={`${inputCls} !w-40`} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <Button small disabled={pin.length < 4} onClick={() => run(() => api.setPin({ actorId, pin }), 'PIN guardado').then(() => setPin(''))}>
              Guardar PIN
            </Button>
            {active.pinHash && (
              <Button tone="ghost" small onClick={() => run(() => api.setPin({ actorId, pin: null }), 'PIN eliminado')}>
                Quitar
              </Button>
            )}
          </div>
        </Card>
      )}
      <Card>
        <h2 className="font-display font-bold uppercase tracking-widest">Registro de actividad</h2>
        <ul className="mt-2 grid gap-1 text-sm text-slate-400">
          {[...snap.audit].reverse().slice(0, 25).map((a) => (
            <li key={a.id}>
              <span className="text-slate-500">{fmtDate(a.at)}</span> · {nameOf(snap, a.actorId)} · {a.action} {a.detail && `— ${a.detail}`}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
