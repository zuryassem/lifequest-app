import type { LifeQuestApi } from './api'
import { createLocalApi } from './localApi'
import { createSupabaseApi } from './supabaseApi'

/**
 * Con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY definidas usa Supabase (producción);
 * sin ellas, el modo local de desarrollo. Ver README.
 */
export function createApi(): LifeQuestApi {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (url && key) return createSupabaseApi(url, key)
  return createLocalApi(localStorage)
}
