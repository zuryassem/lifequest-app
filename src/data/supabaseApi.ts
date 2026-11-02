import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { MissionInput } from '../domain/engine'
import { DomainError, type Snapshot } from '../domain/types'
import type { LifeQuestApi, SessionInfo } from './api'
import { pbkdf2 } from './crypto'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

function toDomainError(e: { message?: string; code?: string }): Error {
  // Las funciones SQL lanzan "codigo|mensaje" con SQLSTATE P0001 (ver lq_private.fail).
  if (e.code === 'P0001' && e.message?.includes('|')) {
    const [code, ...rest] = e.message.split('|')
    return new DomainError(code, rest.join('|'))
  }
  const msg = e.message?.toLowerCase() ?? ''
  if (msg.includes('rate limit')) {
    return new DomainError('rate_limited', 'Se alcanzó el límite de correos por hora. Espera un rato e inténtalo de nuevo (el servicio de correo gratuito de Supabase envía muy pocos por hora).')
  }
  if (msg.includes('already registered')) return new DomainError('email_taken', 'Ya existe una cuenta con ese correo. Inicia sesión.')
  if (msg.includes('email not confirmed')) return new DomainError('email_unconfirmed', 'Aún no confirmaste tu correo. Revisa tu bandeja (y spam).')
  if (e.message?.toLowerCase().includes('invalid login')) return new DomainError('bad_credentials', 'Correo o contraseña incorrectos.')
  return new Error(e.message || 'No se pudo completar la operación.')
}

const missionToSql = (m: Partial<MissionInput>) => ({
  title: m.title,
  description: m.description,
  category: m.category,
  difficulty: m.difficulty,
  kind: m.kind,
  xp: m.xp,
  coins: m.coins,
  initiative_xp: m.initiativeXp,
  initiative_coins: m.initiativeCoins,
  estimated_minutes: m.estimatedMinutes,
  criteria: m.criteria,
  recurrence: m.recurrence,
  assignee_ids: m.assigneeIds,
  requires_approval: m.requiresApproval,
})

const mapMember = (r: Row) => ({
  id: r.id, familyId: r.family_id, accountId: r.account_id, role: r.role, name: r.name, ageBand: r.age_band,
  playsGame: r.plays_game, avatar: r.avatar, interests: r.interests ?? [], goals: r.goals ?? [],
  // El hash real nunca sale del servidor; sólo se sabe si existe.
  pinHash: r.has_pin ? 'set' : null, createdAt: r.created_at,
})
const mapMission = (r: Row) => ({
  id: r.id, familyId: r.family_id, title: r.title, description: r.description, category: r.category, difficulty: r.difficulty,
  kind: r.kind, xp: r.xp, coins: r.coins, initiativeXp: r.initiative_xp, initiativeCoins: r.initiative_coins,
  estimatedMinutes: r.estimated_minutes, criteria: r.criteria, recurrence: r.recurrence, assigneeIds: r.assignee_ids,
  requiresApproval: r.requires_approval, status: r.status, createdBy: r.created_by, createdAt: r.created_at,
  reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, reviewNote: r.review_note,
})
const mapCompletion = (r: Row) => ({
  id: r.id, missionId: r.mission_id, memberId: r.member_id, periodKey: r.period_key, status: r.status, completedBy: r.completed_by,
  completedAt: r.completed_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, note: r.note, initiative: r.initiative,
})
const mapLedger = (r: Row) => ({
  id: r.id, memberId: r.member_id, xp: r.xp, coins: r.coins, reason: r.reason, refType: r.ref_type, refId: r.ref_id,
  actorId: r.actor_id, createdAt: r.created_at,
})
const mapReward = (r: Row) => ({
  id: r.id, familyId: r.family_id, name: r.name, description: r.description, price: r.price, conditions: r.conditions,
  status: r.status, createdBy: r.created_by, createdAt: r.created_at, reviewedBy: r.reviewed_by,
})
const mapRedemption = (r: Row) => ({
  id: r.id, familyId: r.family_id, rewardId: r.reward_id, memberId: r.member_id, price: r.price, status: r.status, note: r.note,
  scheduledFor: r.scheduled_for, requestedAt: r.requested_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
})

/**
 * Implementación de producción: lecturas filtradas por RLS y escrituras exclusivamente mediante
 * funciones RPC (ver supabase/migrations/0001_init.sql). El navegador nunca modifica XP ni monedas.
 *
 * ⚠ Escrita contra el esquema probado con PGlite (supabase/tests), pero NO probada contra un proyecto
 * real de Supabase: hace falta crear el proyecto, aplicar la migración y definir las variables de entorno.
 */
export function createSupabaseApi(url: string, anonKey: string): LifeQuestApi {
  const sb: SupabaseClient = createClient(url, anonKey)
  let recovery = false
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true
  })

  async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await sb.rpc(fn, args)
    if (error) throw toDomainError(error)
    return data as T
  }

  async function select(table: string, build?: (q: any) => any): Promise<Row[]> {
    const q = sb.from(table).select('*')
    const { data, error } = await (build ? build(q) : q)
    if (error) throw toDomainError(error)
    return data as Row[]
  }

  const api: LifeQuestApi = {
    mode: 'supabase',

    async getSession(): Promise<SessionInfo | null> {
      const { data } = await sb.auth.getSession()
      const u = data.session?.user
      return u ? { accountId: u.id, email: u.email ?? '' } : null
    },
    async signUp(email, password) {
      if (password.length < 8) throw new DomainError('weak_password', 'La contraseña debe tener al menos 8 caracteres.')
      const { data, error } = await sb.auth.signUp({ email, password })
      if (error) throw toDomainError(error)
      if (!data.session) throw new DomainError('confirm_email', 'Te enviamos un correo: confírmalo y luego inicia sesión.')
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw toDomainError(error)
    },
    async signOut() {
      await sb.auth.signOut()
    },
    async requestPasswordReset(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
      if (error) throw toDomainError(error)
      return 'Si el correo existe, te enviamos un enlace para crear una contraseña nueva.'
    },
    isPasswordRecovery: () => recovery,
    async updatePassword(newPassword) {
      if (newPassword.length < 8) throw new DomainError('weak_password', 'La contraseña debe tener al menos 8 caracteres.')
      const { error } = await sb.auth.updateUser({ password: newPassword })
      if (error) throw toDomainError(error)
      recovery = false
    },
    async deleteAccount() {
      await rpc('lq_delete_account')
      await sb.auth.signOut()
    },

    async getSnapshot(): Promise<Snapshot | null> {
      const { data: auth } = await sb.auth.getUser()
      if (!auth.user) throw new DomainError('no_session', 'Inicia sesión para continuar.')
      const families = await select('families')
      if (families.length === 0) return null
      const [members, missions, completions, ledger, inventory, rewards, redemptions, consequences, audit] = await Promise.all([
        select('members', (q) => q.order('created_at')),
        select('missions', (q) => q.order('created_at')),
        select('completions', (q) => q.order('completed_at')),
        select('ledger', (q) => q.order('created_at')),
        select('inventory'),
        select('rewards', (q) => q.order('created_at')),
        select('redemptions', (q) => q.order('requested_at')),
        select('consequences', (q) => q.order('created_at')),
        select('audit_log', (q) => q.order('at', { ascending: false }).limit(200)),
      ])
      const f = families[0]
      return {
        account: { id: auth.user.id, email: auth.user.email ?? '' },
        family: {
          id: f.id, kind: f.kind, name: f.name, code: f.code, inviteCode: f.invite_code, inviteExpiresAt: f.invite_expires_at,
          startingCoins: f.starting_coins, rewardsSetupDone: f.rewards_setup_done, createdAt: f.created_at,
        },
        members: members.map(mapMember),
        missions: missions.map(mapMission),
        completions: completions.map(mapCompletion),
        ledger: ledger.map(mapLedger),
        inventory: inventory.map((r) => ({ memberId: r.member_id, itemId: r.item_id, equipped: r.equipped, acquiredAt: r.acquired_at })),
        rewards: rewards.map(mapReward),
        redemptions: redemptions.map(mapRedemption),
        consequences: consequences.map((r) => ({
          id: r.id, familyId: r.family_id, name: r.name, description: r.description, thresholdCoins: r.threshold_coins,
          appliesTo: r.applies_to, status: r.status, createdBy: r.created_by, createdAt: r.created_at,
        })),
        audit: audit.reverse().map((r) => ({ id: r.id, familyId: r.family_id, actorId: r.actor_id, action: r.action, refId: r.ref_id, detail: r.detail, at: r.at })),
      } as Snapshot
    },

    async createSolo({ name }) {
      await rpc('lq_create_solo', { p_name: name })
    },
    async createFamily({ familyName, guardianName, playsGame }) {
      await rpc('lq_create_family', { p_family_name: familyName, p_guardian_name: guardianName, p_plays_game: playsGame })
    },
    async joinFamily({ inviteCode, name, playsGame }) {
      await rpc('lq_join_family', { p_invite_code: inviteCode, p_name: name, p_plays_game: playsGame })
    },

    async addChild({ actorId, name, ageBand }) {
      await rpc('lq_add_child', { p_actor: actorId, p_name: name, p_age_band: ageBand })
    },
    async removeChild({ actorId, childId }) {
      await rpc('lq_remove_child', { p_actor: actorId, p_child: childId })
    },
    async setPlaysGame({ actorId, playsGame }) {
      await rpc('lq_set_plays_game', { p_actor: actorId, p_plays: playsGame })
    },
    async setStartingCoins({ actorId, coins }) {
      await rpc('lq_set_starting_coins', { p_actor: actorId, p_coins: coins })
    },
    createInvite: ({ actorId }) => rpc<string>('lq_create_invite', { p_actor: actorId }),
    async setPin({ actorId, pin }) {
      if (pin !== null && !/^\d{4,8}$/.test(pin)) throw new DomainError('invalid_pin', 'El PIN debe tener de 4 a 8 dígitos.')
      // Sólo se envía un hash derivado: el servidor nunca ve el PIN.
      await rpc('lq_set_pin', { p_actor: actorId, p_hash: pin === null ? null : await pbkdf2(pin, actorId) })
    },
    async verifyPin({ actorId, pin }) {
      return rpc<boolean>('lq_verify_pin', { p_actor: actorId, p_hash: await pbkdf2(pin, actorId) })
    },

    async updateCharacter({ actorId, memberId, patch }) {
      await rpc('lq_update_character', { p_actor: actorId, p_member: memberId, p_patch: patch })
    },
    async buyCatalogItem({ actorId, itemId }) {
      await rpc('lq_buy_item', { p_actor: actorId, p_item: itemId })
    },
    async equipItem({ actorId, memberId, itemId }) {
      await rpc('lq_equip_item', { p_actor: actorId, p_member: memberId, p_item: itemId })
    },

    async createMission({ actorId, mission }) {
      await rpc('lq_create_mission', { p_actor: actorId, p_input: missionToSql(mission) })
    },
    async updateMission({ actorId, missionId, edits }) {
      await rpc('lq_update_mission', { p_actor: actorId, p_mission: missionId, p_edits: missionToSql(edits) })
    },
    async reviewMissionProposal({ actorId, missionId, decision, note, edits }) {
      await rpc('lq_review_mission', { p_actor: actorId, p_mission: missionId, p_decision: decision, p_note: note ?? null, p_edits: edits ? missionToSql(edits) : null })
    },
    async setMissionStatus({ actorId, missionId, status }) {
      await rpc('lq_set_mission_status', { p_actor: actorId, p_mission: missionId, p_status: status })
    },
    async completeMission({ actorId, missionId, memberId, dateKey }) {
      await rpc('lq_complete_mission', { p_actor: actorId, p_mission: missionId, p_member: memberId, p_date: dateKey ?? null })
    },
    async reviewCompletion({ actorId, completionId, decision, note, initiative }) {
      await rpc('lq_review_completion', { p_actor: actorId, p_completion: completionId, p_decision: decision, p_note: note ?? null, p_initiative: initiative ?? false })
    },
    async correctLedger({ actorId, memberId, xp, coins, reason }) {
      await rpc('lq_correct_ledger', { p_actor: actorId, p_member: memberId, p_xp: xp, p_coins: coins, p_reason: reason })
    },

    async setupRewards({ actorId, rewards }) {
      await rpc('lq_setup_rewards', {
        p_actor: actorId,
        p_rewards: rewards.map((r) => ({ name: r.name, description: r.description ?? '', price: r.price, conditions: r.conditions ?? '' })),
      })
    },
    async createConsequence({ actorId, name, description, thresholdCoins, appliesTo, confirmNoEssentials }) {
      await rpc('lq_create_consequence', {
        p_actor: actorId, p_name: name, p_description: description ?? '', p_threshold: thresholdCoins,
        p_applies_to: appliesTo, p_confirm: confirmNoEssentials,
      })
    },
    async archiveConsequence({ actorId, ruleId }) {
      await rpc('lq_archive_consequence', { p_actor: actorId, p_rule: ruleId })
    },
    async createReward({ actorId, name, description, price, conditions }) {
      await rpc('lq_create_reward', { p_actor: actorId, p_name: name, p_description: description ?? '', p_price: price, p_conditions: conditions ?? '' })
    },
    async reviewReward({ actorId, rewardId, decision, edits }) {
      await rpc('lq_review_reward', { p_actor: actorId, p_reward: rewardId, p_decision: decision, p_name: edits?.name ?? null, p_price: edits?.price ?? null, p_conditions: edits?.conditions ?? null })
    },
    async archiveReward({ actorId, rewardId }) {
      await rpc('lq_archive_reward', { p_actor: actorId, p_reward: rewardId })
    },
    async requestRedemption({ actorId, rewardId }) {
      await rpc('lq_request_redemption', { p_actor: actorId, p_reward: rewardId })
    },
    async reviewRedemption({ actorId, redemptionId, decision, note, scheduledFor }) {
      await rpc('lq_review_redemption', { p_actor: actorId, p_redemption: redemptionId, p_decision: decision, p_note: note ?? null, p_scheduled_for: scheduledFor ?? null })
    },
    async refundRedemption({ actorId, redemptionId, note }) {
      await rpc('lq_refund_redemption', { p_actor: actorId, p_redemption: redemptionId, p_note: note ?? null })
    },
  }
  return api
}
