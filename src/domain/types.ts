export type Role = 'guardian' | 'child'
export type FamilyKind = 'solo' | 'family'
export type AgeBand = 'kid' | 'teen' | 'adult'

export const CATEGORIES = ['health', 'education', 'productivity', 'creativity', 'social', 'discipline'] as const
export type Category = (typeof CATEGORIES)[number]

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'special'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export type MissionKind = 'daily' | 'weekly' | 'special' | 'custom'
export type MissionStatus = 'proposed' | 'active' | 'suspended' | 'archived' | 'rejected'

/** once: se completa una sola vez; daily: cada día; days: ciertos días de la semana (0=domingo); weekly: una vez por semana (lunes a domingo). */
export type Recurrence =
  | { type: 'once' }
  | { type: 'daily' }
  | { type: 'days'; days: number[] }
  | { type: 'weekly' }

export interface Avatar {
  style: 'runner' | 'mage' | 'engineer' | 'scout'
  color: string
  hair: string
  outfit: string
  accessory: string | null
  background: string | null
  frame: string | null
  title: string | null
}

export interface Account {
  id: string
  email: string
  passwordHash: string
  salt: string
  createdAt: string
}

export interface Family {
  id: string
  kind: FamilyKind
  name: string
  /** Identificador único legible generado por el sistema. */
  code: string
  inviteCode: string | null
  inviteExpiresAt: string | null
  startingCoins: number
  /** true cuando el adulto ya eligió su lista inicial de recompensas (mínimo 10). */
  rewardsSetupDone: boolean
  createdAt: string
}

export interface Member {
  id: string
  familyId: string
  /** Null en perfiles infantiles: no tienen cuenta ni correo. */
  accountId: string | null
  role: Role
  name: string
  ageBand: AgeBand
  /** Un guardián puede administrar sin jugar. Los niños siempre juegan. */
  playsGame: boolean
  avatar: Avatar
  interests: string[]
  goals: string[]
  /** Hash del PIN que protege el regreso al modo adulto desde el modo niño. */
  pinHash: string | null
  createdAt: string
}

export interface Mission {
  id: string
  familyId: string
  title: string
  description: string
  category: Category
  difficulty: Difficulty
  kind: MissionKind
  xp: number
  coins: number
  /** Bonificación opcional si se hizo por iniciativa propia (sin recordatorios). */
  initiativeXp: number
  initiativeCoins: number
  estimatedMinutes: number
  /** Condiciones para darla por terminada (§89). */
  criteria: string
  recurrence: Recurrence
  assigneeIds: string[]
  /** true: un guardián debe aprobar cada realización. */
  requiresApproval: boolean
  status: MissionStatus
  createdBy: string
  createdAt: string
  /** Si es una propuesta: quién la hizo, la decisión y la nota de revisión. */
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string | null
}

export type CompletionStatus = 'pending' | 'approved' | 'rejected'

export interface Completion {
  id: string
  missionId: string
  memberId: string
  /** Identifica la ocurrencia: fecha (daily/days), lunes de la semana (weekly) o "once". */
  periodKey: string
  status: CompletionStatus
  completedBy: string
  completedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  note: string | null
  initiative: boolean
}

export interface LedgerEntry {
  id: string
  memberId: string
  xp: number
  coins: number
  reason: string
  /** Junto con memberId, hace cada movimiento idempotente. */
  refType: 'welcome' | 'completion' | 'purchase' | 'redemption' | 'refund' | 'correction'
  refId: string
  actorId: string
  createdAt: string
}

export type ShopSlot = 'accessory' | 'background' | 'frame' | 'title'

export interface CatalogItem {
  id: string
  slot: ShopSlot
  name: string
  description: string
  price: number
  /** Valor que se aplica al avatar (clase de color, emoji, texto del título…). */
  value: string
  /** Nivel mínimo para comprarlo (0 = disponible desde el inicio). */
  minLevel: number
}

export interface InventoryItem {
  memberId: string
  itemId: string
  equipped: boolean
  acquiredAt: string
}

export type RewardStatus = 'proposed' | 'approved' | 'archived' | 'rejected'

/** Recompensa de la tienda privada de una familia (§132). */
export interface FamilyReward {
  id: string
  familyId: string
  name: string
  description: string
  price: number
  /** Condiciones razonables, horarios o límites (§138). */
  conditions: string
  status: RewardStatus
  createdBy: string
  createdAt: string
  reviewedBy: string | null
}

export type RedemptionStatus = 'pending' | 'approved' | 'rejected' | 'rescheduled' | 'refunded'

export interface Redemption {
  id: string
  familyId: string
  rewardId: string
  memberId: string
  price: number
  status: RedemptionStatus
  note: string | null
  scheduledFor: string | null
  requestedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
}

/**
 * Consecuencia acordada y transparente: se activa cuando las monedas disponibles de un jugador
 * bajan de `thresholdCoins`. La app la muestra; el adulto es quien la hace efectiva en la vida real.
 * Nunca descuenta XP ni monedas ni puede afectar necesidades básicas (§122).
 */
export interface ConsequenceRule {
  id: string
  familyId: string
  name: string
  description: string
  thresholdCoins: number
  appliesTo: string[]
  status: 'active' | 'archived'
  createdBy: string
  createdAt: string
}

export interface AuditEntry {
  id: string
  familyId: string
  actorId: string
  action: string
  refId: string | null
  detail: string
  at: string
}

export interface Db {
  version: 1
  accounts: Account[]
  families: Family[]
  members: Member[]
  missions: Mission[]
  completions: Completion[]
  ledger: LedgerEntry[]
  inventory: InventoryItem[]
  rewards: FamilyReward[]
  redemptions: Redemption[]
  consequences: ConsequenceRule[]
  audit: AuditEntry[]
}

/** Lo que una sesión ve de su familia. */
export interface Snapshot {
  account: { id: string; email: string }
  family: Family
  members: Member[]
  missions: Mission[]
  completions: Completion[]
  ledger: LedgerEntry[]
  inventory: InventoryItem[]
  rewards: FamilyReward[]
  redemptions: Redemption[]
  consequences: ConsequenceRule[]
  audit: AuditEntry[]
}

export class DomainError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
