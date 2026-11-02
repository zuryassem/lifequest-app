import type { Mission } from './types'

/** Fecha local en formato YYYY-MM-DD. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parse(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00Z`)
}

export function dayOfWeek(dateKey: string): number {
  return parse(dateKey).getUTCDay()
}

export function mondayOf(dateKey: string): string {
  const d = parse(dateKey)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/**
 * Clave de la ocurrencia de una misión para una fecha, o null si ese día no toca.
 * Junto con (misión, miembro) identifica de forma única una realización,
 * lo que evita recompensas duplicadas (§263).
 */
export function periodKey(mission: Pick<Mission, 'recurrence'>, dateKey: string): string | null {
  const r = mission.recurrence
  switch (r.type) {
    case 'once':
      return 'once'
    case 'daily':
      return dateKey
    case 'days':
      return r.days.includes(dayOfWeek(dateKey)) ? dateKey : null
    case 'weekly':
      return mondayOf(dateKey)
  }
}

export const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
