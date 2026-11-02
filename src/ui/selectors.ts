import { memberStats } from '../domain/engine'
import { periodKey } from '../domain/recurrence'
import { levelProgress } from '../domain/progression'
import type { Completion, Member, Mission, Snapshot } from '../domain/types'
import { DIFFICULTY_RANK } from './labels'

export type MissionState = 'todo' | 'pending' | 'done' | 'rejected' | 'notdue'

export function statsOf(snap: Snapshot, memberId: string) {
  const s = memberStats(snap, memberId)
  return { ...s, progress: levelProgress(s.xp) }
}

export function completionFor(snap: Snapshot, mission: Mission, memberId: string, today: string): Completion | undefined {
  const key = periodKey(mission, today)
  if (key === null) return undefined
  return snap.completions.find((c) => c.missionId === mission.id && c.memberId === memberId && c.periodKey === key)
}

export function missionState(snap: Snapshot, mission: Mission, memberId: string, today: string): MissionState {
  if (periodKey(mission, today) === null) return 'notdue'
  const c = completionFor(snap, mission, memberId, today)
  if (!c) return 'todo'
  return c.status === 'approved' ? 'done' : c.status === 'pending' ? 'pending' : 'rejected'
}

const STATE_ORDER: Record<MissionState, number> = { rejected: 0, todo: 1, pending: 2, done: 3, notdue: 4 }

/** Prioridad (§92): lo que falta primero, luego mayor dificultad y categoría. */
export function sortMissions(snap: Snapshot, list: Mission[], memberId: string, today: string): Mission[] {
  return [...list].sort((a, b) => {
    const sa = STATE_ORDER[missionState(snap, a, memberId, today)]
    const sb = STATE_ORDER[missionState(snap, b, memberId, today)]
    return sa - sb || DIFFICULTY_RANK[b.difficulty] - DIFFICULTY_RANK[a.difficulty] || a.category.localeCompare(b.category)
  })
}

export function activeMissionsFor(snap: Snapshot, memberId: string): Mission[] {
  return snap.missions.filter((m) => m.status === 'active' && m.assigneeIds.includes(memberId))
}

export function playersOf(snap: Snapshot): Member[] {
  return snap.members.filter((m) => m.playsGame)
}

export function pendingCounts(snap: Snapshot) {
  return {
    completions: snap.completions.filter((c) => c.status === 'pending').length,
    redemptions: snap.redemptions.filter((r) => r.status === 'pending' || r.status === 'rescheduled').length,
    missionProposals: snap.missions.filter((m) => m.status === 'proposed').length,
    rewardProposals: snap.rewards.filter((r) => r.status === 'proposed').length,
  }
}

export function nameOf(snap: Snapshot, id: string | null): string {
  return snap.members.find((m) => m.id === id)?.name ?? 'Alguien'
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
