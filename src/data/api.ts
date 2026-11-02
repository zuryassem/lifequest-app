import type { AgeBand, Snapshot } from '../domain/types'
import type { CharacterPatch, MissionInput, RewardInput } from '../domain/engine'

export interface SessionInfo {
  accountId: string
  email: string
}

/**
 * Contrato único entre la interfaz y los datos. Hay dos implementaciones:
 * LocalApi (navegador, sin servidor) y SupabaseApi (Postgres con RLS y funciones RPC).
 * `actorId` es el perfil que actúa; el backend comprueba que la cuenta tenga derecho a usarlo.
 */
export interface LifeQuestApi {
  readonly mode: 'local' | 'supabase'

  // --- sesión ---
  getSession(): Promise<SessionInfo | null>
  signUp(email: string, password: string): Promise<void>
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  /** Devuelve un mensaje para el usuario; en modo local no hay correo, así que explica la alternativa. */
  requestPasswordReset(email: string): Promise<string>
  deleteAccount(): Promise<void>
  /** true si la app se abrió desde un enlace de recuperación de contraseña. */
  isPasswordRecovery(): boolean
  updatePassword(newPassword: string): Promise<void>

  // --- lectura ---
  /** null si la cuenta aún no creó su aventura/familia. */
  getSnapshot(): Promise<Snapshot | null>

  // --- configuración inicial ---
  createSolo(input: { name: string }): Promise<void>
  createFamily(input: { familyName: string; guardianName: string; playsGame: boolean }): Promise<void>
  joinFamily(input: { inviteCode: string; name: string; playsGame: boolean }): Promise<void>

  // --- administración familiar ---
  addChild(input: { actorId: string; name: string; ageBand: AgeBand }): Promise<void>
  removeChild(input: { actorId: string; childId: string }): Promise<void>
  setPlaysGame(input: { actorId: string; playsGame: boolean }): Promise<void>
  setStartingCoins(input: { actorId: string; coins: number }): Promise<void>
  createInvite(input: { actorId: string }): Promise<string>
  setPin(input: { actorId: string; pin: string | null }): Promise<void>
  verifyPin(input: { actorId: string; pin: string }): Promise<boolean>

  // --- personaje y tienda digital ---
  updateCharacter(input: { actorId: string; memberId: string; patch: CharacterPatch }): Promise<void>
  buyCatalogItem(input: { actorId: string; itemId: string }): Promise<void>
  equipItem(input: { actorId: string; memberId: string; itemId: string }): Promise<void>

  // --- misiones ---
  createMission(input: { actorId: string; mission: MissionInput }): Promise<void>
  updateMission(input: { actorId: string; missionId: string; edits: Partial<MissionInput> }): Promise<void>
  reviewMissionProposal(input: {
    actorId: string; missionId: string; decision: 'approve' | 'reject'; note?: string; edits?: Partial<MissionInput>
  }): Promise<void>
  setMissionStatus(input: { actorId: string; missionId: string; status: 'active' | 'suspended' | 'archived' }): Promise<void>
  completeMission(input: { actorId: string; missionId: string; memberId: string; dateKey?: string }): Promise<void>
  reviewCompletion(input: {
    actorId: string; completionId: string; decision: 'approve' | 'reject'; note?: string; initiative?: boolean
  }): Promise<void>
  correctLedger(input: { actorId: string; memberId: string; xp: number; coins: number; reason: string }): Promise<void>

  // --- recompensas familiares ---
  /** Primera configuración obligatoria: al menos 10 recompensas (pueden costar 0). */
  setupRewards(input: { actorId: string; rewards: RewardInput[] }): Promise<void>
  createReward(input: { actorId: string; name: string; description?: string; price: number; conditions?: string }): Promise<void>
  reviewReward(input: {
    actorId: string; rewardId: string; decision: 'approve' | 'reject'; edits?: { name?: string; price?: number; conditions?: string }
  }): Promise<void>
  archiveReward(input: { actorId: string; rewardId: string }): Promise<void>
  requestRedemption(input: { actorId: string; rewardId: string }): Promise<void>
  reviewRedemption(input: {
    actorId: string; redemptionId: string; decision: 'approve' | 'reject' | 'reschedule'; note?: string; scheduledFor?: string
  }): Promise<void>
  refundRedemption(input: { actorId: string; redemptionId: string; note?: string }): Promise<void>

  // --- consecuencias acordadas ---
  createConsequence(input: {
    actorId: string; name: string; description?: string; thresholdCoins: number; appliesTo: string[]; confirmNoEssentials: boolean
  }): Promise<void>
  archiveConsequence(input: { actorId: string; ruleId: string }): Promise<void>
}
