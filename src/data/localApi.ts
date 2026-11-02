import * as E from '../domain/engine'
import { DomainError, type Db, type Snapshot } from '../domain/types'
import type { LifeQuestApi, SessionInfo } from './api'
import { pbkdf2 } from './crypto'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const DB_KEY = 'lifequest.local.db.v1'
const SESSION_KEY = 'lifequest.local.session.v1'

const randomId = () => crypto.randomUUID()

/**
 * Implementación sin servidor: guarda todo en localStorage y aplica las mismas reglas del motor.
 * ⚠ No es segura frente a quien manipule el navegador; es para desarrollo y pruebas.
 */
export function createLocalApi(storage: StorageLike, ctx: E.Ctx = { now: () => new Date(), id: randomId }): LifeQuestApi {
  function load(): Db {
    const raw = storage.getItem(DB_KEY)
    if (!raw) return E.emptyDb()
    try {
      const parsed = JSON.parse(raw) as Db
      if (parsed.version !== 1) return E.emptyDb()
      // Datos guardados antes de que existieran las consecuencias o la lista inicial de recompensas.
      parsed.consequences ??= []
      for (const f of parsed.families) f.rewardsSetupDone ??= false
      return parsed
    } catch {
      return E.emptyDb()
    }
  }

  /** Transacción: se trabaja sobre una copia y sólo se guarda si todo salió bien. */
  function tx<T>(fn: (db: Db) => T): T {
    const db = structuredClone(load())
    const result = fn(db)
    storage.setItem(DB_KEY, JSON.stringify(db))
    return result
  }

  function sessionAccountId(): string {
    const id = storage.getItem(SESSION_KEY)
    if (!id) throw new DomainError('no_session', 'Inicia sesión para continuar.')
    return id
  }

  /** Sesión válida sólo si la cuenta sigue existiendo. */
  function requireAccount(db: Db): string {
    const id = sessionAccountId()
    if (!db.accounts.some((a) => a.id === id)) throw new DomainError('no_session', 'Inicia sesión para continuar.')
    return id
  }

  const actor = (db: Db, actorId: string) => E.resolveActor(db, requireAccount(db), actorId)

  const api: LifeQuestApi = {
    mode: 'local',

    async getSession(): Promise<SessionInfo | null> {
      const id = storage.getItem(SESSION_KEY)
      const account = id ? load().accounts.find((a) => a.id === id) : undefined
      return account ? { accountId: account.id, email: account.email } : null
    },

    async signUp(email, password) {
      if (password.length < 8) throw new DomainError('weak_password', 'La contraseña debe tener al menos 8 caracteres.')
      const salt = randomId()
      const passwordHash = await pbkdf2(password, salt)
      const account = tx((db) => E.registerAccount(db, ctx, { email, passwordHash, salt }))
      storage.setItem(SESSION_KEY, account.id)
    },

    async signIn(email, password) {
      const db = load()
      const account = db.accounts.find((a) => a.email === email.trim().toLowerCase())
      const hash = await pbkdf2(password, account?.salt ?? 'no-account')
      if (!account || hash !== account.passwordHash) {
        throw new DomainError('bad_credentials', 'Correo o contraseña incorrectos.')
      }
      storage.setItem(SESSION_KEY, account.id)
    },

    async signOut() {
      storage.removeItem(SESSION_KEY)
    },

    isPasswordRecovery: () => false,
    async updatePassword() {
      throw new DomainError('unsupported', 'El modo local no usa enlaces de recuperación.')
    },

    async requestPasswordReset() {
      return 'El modo local no envía correos. Para recuperar cuentas reales hay que configurar Supabase (ver README).'
    },

    async deleteAccount() {
      tx((db) => E.deleteAccount(db, requireAccount(db)))
      storage.removeItem(SESSION_KEY)
    },

    async getSnapshot(): Promise<Snapshot | null> {
      const db = load()
      return E.snapshotFor(db, requireAccount(db))
    },

    async createSolo(input) {
      tx((db) => E.createSolo(db, ctx, requireAccount(db), input))
    },
    async createFamily(input) {
      tx((db) => E.createFamily(db, ctx, requireAccount(db), input))
    },
    async joinFamily(input) {
      tx((db) => E.joinFamily(db, ctx, requireAccount(db), input))
    },

    async addChild({ actorId, ...input }) {
      tx((db) => E.addChild(db, ctx, actor(db, actorId), input))
    },
    async removeChild({ actorId, childId }) {
      tx((db) => E.removeChild(db, ctx, actor(db, actorId), childId))
    },
    async setPlaysGame({ actorId, playsGame }) {
      tx((db) => E.setPlaysGame(db, ctx, actor(db, actorId), playsGame))
    },
    async setStartingCoins({ actorId, coins }) {
      tx((db) => E.setStartingCoins(db, ctx, actor(db, actorId), coins))
    },
    async createInvite({ actorId }) {
      return tx((db) => E.createInvite(db, ctx, actor(db, actorId)))
    },
    async setPin({ actorId, pin }) {
      if (pin !== null && !/^\d{4,8}$/.test(pin)) throw new DomainError('invalid_pin', 'El PIN debe tener de 4 a 8 dígitos.')
      const hash = pin === null ? null : await pbkdf2(pin, actorId)
      tx((db) => E.setPin(actor(db, actorId), hash))
    },
    async verifyPin({ actorId, pin }) {
      const db = load()
      const me = actor(db, actorId)
      if (!me.pinHash) return true
      return (await pbkdf2(pin, actorId)) === me.pinHash
    },

    async updateCharacter({ actorId, memberId, patch }) {
      tx((db) => E.updateCharacter(db, actor(db, actorId), memberId, patch))
    },
    async buyCatalogItem({ actorId, itemId }) {
      tx((db) => E.buyCatalogItem(db, ctx, actor(db, actorId), itemId))
    },
    async equipItem({ actorId, memberId, itemId }) {
      tx((db) => E.equipItem(db, actor(db, actorId), memberId, itemId))
    },

    async createMission({ actorId, mission }) {
      tx((db) => E.createMission(db, ctx, actor(db, actorId), mission))
    },
    async updateMission({ actorId, missionId, edits }) {
      tx((db) => E.updateMission(db, ctx, actor(db, actorId), missionId, edits))
    },
    async reviewMissionProposal({ actorId, missionId, decision, note, edits }) {
      tx((db) => E.reviewMissionProposal(db, ctx, actor(db, actorId), missionId, decision, { note, edits }))
    },
    async setMissionStatus({ actorId, missionId, status }) {
      tx((db) => E.setMissionStatus(db, ctx, actor(db, actorId), missionId, status))
    },
    async completeMission({ actorId, ...input }) {
      tx((db) => E.completeMission(db, ctx, actor(db, actorId), input))
    },
    async reviewCompletion({ actorId, completionId, decision, note, initiative }) {
      tx((db) => E.reviewCompletion(db, ctx, actor(db, actorId), completionId, decision, { note, initiative }))
    },
    async correctLedger({ actorId, memberId, ...input }) {
      tx((db) => E.correctLedger(db, ctx, actor(db, actorId), memberId, input))
    },

    async setupRewards({ actorId, rewards }) {
      tx((db) => E.setupRewards(db, ctx, actor(db, actorId), rewards))
    },
    async createConsequence({ actorId, ...input }) {
      tx((db) => E.createConsequence(db, ctx, actor(db, actorId), input))
    },
    async archiveConsequence({ actorId, ruleId }) {
      tx((db) => E.archiveConsequence(db, ctx, actor(db, actorId), ruleId))
    },
    async createReward({ actorId, ...input }) {
      tx((db) => E.createReward(db, ctx, actor(db, actorId), input))
    },
    async reviewReward({ actorId, rewardId, decision, edits }) {
      tx((db) => E.reviewReward(db, ctx, actor(db, actorId), rewardId, decision, edits))
    },
    async archiveReward({ actorId, rewardId }) {
      tx((db) => E.archiveReward(db, ctx, actor(db, actorId), rewardId))
    },
    async requestRedemption({ actorId, rewardId }) {
      tx((db) => E.requestRedemption(db, ctx, actor(db, actorId), rewardId))
    },
    async reviewRedemption({ actorId, redemptionId, decision, note, scheduledFor }) {
      tx((db) => E.reviewRedemption(db, ctx, actor(db, actorId), redemptionId, decision, { note, scheduledFor }))
    },
    async refundRedemption({ actorId, redemptionId, note }) {
      tx((db) => E.refundRedemption(db, ctx, actor(db, actorId), redemptionId, note))
    },
  }
  return api
}
