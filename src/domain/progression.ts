import type { Difficulty, LedgerEntry } from './types'

/**
 * FÓRMULA DE PROGRESIÓN (configurable, §113)
 *
 *   XP total necesario para alcanzar el nivel L = round(BASE * (L - 1) ^ EXPONENT)
 *
 * Con BASE=60 y EXPONENT=1.5: nivel 2 = 60, 3 = 170, 5 = 480, 10 = 1 620, 20 = 4 969.
 * Cada nivel exige más XP que el anterior (§112). El mismo cálculo está en
 * supabase/migrations/0001_init.sql (función lq_xp_for_level); cambiar uno exige cambiar el otro.
 */
export const PROGRESSION = { BASE: 60, EXPONENT: 1.5, MAX_LEVEL: 100 } as const

export function xpForLevel(level: number): number {
  if (level <= 1) return 0
  return Math.round(PROGRESSION.BASE * Math.pow(level - 1, PROGRESSION.EXPONENT))
}

export function levelForXp(xp: number): number {
  let level = 1
  while (level < PROGRESSION.MAX_LEVEL && xp >= xpForLevel(level + 1)) level++
  return level
}

export interface LevelProgress {
  level: number
  xp: number
  currentLevelXp: number
  nextLevelXp: number
  /** 0..1 dentro del nivel actual. */
  ratio: number
}

export function levelProgress(xp: number): LevelProgress {
  const safe = Math.max(0, xp)
  const level = levelForXp(safe)
  const currentLevelXp = xpForLevel(level)
  const nextLevelXp = xpForLevel(level + 1)
  const span = Math.max(1, nextLevelXp - currentLevelXp)
  return { level, xp: safe, currentLevelXp, nextLevelXp, ratio: Math.min(1, (safe - currentLevelXp) / span) }
}

/** Recompensas por defecto según dificultad; las familias pueden modificarlas dentro de los topes. */
export const DEFAULT_REWARDS: Record<Difficulty, { xp: number; coins: number }> = {
  easy: { xp: 10, coins: 5 },
  medium: { xp: 25, coins: 12 },
  hard: { xp: 50, coins: 25 },
  special: { xp: 100, coins: 60 },
}

/** Topes por misión para evitar recompensas desproporcionadas (§111). */
export const REWARD_CAPS: Record<Difficulty, { xp: number; coins: number }> = {
  easy: { xp: 150, coins: 300 },
  medium: { xp: 150, coins: 300 },
  hard: { xp: 150, coins: 300 },
  special: { xp: 500, coins: 1000 },
}

export const MAX_REWARD_PRICE = 100_000
export const MAX_STARTING_COINS = 1000

export function totals(ledger: LedgerEntry[], memberId: string): { xp: number; coins: number } {
  let xp = 0
  let coins = 0
  for (const e of ledger) {
    if (e.memberId !== memberId) continue
    xp += e.xp
    coins += e.coins
  }
  return { xp, coins }
}
