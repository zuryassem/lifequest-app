import type { Avatar, CatalogItem } from './types'

/**
 * Catálogo digital global. Los precios están en LIFECOINS (moneda interna sin valor real, §150).
 * Para añadir artículos basta con agregar una fila; no hay lógica ligada a ids concretos.
 * El mismo catálogo se siembra en supabase/migrations/0001_init.sql.
 */
export const CATALOG: CatalogItem[] = [
  { id: 'bg-nebula', slot: 'background', name: 'Nebulosa', description: 'Fondo violeta con polvo de estrellas.', price: 0, value: 'nebula', minLevel: 0 },
  { id: 'bg-grid', slot: 'background', name: 'Cuadrícula neón', description: 'Rejilla holográfica azul.', price: 40, value: 'grid', minLevel: 0 },
  { id: 'bg-aurora', slot: 'background', name: 'Aurora', description: 'Cortinas de luz verde y azul.', price: 90, value: 'aurora', minLevel: 3 },
  { id: 'bg-city', slot: 'background', name: 'Ciudad nocturna', description: 'Skyline futurista.', price: 160, value: 'city', minLevel: 5 },
  { id: 'fr-basic', slot: 'frame', name: 'Marco cian', description: 'Borde luminoso cian.', price: 0, value: 'cyan', minLevel: 0 },
  { id: 'fr-violet', slot: 'frame', name: 'Marco violeta', description: 'Borde luminoso violeta.', price: 50, value: 'violet', minLevel: 0 },
  { id: 'fr-gold', slot: 'frame', name: 'Marco dorado', description: 'Para quienes van lejos.', price: 200, value: 'gold', minLevel: 6 },
  { id: 'ac-visor', slot: 'accessory', name: 'Visor táctico', description: 'Visor azul translúcido.', price: 30, value: '🥽', minLevel: 0 },
  { id: 'ac-headset', slot: 'accessory', name: 'Auriculares', description: 'Para concentrarse.', price: 45, value: '🎧', minLevel: 0 },
  { id: 'ac-crown', slot: 'accessory', name: 'Corona de datos', description: 'Una corona digital.', price: 250, value: '👑', minLevel: 8 },
  { id: 'ac-star', slot: 'accessory', name: 'Estrella guía', description: 'Brilla a tu lado.', price: 120, value: '🌟', minLevel: 4 },
  { id: 'ti-novice', slot: 'title', name: 'Aprendiz', description: 'Título de inicio.', price: 0, value: 'Aprendiz', minLevel: 0 },
  { id: 'ti-explorer', slot: 'title', name: 'Explorador', description: 'Título de quien prueba de todo.', price: 60, value: 'Explorador', minLevel: 0 },
  { id: 'ti-guardian', slot: 'title', name: 'Guardián del hogar', description: 'Título familiar.', price: 100, value: 'Guardián del hogar', minLevel: 3 },
  { id: 'ti-legend', slot: 'title', name: 'Leyenda', description: 'Título de gran constancia.', price: 400, value: 'Leyenda', minLevel: 10 },
]

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id)
}

/** Artículos gratuitos: todos los jugadores empiezan con ellos en el inventario. */
export const STARTER_ITEM_IDS = CATALOG.filter((i) => i.price === 0).map((i) => i.id)

export const DEFAULT_AVATAR: Avatar = {
  style: 'runner',
  color: '#22d3ee',
  hair: 'short',
  outfit: 'suit',
  accessory: null,
  background: 'nebula',
  frame: 'cyan',
  title: 'Aprendiz',
}

export const AVATAR_STYLES: { id: Avatar['style']; label: string; glyph: string }[] = [
  { id: 'runner', label: 'Corredor', glyph: '🏃' },
  { id: 'mage', label: 'Mago cuántico', glyph: '🧙' },
  { id: 'engineer', label: 'Ingeniero', glyph: '🛠️' },
  { id: 'scout', label: 'Explorador', glyph: '🧭' },
]

export const AVATAR_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa']

export const INTERESTS = ['Deportes', 'Educación', 'Tecnología', 'Creatividad', 'Música', 'Lectura', 'Productividad', 'Convivencia familiar']
export const GOALS = ['Mejorar mi organización', 'Aprender algo nuevo', 'Ser más constante', 'Ayudar más en casa', 'Cuidar mi salud']
