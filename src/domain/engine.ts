/**
 * Motor de reglas de LIFEQUEST.
 *
 * Todas las funciones mutan el `Db` recibido y lanzan `DomainError` si una regla no se cumple.
 * El llamador (LocalApi) trabaja sobre una copia y sólo la confirma si no hubo errores, de modo que
 * cada operación es atómica. Las mismas reglas están implementadas en SQL en
 * supabase/migrations/0001_init.sql para el modo Supabase.
 */
import { CATALOG, DEFAULT_AVATAR, STARTER_ITEM_IDS, catalogItem } from './catalog'
import { MIN_INITIAL_REWARDS } from './rewardTemplates'
import { periodKey, toDateKey } from './recurrence'
import {
  DEFAULT_REWARDS,
  MAX_REWARD_PRICE,
  MAX_STARTING_COINS,
  REWARD_CAPS,
  levelForXp,
  totals,
} from './progression'
import {
  CATEGORIES,
  DIFFICULTIES,
  DomainError,
  type AgeBand,
  type Account,
  type Avatar,
  type Category,
  type Completion,
  type ConsequenceRule,
  type Db,
  type Difficulty,
  type Family,
  type FamilyReward,
  type Member,
  type Mission,
  type MissionKind,
  type MissionStatus,
  type Recurrence,
  type Redemption,
  type Snapshot,
} from './types'

export interface Ctx {
  now: () => Date
  id: () => string
}

export function emptyDb(): Db {
  return {
    version: 1,
    accounts: [],
    families: [],
    members: [],
    missions: [],
    completions: [],
    ledger: [],
    inventory: [],
    rewards: [],
    redemptions: [],
    consequences: [],
    audit: [],
  }
}

// ---------- utilidades ----------

const fail = (code: string, message: string): never => {
  throw new DomainError(code, message)
}

function int(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail('invalid_number', `${field} debe ser un número entero entre ${min} y ${max}.`)
  }
  return value as number
}

function text(value: unknown, min: number, max: number, field: string): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (s.length < min || s.length > max) {
    fail('invalid_text', min > 0 ? `${field} es obligatorio (máx. ${max} caracteres).` : `${field} admite hasta ${max} caracteres.`)
  }
  return s
}

const iso = (ctx: Ctx) => ctx.now().toISOString()

function log(db: Db, ctx: Ctx, familyId: string, actorId: string, action: string, refId: string | null, detail: string) {
  db.audit.push({ id: ctx.id(), familyId, actorId, action, refId, detail, at: iso(ctx) })
}

function familyCode(ctx: Ctx): string {
  // Legible y sin caracteres ambiguos; derivado del generador de ids del sistema.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const raw = ctx.id().replace(/[^a-z0-9]/gi, '')
  let out = ''
  for (let i = 0; i < 8; i++) out += alphabet[raw.charCodeAt(i % raw.length) % alphabet.length]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

// ---------- consultas derivadas ----------

export function memberById(db: Db, id: string): Member {
  return db.members.find((m) => m.id === id) ?? fail('not_found', 'Miembro no encontrado.')
}

export interface MemberStats {
  xp: number
  coins: number
  held: number
  available: number
  level: number
}

export function memberStats(db: Pick<Db, 'ledger' | 'redemptions'>, memberId: string): MemberStats {
  const t = totals(db.ledger, memberId)
  const held = db.redemptions
    .filter((r) => r.memberId === memberId && (r.status === 'pending' || r.status === 'rescheduled'))
    .reduce((sum, r) => sum + r.price, 0)
  return { xp: t.xp, coins: t.coins, held, available: t.coins - held, level: levelForXp(t.xp) }
}

/** Resuelve quién actúa. La cuenta debe ser guardián de la familia del miembro. */
export function resolveActor(db: Db, accountId: string, memberId: string): Member {
  const m = memberById(db, memberId)
  const isGuardianOfFamily = db.members.some(
    (g) => g.familyId === m.familyId && g.accountId === accountId && g.role === 'guardian',
  )
  if (!isGuardianOfFamily) fail('forbidden', 'Esta cuenta no tiene acceso a ese perfil.')
  return m
}

function requireGuardian(actor: Member) {
  if (actor.role !== 'guardian') fail('forbidden', 'Sólo un adulto administrador puede hacer esto.')
}

function requirePlayer(actor: Member) {
  if (!actor.playsGame) fail('not_player', 'Este perfil sólo administra; no participa como jugador.')
}

function sameFamily(a: Member, familyId: string) {
  if (a.familyId !== familyId) fail('forbidden', 'Ese elemento pertenece a otra familia.')
}

// ---------- cuentas y familias ----------

export function registerAccount(db: Db, ctx: Ctx, input: { email: string; passwordHash: string; salt: string }): Account {
  const email = input.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('invalid_email', 'Correo no válido.')
  if (db.accounts.some((a) => a.email === email)) fail('email_taken', 'Ya existe una cuenta con ese correo.')
  const account: Account = { id: ctx.id(), email, passwordHash: input.passwordHash, salt: input.salt, createdAt: iso(ctx) }
  db.accounts.push(account)
  return account
}

function hasMembership(db: Db, accountId: string): boolean {
  return db.members.some((m) => m.accountId === accountId)
}

function newMember(
  db: Db,
  ctx: Ctx,
  family: Family,
  p: { accountId: string | null; role: Member['role']; name: string; ageBand: AgeBand; playsGame: boolean },
): Member {
  const member: Member = {
    id: ctx.id(),
    familyId: family.id,
    accountId: p.accountId,
    role: p.role,
    name: text(p.name, 1, 24, 'El nombre'),
    ageBand: p.ageBand,
    playsGame: p.playsGame,
    avatar: { ...DEFAULT_AVATAR },
    interests: [],
    goals: [],
    pinHash: null,
    createdAt: iso(ctx),
  }
  db.members.push(member)
  for (const itemId of STARTER_ITEM_IDS) {
    db.inventory.push({ memberId: member.id, itemId, equipped: false, acquiredAt: iso(ctx) })
  }
  if (p.playsGame && family.startingCoins > 0) {
    db.ledger.push({
      id: ctx.id(), memberId: member.id, xp: 0, coins: family.startingCoins, reason: 'Bienvenida a LIFEQUEST',
      refType: 'welcome', refId: 'welcome', actorId: member.id, createdAt: iso(ctx),
    })
  }
  return member
}

export function createSolo(db: Db, ctx: Ctx, accountId: string, input: { name: string }) {
  if (hasMembership(db, accountId)) fail('already_set_up', 'Esta cuenta ya tiene una aventura.')
  const family: Family = {
    id: ctx.id(), kind: 'solo', name: text(input.name, 1, 24, 'El nombre'), code: familyCode(ctx),
    inviteCode: null, inviteExpiresAt: null, startingCoins: 50, rewardsSetupDone: false, createdAt: iso(ctx),
  }
  db.families.push(family)
  const member = newMember(db, ctx, family, { accountId, role: 'guardian', name: input.name, ageBand: 'adult', playsGame: true })
  log(db, ctx, family.id, member.id, 'family.created', family.id, 'Aventura individual')
  return { family, member }
}

export function createFamily(
  db: Db,
  ctx: Ctx,
  accountId: string,
  input: { familyName: string; guardianName: string; playsGame: boolean },
) {
  if (hasMembership(db, accountId)) fail('already_set_up', 'Esta cuenta ya pertenece a una familia.')
  const family: Family = {
    id: ctx.id(), kind: 'family', name: text(input.familyName, 1, 40, 'El nombre de la familia'), code: familyCode(ctx),
    inviteCode: null, inviteExpiresAt: null, startingCoins: 50, rewardsSetupDone: false, createdAt: iso(ctx),
  }
  db.families.push(family)
  const member = newMember(db, ctx, family, {
    accountId, role: 'guardian', name: input.guardianName, ageBand: 'adult', playsGame: input.playsGame,
  })
  log(db, ctx, family.id, member.id, 'family.created', family.id, family.name)
  return { family, member }
}

const INVITE_HOURS = 48

export function createInvite(db: Db, ctx: Ctx, actor: Member): string {
  requireGuardian(actor)
  const family = db.families.find((f) => f.id === actor.familyId)!
  if (family.kind === 'solo') fail('solo', 'Una aventura individual no admite invitados.')
  const guardians = db.members.filter((m) => m.familyId === family.id && m.role === 'guardian').length
  if (guardians >= 2) fail('limit', 'Una familia admite como máximo dos adultos administradores.')
  family.inviteCode = familyCode(ctx)
  family.inviteExpiresAt = new Date(ctx.now().getTime() + INVITE_HOURS * 3600_000).toISOString()
  log(db, ctx, family.id, actor.id, 'family.invite', null, 'Invitación para segundo adulto')
  return family.inviteCode
}

export function joinFamily(db: Db, ctx: Ctx, accountId: string, input: { inviteCode: string; name: string; playsGame: boolean }) {
  if (hasMembership(db, accountId)) fail('already_set_up', 'Esta cuenta ya pertenece a una familia.')
  const code = input.inviteCode.trim().toUpperCase()
  const family = db.families.find((f) => f.inviteCode !== null && f.inviteCode === code)
  if (!family || !family.inviteExpiresAt || new Date(family.inviteExpiresAt) < ctx.now()) {
    fail('invalid_invite', 'La invitación no es válida o expiró.')
  }
  const f = family as Family
  const guardians = db.members.filter((m) => m.familyId === f.id && m.role === 'guardian').length
  if (guardians >= 2) fail('limit', 'Esa familia ya tiene dos adultos administradores.')
  const member = newMember(db, ctx, f, { accountId, role: 'guardian', name: input.name, ageBand: 'adult', playsGame: input.playsGame })
  f.inviteCode = null
  f.inviteExpiresAt = null
  log(db, ctx, f.id, member.id, 'family.joined', member.id, 'Segundo adulto se unió')
  return { family: f, member }
}

export function addChild(db: Db, ctx: Ctx, actor: Member, input: { name: string; ageBand: AgeBand }): Member {
  requireGuardian(actor)
  const family = db.families.find((f) => f.id === actor.familyId)!
  if (family.kind === 'solo') fail('solo', 'Crea una familia para añadir niños.')
  if (!['kid', 'teen'].includes(input.ageBand)) fail('invalid_age', 'Rango de edad no válido.')
  const child = newMember(db, ctx, family, { accountId: null, role: 'child', name: input.name, ageBand: input.ageBand, playsGame: true })
  log(db, ctx, family.id, actor.id, 'child.added', child.id, child.name)
  return child
}

export function setPlaysGame(db: Db, ctx: Ctx, actor: Member, playsGame: boolean) {
  requireGuardian(actor)
  const family = db.families.find((f) => f.id === actor.familyId)!
  if (family.kind === 'solo' && !playsGame) fail('solo', 'En una aventura individual siempre juegas.')
  const was = actor.playsGame
  actor.playsGame = playsGame
  // Al empezar a jugar por primera vez recibe sus monedas de bienvenida (una sola vez por idempotencia).
  if (playsGame && !was && !db.ledger.some((e) => e.memberId === actor.id && e.refType === 'welcome') && family.startingCoins > 0) {
    db.ledger.push({
      id: ctx.id(), memberId: actor.id, xp: 0, coins: family.startingCoins, reason: 'Bienvenida a LIFEQUEST',
      refType: 'welcome', refId: 'welcome', actorId: actor.id, createdAt: iso(ctx),
    })
  }
  log(db, ctx, actor.familyId, actor.id, 'guardian.mode', actor.id, playsGame ? 'administra y juega' : 'sólo administra')
}

export function setStartingCoins(db: Db, ctx: Ctx, actor: Member, coins: number) {
  requireGuardian(actor)
  const family = db.families.find((f) => f.id === actor.familyId)!
  family.startingCoins = int(coins, 0, MAX_STARTING_COINS, 'Las monedas iniciales')
  log(db, ctx, family.id, actor.id, 'family.settings', null, `Monedas iniciales: ${family.startingCoins}`)
}

export function setPin(actor: Member, pinHash: string | null) {
  requireGuardian(actor)
  actor.pinHash = pinHash
}

export interface CharacterPatch {
  name?: string
  avatar?: Partial<Pick<Avatar, 'style' | 'color' | 'hair' | 'outfit'>>
  interests?: string[]
  goals?: string[]
}

export function updateCharacter(db: Db, actor: Member, memberId: string, patch: CharacterPatch) {
  const target = memberById(db, memberId)
  sameFamily(actor, target.familyId)
  if (actor.id !== target.id && actor.role !== 'guardian') fail('forbidden', 'Sólo puedes editar tu propio personaje.')
  if (patch.name !== undefined) target.name = text(patch.name, 1, 24, 'El nombre')
  if (patch.avatar) {
    const a = patch.avatar
    if (a.style && ['runner', 'mage', 'engineer', 'scout'].includes(a.style)) target.avatar.style = a.style
    if (a.color && /^#[0-9a-fA-F]{6}$/.test(a.color)) target.avatar.color = a.color
    if (a.hair) target.avatar.hair = text(a.hair, 1, 20, 'El peinado')
    if (a.outfit) target.avatar.outfit = text(a.outfit, 1, 20, 'La ropa')
  }
  if (patch.interests) target.interests = patch.interests.slice(0, 8).map((s) => text(s, 1, 40, 'Interés'))
  if (patch.goals) target.goals = patch.goals.slice(0, 8).map((s) => text(s, 1, 60, 'Objetivo'))
}

// ---------- misiones ----------

export interface MissionInput {
  title: string
  description?: string
  category: Category
  difficulty: Difficulty
  kind?: MissionKind
  xp?: number
  coins?: number
  initiativeXp?: number
  initiativeCoins?: number
  estimatedMinutes?: number
  criteria?: string
  recurrence?: Recurrence
  assigneeIds: string[]
  requiresApproval?: boolean
}

function validateRecurrence(r: Recurrence | undefined): Recurrence {
  if (!r) return { type: 'once' }
  if (r.type === 'days') {
    const days = [...new Set(r.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    if (days.length === 0) fail('invalid_recurrence', 'Elige al menos un día de la semana.')
    return { type: 'days', days: days.sort() }
  }
  if (['once', 'daily', 'weekly'].includes(r.type)) return { type: r.type } as Recurrence
  return fail('invalid_recurrence', 'Recurrencia no válida.')
}

function missionFields(input: MissionInput, family: Family, db: Db) {
  const difficulty = DIFFICULTIES.includes(input.difficulty) ? input.difficulty : (fail('invalid_difficulty', 'Dificultad no válida.') as never)
  const category = CATEGORIES.includes(input.category) ? input.category : (fail('invalid_category', 'Categoría no válida.') as never)
  const caps = REWARD_CAPS[difficulty]
  const defaults = DEFAULT_REWARDS[difficulty]
  const assigneeIds = [...new Set(input.assigneeIds)]
  if (assigneeIds.length === 0) fail('no_assignee', 'Asigna la misión al menos a un jugador.')
  for (const id of assigneeIds) {
    const m = memberById(db, id)
    sameFamily(m, family.id)
    if (!m.playsGame) fail('not_player', `${m.name} no participa como jugador.`)
  }
  return {
    title: text(input.title, 1, 80, 'El nombre de la misión'),
    description: text(input.description ?? '', 0, 500, 'La descripción'),
    category,
    difficulty,
    kind: input.kind ?? 'custom',
    xp: int(input.xp ?? defaults.xp, 0, caps.xp, 'Los XP'),
    coins: int(input.coins ?? defaults.coins, 0, caps.coins, 'Los LIFECOINS'),
    initiativeXp: int(input.initiativeXp ?? 0, 0, caps.xp, 'El bono de XP'),
    initiativeCoins: int(input.initiativeCoins ?? 0, 0, caps.coins, 'El bono de LIFECOINS'),
    estimatedMinutes: int(input.estimatedMinutes ?? 10, 0, 600, 'El tiempo estimado'),
    criteria: text(input.criteria ?? '', 0, 300, 'Las condiciones'),
    recurrence: validateRecurrence(input.recurrence),
    assigneeIds,
    // En una aventura individual no hay a quién pedirle revisión.
    requiresApproval: family.kind === 'solo' ? false : input.requiresApproval ?? true,
  }
}

export function createMission(db: Db, ctx: Ctx, actor: Member, input: MissionInput): Mission {
  const family = db.families.find((f) => f.id === actor.familyId)!
  if (actor.role === 'child') {
    // Los niños sólo proponen, y sólo para sí mismos (§181, §184).
    if (input.assigneeIds.length !== 1 || input.assigneeIds[0] !== actor.id) fail('forbidden', 'Sólo puedes proponer misiones para ti.')
  } else {
    requireGuardian(actor)
  }
  const fields = missionFields(input, family, db)
  const status: MissionStatus = actor.role === 'guardian' ? 'active' : 'proposed'
  const mission: Mission = {
    id: ctx.id(), familyId: family.id, ...fields, status, createdBy: actor.id, createdAt: iso(ctx),
    reviewedBy: null, reviewedAt: null, reviewNote: null,
  }
  db.missions.push(mission)
  log(db, ctx, family.id, actor.id, status === 'proposed' ? 'mission.proposed' : 'mission.created', mission.id, mission.title)
  return mission
}

export function reviewMissionProposal(
  db: Db,
  ctx: Ctx,
  actor: Member,
  missionId: string,
  decision: 'approve' | 'reject',
  opts: { note?: string; edits?: Partial<MissionInput> } = {},
) {
  requireGuardian(actor)
  const mission = db.missions.find((m) => m.id === missionId) ?? fail('not_found', 'Misión no encontrada.')
  sameFamily(actor, mission.familyId)
  if (mission.status !== 'proposed') fail('not_proposal', 'Esta misión no está pendiente de revisión.')
  if (decision === 'approve') {
    if (opts.edits) Object.assign(mission, editedFields(db, mission, opts.edits))
    mission.status = 'active'
  } else {
    mission.status = 'rejected'
  }
  mission.reviewedBy = actor.id
  mission.reviewedAt = iso(ctx)
  mission.reviewNote = opts.note ? text(opts.note, 0, 300, 'La nota') : null
  log(db, ctx, mission.familyId, actor.id, decision === 'approve' ? 'mission.approved' : 'mission.rejected', mission.id, mission.title)
}

function editedFields(db: Db, mission: Mission, edits: Partial<MissionInput>) {
  const family = db.families.find((f) => f.id === mission.familyId)!
  const merged: MissionInput = {
    title: mission.title, description: mission.description, category: mission.category, difficulty: mission.difficulty,
    kind: mission.kind, xp: mission.xp, coins: mission.coins, initiativeXp: mission.initiativeXp,
    initiativeCoins: mission.initiativeCoins, estimatedMinutes: mission.estimatedMinutes, criteria: mission.criteria,
    recurrence: mission.recurrence, assigneeIds: mission.assigneeIds, requiresApproval: mission.requiresApproval,
    ...edits,
  }
  return missionFields(merged, family, db)
}

/** Modificar una misión no cambia lo ya otorgado: las recompensas pasadas viven en el ledger (§193). */
export function updateMission(db: Db, ctx: Ctx, actor: Member, missionId: string, edits: Partial<MissionInput>) {
  requireGuardian(actor)
  const mission = db.missions.find((m) => m.id === missionId) ?? fail('not_found', 'Misión no encontrada.')
  sameFamily(actor, mission.familyId)
  Object.assign(mission, editedFields(db, mission, edits))
  log(db, ctx, mission.familyId, actor.id, 'mission.updated', mission.id, mission.title)
}

export function setMissionStatus(db: Db, ctx: Ctx, actor: Member, missionId: string, status: 'active' | 'suspended' | 'archived') {
  requireGuardian(actor)
  const mission = db.missions.find((m) => m.id === missionId) ?? fail('not_found', 'Misión no encontrada.')
  sameFamily(actor, mission.familyId)
  if (mission.status === 'proposed' || mission.status === 'rejected') fail('invalid_state', 'Primero revisa la propuesta.')
  mission.status = status
  log(db, ctx, mission.familyId, actor.id, `mission.${status}`, mission.id, mission.title)
}

// ---------- realización y recompensas ----------

function grant(
  db: Db,
  ctx: Ctx,
  p: { memberId: string; xp: number; coins: number; reason: string; refType: 'completion' | 'purchase' | 'redemption' | 'refund' | 'correction'; refId: string; actorId: string },
): boolean {
  if (db.ledger.some((e) => e.memberId === p.memberId && e.refType === p.refType && e.refId === p.refId)) return false
  db.ledger.push({ id: ctx.id(), createdAt: iso(ctx), ...p })
  return true
}

function approveCompletion(db: Db, ctx: Ctx, completion: Completion, mission: Mission, reviewer: Member, initiative: boolean, note: string | null) {
  completion.status = 'approved'
  completion.reviewedBy = reviewer.id
  completion.reviewedAt = iso(ctx)
  completion.initiative = initiative
  completion.note = note
  const bonusXp = initiative ? mission.initiativeXp : 0
  const bonusCoins = initiative ? mission.initiativeCoins : 0
  grant(db, ctx, {
    memberId: completion.memberId,
    xp: mission.xp + bonusXp,
    coins: mission.coins + bonusCoins,
    reason: initiative ? `${mission.title} (con iniciativa)` : mission.title,
    refType: 'completion',
    refId: completion.id,
    actorId: reviewer.id,
  })
}

export function completeMission(
  db: Db,
  ctx: Ctx,
  actor: Member,
  input: { missionId: string; memberId: string; dateKey?: string },
): Completion {
  const mission = db.missions.find((m) => m.id === input.missionId) ?? fail('not_found', 'Misión no encontrada.')
  const target = memberById(db, input.memberId)
  sameFamily(actor, mission.familyId)
  sameFamily(target, mission.familyId)
  if (actor.id !== target.id && actor.role !== 'guardian') fail('forbidden', 'Sólo puedes completar tus propias misiones.')
  requirePlayer(target)
  if (mission.status !== 'active') fail('inactive', 'Esta misión no está activa.')
  if (!mission.assigneeIds.includes(target.id)) fail('not_assigned', 'La misión no está asignada a este jugador.')

  const today = toDateKey(ctx.now())
  const dateKey = input.dateKey ?? today
  if (dateKey > today) fail('future', 'No se puede completar una misión en el futuro.')
  if (actor.role === 'child' && dateKey !== today) fail('forbidden', 'Sólo puedes completar misiones de hoy.')
  const key = periodKey(mission, dateKey)
  if (key === null) fail('not_due', 'Esta misión no toca ese día.')

  const existing = db.completions.find((c) => c.missionId === mission.id && c.memberId === target.id && c.periodKey === key)
  if (existing && existing.status !== 'rejected') fail('duplicate', 'Esta misión ya fue registrada para este periodo.')

  const autoApprove = actor.role === 'guardian' || !mission.requiresApproval
  const completion: Completion = existing ?? {
    id: ctx.id(), missionId: mission.id, memberId: target.id, periodKey: key as string, status: 'pending',
    completedBy: actor.id, completedAt: iso(ctx), reviewedBy: null, reviewedAt: null, note: null, initiative: false,
  }
  if (existing) {
    // Reenvío tras un rechazo: se reutiliza la misma fila y se reinicia el flujo.
    Object.assign(completion, { status: 'pending', completedBy: actor.id, completedAt: iso(ctx), reviewedBy: null, reviewedAt: null, note: null })
  } else {
    db.completions.push(completion)
  }
  if (autoApprove) approveCompletion(db, ctx, completion, mission, actor, false, null)
  log(db, ctx, mission.familyId, actor.id, autoApprove ? 'completion.approved' : 'completion.submitted', completion.id, mission.title)
  return completion
}

export function reviewCompletion(
  db: Db,
  ctx: Ctx,
  actor: Member,
  completionId: string,
  decision: 'approve' | 'reject',
  opts: { note?: string; initiative?: boolean } = {},
) {
  requireGuardian(actor)
  const completion = db.completions.find((c) => c.id === completionId) ?? fail('not_found', 'Registro no encontrado.')
  const mission = db.missions.find((m) => m.id === completion.missionId)!
  sameFamily(actor, mission.familyId)
  if (completion.status !== 'pending') fail('already_reviewed', 'Esta misión ya fue revisada.')
  const note = opts.note ? text(opts.note, 0, 300, 'La nota') : null
  if (decision === 'approve') {
    approveCompletion(db, ctx, completion, mission, actor, !!opts.initiative, note)
  } else {
    completion.status = 'rejected'
    completion.reviewedBy = actor.id
    completion.reviewedAt = iso(ctx)
    completion.note = note
  }
  log(db, ctx, mission.familyId, actor.id, `completion.${decision === 'approve' ? 'approved' : 'rejected'}`, completion.id, mission.title)
}

/** Corrección justificada y registrada de XP/monedas (§124). Nunca deja saldos negativos. */
export function correctLedger(db: Db, ctx: Ctx, actor: Member, memberId: string, input: { xp: number; coins: number; reason: string }) {
  requireGuardian(actor)
  const target = memberById(db, memberId)
  sameFamily(actor, target.familyId)
  const reason = text(input.reason, 3, 200, 'El motivo')
  const xp = int(input.xp, -100_000, 100_000, 'XP')
  const coins = int(input.coins, -100_000, 100_000, 'LIFECOINS')
  const s = memberStats(db, target.id)
  if (s.xp + xp < 0 || s.available + coins < 0) fail('negative_balance', 'La corrección dejaría un saldo negativo.')
  grant(db, ctx, { memberId: target.id, xp, coins, reason: `Corrección: ${reason}`, refType: 'correction', refId: ctx.id(), actorId: actor.id })
  log(db, ctx, target.familyId, actor.id, 'ledger.correction', target.id, reason)
}

// ---------- tienda digital ----------

export function buyCatalogItem(db: Db, ctx: Ctx, actor: Member, itemId: string) {
  requirePlayer(actor)
  const item = catalogItem(itemId) ?? fail('not_found', 'Artículo no encontrado.')
  if (db.inventory.some((i) => i.memberId === actor.id && i.itemId === itemId)) fail('owned', 'Ya tienes este artículo.')
  const stats = memberStats(db, actor.id)
  if (stats.level < item!.minLevel) fail('level_required', `Necesitas nivel ${item!.minLevel}.`)
  if (stats.available < item!.price) fail('insufficient_funds', 'No tienes LIFECOINS suficientes.')
  grant(db, ctx, {
    memberId: actor.id, xp: 0, coins: -item!.price, reason: `Compra: ${item!.name}`,
    refType: 'purchase', refId: item!.id, actorId: actor.id,
  })
  db.inventory.push({ memberId: actor.id, itemId: item!.id, equipped: false, acquiredAt: iso(ctx) })
}

/** Equipa un artículo ya poseído; si ya estaba equipado, lo quita. El avatar refleja el cambio. */
export function equipItem(db: Db, actor: Member, memberId: string, itemId: string) {
  const target = memberById(db, memberId)
  sameFamily(actor, target.familyId)
  if (actor.id !== target.id && actor.role !== 'guardian') fail('forbidden', 'Sólo puedes cambiar tu propio personaje.')
  const item = catalogItem(itemId) ?? fail('not_found', 'Artículo no encontrado.')
  const owned = db.inventory.find((i) => i.memberId === target.id && i.itemId === itemId)
  if (!owned) fail('not_owned', 'Aún no tienes este artículo.')
  const slot = item!.slot
  const wasEquipped = owned!.equipped
  for (const inv of db.inventory) {
    if (inv.memberId === target.id && catalogItem(inv.itemId)?.slot === slot) inv.equipped = false
  }
  owned!.equipped = !wasEquipped
  const value = owned!.equipped ? item!.value : null
  if (slot === 'accessory') target.avatar.accessory = value
  else if (slot === 'background') target.avatar.background = value
  else if (slot === 'frame') target.avatar.frame = value
  else target.avatar.title = value
}

// ---------- recompensas familiares ----------

export function createReward(
  db: Db,
  ctx: Ctx,
  actor: Member,
  input: { name: string; description?: string; price: number; conditions?: string },
): FamilyReward {
  const family = db.families.find((f) => f.id === actor.familyId)!
  const status = actor.role === 'guardian' ? 'approved' : 'proposed'
  const reward: FamilyReward = {
    id: ctx.id(), familyId: family.id, name: text(input.name, 1, 60, 'El nombre'),
    description: text(input.description ?? '', 0, 300, 'La descripción'),
    price: int(input.price, 0, MAX_REWARD_PRICE, 'El precio'),
    conditions: text(input.conditions ?? '', 0, 300, 'Las condiciones'),
    status, createdBy: actor.id, createdAt: iso(ctx), reviewedBy: status === 'approved' ? actor.id : null,
  }
  db.rewards.push(reward)
  log(db, ctx, family.id, actor.id, status === 'proposed' ? 'reward.proposed' : 'reward.created', reward.id, reward.name)
  return reward
}

export function reviewReward(
  db: Db,
  ctx: Ctx,
  actor: Member,
  rewardId: string,
  decision: 'approve' | 'reject',
  edits: { name?: string; price?: number; conditions?: string } = {},
) {
  requireGuardian(actor)
  const reward = db.rewards.find((r) => r.id === rewardId) ?? fail('not_found', 'Recompensa no encontrada.')
  sameFamily(actor, reward.familyId)
  if (reward.status !== 'proposed') fail('not_proposal', 'Esta recompensa no está pendiente de revisión.')
  if (edits.name !== undefined) reward.name = text(edits.name, 1, 60, 'El nombre')
  if (edits.price !== undefined) reward.price = int(edits.price, 0, MAX_REWARD_PRICE, 'El precio')
  if (edits.conditions !== undefined) reward.conditions = text(edits.conditions, 0, 300, 'Las condiciones')
  reward.status = decision === 'approve' ? 'approved' : 'rejected'
  reward.reviewedBy = actor.id
  log(db, ctx, reward.familyId, actor.id, `reward.${reward.status}`, reward.id, reward.name)
}

export function archiveReward(db: Db, ctx: Ctx, actor: Member, rewardId: string) {
  requireGuardian(actor)
  const reward = db.rewards.find((r) => r.id === rewardId) ?? fail('not_found', 'Recompensa no encontrada.')
  sameFamily(actor, reward.familyId)
  reward.status = 'archived'
  log(db, ctx, reward.familyId, actor.id, 'reward.archived', reward.id, reward.name)
}

export function requestRedemption(db: Db, ctx: Ctx, actor: Member, rewardId: string): Redemption {
  requirePlayer(actor)
  const reward = db.rewards.find((r) => r.id === rewardId) ?? fail('not_found', 'Recompensa no encontrada.')
  sameFamily(actor, reward.familyId)
  if (reward.status !== 'approved') fail('unavailable', 'Esta recompensa no está disponible.')
  const stats = memberStats(db, actor.id)
  // Las monedas ya reservadas por otros canjes pendientes no se pueden volver a usar.
  if (stats.available < reward.price) fail('insufficient_funds', 'No tienes LIFECOINS suficientes.')
  const redemption: Redemption = {
    id: ctx.id(), familyId: reward.familyId, rewardId: reward.id, memberId: actor.id, price: reward.price,
    status: 'pending', note: null, scheduledFor: null, requestedAt: iso(ctx), reviewedBy: null, reviewedAt: null,
  }
  db.redemptions.push(redemption)
  log(db, ctx, reward.familyId, actor.id, 'redemption.requested', redemption.id, reward.name)
  return redemption
}

export function reviewRedemption(
  db: Db,
  ctx: Ctx,
  actor: Member,
  redemptionId: string,
  decision: 'approve' | 'reject' | 'reschedule',
  opts: { note?: string; scheduledFor?: string } = {},
) {
  requireGuardian(actor)
  const r = db.redemptions.find((x) => x.id === redemptionId) ?? fail('not_found', 'Canje no encontrado.')
  sameFamily(actor, r.familyId)
  const note = opts.note ? text(opts.note, 0, 300, 'La nota') : null

  if (decision === 'reschedule') {
    if (!opts.scheduledFor || !/^\d{4}-\d{2}-\d{2}$/.test(opts.scheduledFor)) fail('invalid_date', 'Indica la nueva fecha.')
    if (!['pending', 'rescheduled', 'approved'].includes(r.status)) fail('invalid_state', 'Este canje ya no se puede reprogramar.')
    // Un canje ya aprobado conserva su estado (las monedas ya se descontaron); sólo cambia la fecha.
    if (r.status !== 'approved') r.status = 'rescheduled'
    r.scheduledFor = opts.scheduledFor as string
    r.note = note
  } else {
    if (r.status !== 'pending' && r.status !== 'rescheduled') fail('already_reviewed', 'Este canje ya fue resuelto.')
    if (decision === 'reject') {
      // Rechazar exige explicación (§141); las monedas nunca se descontaron, sólo estaban retenidas.
      if (!note) fail('note_required', 'Explica el motivo del rechazo.')
      r.status = 'rejected'
      r.note = note
    } else {
      if (totals(db.ledger, r.memberId).coins < r.price) fail('insufficient_funds', 'El jugador ya no tiene LIFECOINS suficientes.')
      const reward = db.rewards.find((x) => x.id === r.rewardId)!
      grant(db, ctx, { memberId: r.memberId, xp: 0, coins: 0 - r.price, reason: `Canje: ${reward.name}`, refType: 'redemption', refId: r.id, actorId: actor.id })
      r.status = 'approved'
      r.note = note
    }
    r.reviewedBy = actor.id
    r.reviewedAt = iso(ctx)
  }
  log(db, ctx, r.familyId, actor.id, `redemption.${decision}`, r.id, decision)
}

export function refundRedemption(db: Db, ctx: Ctx, actor: Member, redemptionId: string, note?: string) {
  requireGuardian(actor)
  const r = db.redemptions.find((x) => x.id === redemptionId) ?? fail('not_found', 'Canje no encontrado.')
  sameFamily(actor, r.familyId)
  if (r.status !== 'approved') fail('invalid_state', 'Sólo se devuelve un canje aprobado.')
  const reward = db.rewards.find((x) => x.id === r.rewardId)!
  grant(db, ctx, { memberId: r.memberId, xp: 0, coins: r.price, reason: `Devolución: ${reward.name}`, refType: 'refund', refId: r.id, actorId: actor.id })
  r.status = 'refunded'
  r.note = note ? text(note, 0, 300, 'La nota') : r.note
  r.reviewedAt = iso(ctx)
  log(db, ctx, r.familyId, actor.id, 'redemption.refunded', r.id, reward.name)
}


// ---------- lista inicial de recompensas ----------

export interface RewardInput {
  name: string
  description?: string
  price: number
  conditions?: string
}

/**
 * Obligatorio al empezar: el adulto elige como mínimo MIN_INITIAL_REWARDS recompensas (algunas pueden costar 0).
 * Puede añadir todas las que quiera, y después más desde la tienda. Todas se pueden canjear las veces que se
 * quiera mientras el jugador tenga monedas disponibles.
 */
export function setupRewards(db: Db, ctx: Ctx, actor: Member, items: RewardInput[]): FamilyReward[] {
  requireGuardian(actor)
  const family = db.families.find((f) => f.id === actor.familyId)!
  if (family.rewardsSetupDone) fail('already_done', 'La lista inicial de recompensas ya está configurada.')
  if (!Array.isArray(items) || items.length < MIN_INITIAL_REWARDS) {
    fail('too_few_rewards', `Elige al menos ${MIN_INITIAL_REWARDS} recompensas para empezar.`)
  }
  const seen = new Set<string>()
  const created: FamilyReward[] = []
  for (const it of items) {
    const name = text(it.name, 1, 60, 'El nombre')
    const key = name.toLowerCase()
    if (seen.has(key)) fail('duplicate_reward', `La recompensa «${name}» está repetida.`)
    seen.add(key)
    created.push({
      id: ctx.id(), familyId: family.id, name, description: text(it.description ?? '', 0, 300, 'La descripción'),
      price: int(it.price, 0, MAX_REWARD_PRICE, 'El precio'), conditions: text(it.conditions ?? '', 0, 300, 'Las condiciones'),
      status: 'approved', createdBy: actor.id, createdAt: iso(ctx), reviewedBy: actor.id,
    })
  }
  db.rewards.push(...created)
  family.rewardsSetupDone = true
  log(db, ctx, family.id, actor.id, 'rewards.setup', null, `${created.length} recompensas iniciales`)
  return created
}

// ---------- consecuencias acordadas ----------

/** Raíces (sin tildes) de palabras que indican una necesidad básica: no se pueden usar como consecuencia (§122). */
const ESSENTIAL_PREFIXES = [
  'comer', 'comid', 'cena', 'desayun', 'almuerz', 'merienda', 'dorm', 'sueno', 'descans', 'colegio', 'escuela',
  'medicin', 'medicament', 'higien', 'banar', 'abrazo', 'carino', 'afecto',
]
const ESSENTIAL_EXACT = ['agua', 'come', 'comes']

export function touchesEssentialNeeds(s: string): boolean {
  const tokens = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return tokens.some((t) => ESSENTIAL_EXACT.includes(t) || ESSENTIAL_PREFIXES.some((p) => t.startsWith(p)))
}

export function createConsequence(
  db: Db,
  ctx: Ctx,
  actor: Member,
  input: { name: string; description?: string; thresholdCoins: number; appliesTo: string[]; confirmNoEssentials: boolean },
): ConsequenceRule {
  requireGuardian(actor)
  const family = db.families.find((f) => f.id === actor.familyId)!
  const name = text(input.name, 1, 80, 'La consecuencia')
  const description = text(input.description ?? '', 0, 300, 'La descripción')
  if (!input.confirmNoEssentials) fail('confirm_required', 'Confirma que no afecta comida, sueño, descanso, educación ni afecto.')
  if (touchesEssentialNeeds(`${name} ${description}`)) {
    fail('essential_needs', 'Una consecuencia no puede afectar comida, sueño, descanso, educación, salud ni afecto.')
  }
  const appliesTo = [...new Set(input.appliesTo)]
  if (appliesTo.length === 0) fail('no_assignee', 'Elige a quién se aplica.')
  for (const id of appliesTo) {
    const m = memberById(db, id)
    sameFamily(m, family.id)
    if (!m.playsGame) fail('not_player', `${m.name} no participa como jugador.`)
  }
  const rule: ConsequenceRule = {
    id: ctx.id(), familyId: family.id, name, description,
    thresholdCoins: int(input.thresholdCoins, 1, MAX_REWARD_PRICE, 'El umbral de monedas'),
    appliesTo, status: 'active', createdBy: actor.id, createdAt: iso(ctx),
  }
  db.consequences.push(rule)
  log(db, ctx, family.id, actor.id, 'consequence.created', rule.id, name)
  return rule
}

export function archiveConsequence(db: Db, ctx: Ctx, actor: Member, ruleId: string) {
  requireGuardian(actor)
  const rule = db.consequences.find((c) => c.id === ruleId) ?? fail('not_found', 'Consecuencia no encontrada.')
  sameFamily(actor, rule.familyId)
  rule.status = 'archived'
  log(db, ctx, rule.familyId, actor.id, 'consequence.archived', rule.id, rule.name)
}

/** Consecuencias que están activas ahora para un jugador: sus monedas disponibles están por debajo del umbral. */
export function activeConsequences(
  s: Pick<Db, 'ledger' | 'redemptions' | 'consequences'>,
  memberId: string,
): ConsequenceRule[] {
  const available = memberStats(s, memberId).available
  return s.consequences.filter((c) => c.status === 'active' && c.appliesTo.includes(memberId) && available < c.thresholdCoins)
}

// ---------- eliminación de datos ----------

function purgeMember(db: Db, memberId: string) {
  const compIds = new Set(db.completions.filter((c) => c.memberId === memberId).map((c) => c.id))
  db.completions = db.completions.filter((c) => !compIds.has(c.id))
  db.ledger = db.ledger.filter((e) => e.memberId !== memberId)
  db.inventory = db.inventory.filter((i) => i.memberId !== memberId)
  db.redemptions = db.redemptions.filter((r) => r.memberId !== memberId)
  for (const c of db.consequences) c.appliesTo = c.appliesTo.filter((id) => id !== memberId)
  db.consequences = db.consequences.filter((c) => c.appliesTo.length > 0)
  for (const m of db.missions) {
    m.assigneeIds = m.assigneeIds.filter((id) => id !== memberId)
    // Una misión sin jugadores asignados deja de tener sentido: se archiva.
    if (m.assigneeIds.length === 0 && ['proposed', 'active', 'suspended'].includes(m.status)) m.status = 'archived'
  }
  db.members = db.members.filter((m) => m.id !== memberId)
}

/** Elimina un perfil infantil y todo su progreso. */
export function removeChild(db: Db, ctx: Ctx, actor: Member, childId: string) {
  requireGuardian(actor)
  const child = memberById(db, childId)
  sameFamily(actor, child.familyId)
  if (child.role !== 'child') fail('forbidden', 'Sólo se pueden eliminar perfiles infantiles.')
  purgeMember(db, child.id)
  log(db, ctx, actor.familyId, actor.id, 'child.removed', null, child.name)
}

/**
 * Elimina la cuenta. Si era el único adulto, se borra la familia completa (hijos incluidos);
 * si hay otro adulto, la familia continúa sin esta persona.
 */
export function deleteAccount(db: Db, accountId: string) {
  const mine = db.members.find((m) => m.accountId === accountId)
  if (mine) {
    const others = db.members.filter((m) => m.familyId === mine.familyId && m.role === 'guardian' && m.id !== mine.id)
    if (others.length === 0) {
      for (const m of db.members.filter((x) => x.familyId === mine.familyId)) purgeMember(db, m.id)
      db.missions = db.missions.filter((m) => m.familyId !== mine.familyId)
      db.rewards = db.rewards.filter((r) => r.familyId !== mine.familyId)
      db.consequences = db.consequences.filter((c) => c.familyId !== mine.familyId)
      db.audit = db.audit.filter((a) => a.familyId !== mine.familyId)
      db.families = db.families.filter((f) => f.id !== mine.familyId)
    } else {
      purgeMember(db, mine.id)
    }
  }
  db.accounts = db.accounts.filter((a) => a.id !== accountId)
}

// ---------- lectura ----------

/** Todo lo que una cuenta puede ver. Nunca incluye datos de otras familias ni hashes de contraseña. */
export function snapshotFor(db: Db, accountId: string): Snapshot | null {
  const mine = db.members.find((m) => m.accountId === accountId && m.role === 'guardian')
  if (!mine) return null
  const familyId = mine.familyId
  const account = db.accounts.find((a) => a.id === accountId)!
  const members = db.members.filter((m) => m.familyId === familyId)
  const memberIds = new Set(members.map((m) => m.id))
  return {
    account: { id: account.id, email: account.email },
    family: db.families.find((f) => f.id === familyId)!,
    members: members.map((m) => ({ ...m })),
    missions: db.missions.filter((m) => m.familyId === familyId),
    completions: db.completions.filter((c) => memberIds.has(c.memberId)),
    ledger: db.ledger.filter((e) => memberIds.has(e.memberId)),
    inventory: db.inventory.filter((i) => memberIds.has(i.memberId)),
    rewards: db.rewards.filter((r) => r.familyId === familyId),
    redemptions: db.redemptions.filter((r) => r.familyId === familyId),
    consequences: db.consequences.filter((c) => c.familyId === familyId),
    audit: db.audit.filter((a) => a.familyId === familyId).slice(-200),
  }
}

export { CATALOG }
