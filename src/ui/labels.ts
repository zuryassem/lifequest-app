import type { Category, Difficulty, Mission } from '../domain/types'

export const CATEGORY_INFO: Record<Category, { label: string; icon: string; color: string }> = {
  health: { label: 'Salud', icon: '💪', color: '#34d399' },
  education: { label: 'Educación', icon: '📚', color: '#60a5fa' },
  productivity: { label: 'Productividad', icon: '⚡', color: '#fbbf24' },
  creativity: { label: 'Creatividad', icon: '🎨', color: '#f472b6' },
  social: { label: 'Convivencia', icon: '🤝', color: '#a78bfa' },
  discipline: { label: 'Disciplina', icon: '🛡️', color: '#22d3ee' },
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Fácil',
  medium: 'Media',
  hard: 'Difícil',
  special: 'Especial',
}

export const DIFFICULTY_RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2, special: 3 }

export const KIND_LABEL: Record<Mission['kind'], string> = {
  daily: 'Diaria',
  weekly: 'Semanal',
  special: 'Especial',
  custom: 'Personalizada',
}

export function recurrenceLabel(r: Mission['recurrence']): string {
  switch (r.type) {
    case 'once':
      return 'Una vez'
    case 'daily':
      return 'Cada día'
    case 'weekly':
      return 'Una vez por semana'
    case 'days': {
      const names = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
      return r.days.map((d) => names[d]).join(', ')
    }
  }
}

export const ERROR_FALLBACK = 'Algo salió mal. Inténtalo de nuevo.'
