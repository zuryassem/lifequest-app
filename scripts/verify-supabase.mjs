/**
 * Prueba de humo contra TU proyecto Supabase real.
 *
 *   1. Aplica supabase/migrations/0001_init.sql en el SQL Editor del proyecto.
 *   2. Rellena .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
 *   3. En Authentication → Providers → Email desactiva "Confirm email" (sólo durante la prueba).
 *   4. npm run verify:supabase
 *
 * Crea dos usuarios desechables (SMOKE_EMAIL con +lqsmoke…), recorre el flujo completo,
 * comprueba que el cliente NO puede escribir directamente ni ver datos ajenos,
 * y al final elimina ambas cuentas con lq_delete_account.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (copia .env.example a .env).')
  process.exit(2)
}
if (/service_role/i.test(key) || (key.split('.')[1] && Buffer.from(key.split('.')[1], 'base64url').toString().includes('"service_role"'))) {
  console.error('Esa clave es service_role. Usa la clave "anon" (pública). Nunca pongas service_role en el front.')
  process.exit(2)
}

const anonOnly = process.argv.includes('--anon-only')
const base = process.env.SMOKE_EMAIL
if (!anonOnly && (!base || !/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(base))) {
  console.error('Define SMOKE_EMAIL=tucorreo@dominio.com en .env (se crearán cuentas desechables tucorreo+lqsmoke…@dominio.com).')
  process.exit(2)
}

let passed = 0
let failed = 0
const check = (name, ok, extra = '') => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${ok ? '' : extra ? ` → ${extra}` : ''}`)
}
const errText = (e) => (e ? `${e.code ?? ''} ${e.message ?? ''}`.trim() : '')

const rand = Math.random().toString(36).slice(2, 10)
const password = `Lq-${rand}-${Math.random().toString(36).slice(2, 10)}`

async function newClient(label) {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  // Supabase rechaza dominios inexistentes (example.com). Se usa "plus-addressing" sobre un correo tuyo.
  const [user, domain] = base.split('@')
  const email = `${user}+lqsmoke${label}${rand}@${domain}`
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) throw new Error(`signUp ${label}: ${error.message}`)
  if (!data.session) {
    throw new Error(
      'signUp no devolvió sesión: tienes "Confirm email" activado. Desactívalo en Authentication → Providers → Email mientras pruebas.',
    )
  }
  return sb
}

const rpc = (sb, fn, args = {}) => sb.rpc(fn, args)
const clean = []

if (anonOnly) {
  // Sin iniciar sesión: comprueba que un visitante anónimo no puede leer ni escribir nada.
  try {
    console.log('Supabase (sólo anónimo):', url)
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    for (const t of ['families', 'members', 'member_secrets', 'missions', 'completions', 'ledger', 'catalog_items', 'inventory', 'rewards', 'redemptions', 'consequences', 'audit_log']) {
      const r = await sb.from(t).select('*').limit(1)
      check(`anónimo no puede leer ${t}`, !!r.error || (r.data ?? []).length === 0, 'devolvió filas')
    }
    const w = await sb.from('ledger').insert({ member_id: '00000000-0000-0000-0000-000000000000', coins: 1, reason: 'x', ref_type: 'correction', ref_id: 'x', actor_id: '00000000-0000-0000-0000-000000000000' })
    check('anónimo no puede insertar en ledger', !!w.error)
    for (const [fn, args] of [
      ['lq_create_solo', { p_name: 'x' }],
      ['lq_create_family', { p_family_name: 'x', p_guardian_name: 'x', p_plays_game: true }],
      ['lq_delete_account', {}],
      ['lq_archive_consequence', { p_actor: '00000000-0000-0000-0000-000000000000', p_rule: '00000000-0000-0000-0000-000000000000' }],
      ['lq_setup_rewards', { p_actor: '00000000-0000-0000-0000-000000000000', p_rewards: [] }],
      ['lq_create_consequence', { p_actor: '00000000-0000-0000-0000-000000000000', p_name: 'x', p_description: '', p_threshold: 5, p_applies_to: [], p_confirm: true }],
    ]) {
      const r = await sb.rpc(fn, args)
      check(`anónimo no puede ejecutar ${fn}`, !!r.error, 'se ejecutó')
      // El error debe ser de permisos: si dijera "Could not find the function", la función no existiría.
      check(`${fn} existe en el proyecto`, !!r.error && !/Could not find the function/i.test(r.error.message), errText(r.error))
    }
    const priv = await sb.schema('lq_private').from('x').select('*')
    check('esquema privado no expuesto por la API', !!priv.error)
    const fam = await sb.rpc('my_families')
    check('funciones privadas no llamables', !!fam.error)
  } catch (e) {
    failed++
    console.log(`  ✘ ${e.message}`)
  }
  console.log(`\n${passed} correctas, ${failed} fallidas (modo anónimo: no comprueba el flujo con sesión)`)
  process.exit(failed ? 1 : 0)
}

try {
  console.log('Supabase:', url)
  const mom = await newClient('a')
  const other = await newClient('b')
  clean.push(mom, other)
  check('registro e inicio de sesión (2 cuentas)', true)

  // Esquema aplicado
  const cat = await mom.from('catalog_items').select('id')
  check('esquema aplicado: catálogo digital legible', !cat.error && cat.data.length >= 15, errText(cat.error))

  // Familia
  const fam = await rpc(mom, 'lq_create_family', { p_family_name: 'Humo', p_guardian_name: 'Mamá', p_plays_game: false })
  check('crear familia (RPC)', !fam.error, errText(fam.error))
  const momId = fam.data
  const kidRes = await rpc(mom, 'lq_add_child', { p_actor: momId, p_name: 'Ana', p_age_band: 'kid' })
  check('añadir hijo', !kidRes.error, errText(kidRes.error))
  const kid = kidRes.data

  // Misión → completar → aprobar
  const mis = await rpc(mom, 'lq_create_mission', {
    p_actor: momId,
    p_input: { title: 'Tender la cama', category: 'discipline', difficulty: 'easy', recurrence: { type: 'daily' }, assignee_ids: [kid], xp: 30, coins: 10 },
  })
  check('crear misión', !mis.error, errText(mis.error))
  const comp = await rpc(mom, 'lq_complete_mission', { p_actor: kid, p_mission: mis.data, p_member: kid, p_date: null })
  check('niño marca la misión (queda pendiente)', !comp.error, errText(comp.error))
  const dup = await rpc(mom, 'lq_complete_mission', { p_actor: kid, p_mission: mis.data, p_member: kid, p_date: null })
  check('segunda realización del mismo periodo rechazada', dup.error?.message?.includes('duplicate'), errText(dup.error))
  const appr = await rpc(mom, 'lq_review_completion', { p_actor: momId, p_completion: comp.data, p_decision: 'approve', p_note: null, p_initiative: false })
  check('adulto aprueba', !appr.error, errText(appr.error))
  const led = await mom.from('ledger').select('xp,coins').eq('member_id', kid)
  const sum = (k) => (led.data ?? []).reduce((s, r) => s + r[k], 0)
  check('XP y LIFECOINS correctos en el ledger (30 XP, 60 🪙)', sum('xp') === 30 && sum('coins') === 60, JSON.stringify(led.data))

  // El cliente no puede escribir ni ver lo ajeno
  const hack = await mom.from('ledger').update({ coins: 999999 }).eq('member_id', kid).select()
  check('UPDATE directo al ledger denegado', !!hack.error || (hack.data ?? []).length === 0, 'el update surtió efecto')
  const hack2 = await mom.from('ledger').insert({ member_id: kid, coins: 9999, reason: 'x', ref_type: 'correction', ref_id: 'z', actor_id: kid })
  check('INSERT directo al ledger denegado', !!hack2.error, 'se permitió insertar')
  const after = await mom.from('ledger').select('coins').eq('member_id', kid)
  check('saldo intacto tras los intentos', (after.data ?? []).reduce((s, r) => s + r.coins, 0) === 60)
  const peek = await other.from('members').select('id')
  check('otra cuenta no ve miembros ajenos', !peek.error && peek.data.length === 0, errText(peek.error))
  const peek2 = await other.from('ledger').select('id')
  check('otra cuenta no ve movimientos ajenos', !peek2.error && peek2.data.length === 0, errText(peek2.error))
  const steal = await rpc(other, 'lq_create_mission', {
    p_actor: momId, p_input: { title: 'x', category: 'health', difficulty: 'easy', assignee_ids: [kid] },
  })
  check('actuar con un perfil ajeno → forbidden', steal.error?.message?.includes('forbidden'), errText(steal.error))
  const secrets = await mom.from('member_secrets').select('*')
  check('hash del PIN no legible', !!secrets.error, 'se pudo leer member_secrets')
  const priv = await mom.schema('lq_private').from('x').select('*')
  check('esquema privado no expuesto por la API', !!priv.error)

  // Compra y canje
  const buy = await rpc(mom, 'lq_buy_item', { p_actor: kid, p_item: 'ac-visor' })
  check('compra en la tienda digital', !buy.error, errText(buy.error))
  const rw = await rpc(mom, 'lq_create_reward', { p_actor: momId, p_name: 'Película', p_description: '', p_price: 20, p_conditions: '' })
  const red = await rpc(mom, 'lq_request_redemption', { p_actor: kid, p_reward: rw.data })
  check('solicitud de canje (reserva monedas)', !red.error, errText(red.error))
  const rej = await rpc(mom, 'lq_review_redemption', { p_actor: momId, p_redemption: red.data, p_decision: 'reject', p_note: null, p_scheduled_for: null })
  check('rechazo sin explicación → note_required', rej.error?.message?.includes('note_required'), errText(rej.error))
  const ok = await rpc(mom, 'lq_review_redemption', { p_actor: momId, p_redemption: red.data, p_decision: 'approve', p_note: null, p_scheduled_for: null })
  check('aprobación de canje', !ok.error, errText(ok.error))
  const led2 = await mom.from('ledger').select('coins').eq('member_id', kid)
  check('saldo final = 60 − 30 − 20 = 10', led2.data.reduce((s, r) => s + r.coins, 0) === 10)
} catch (e) {
  failed++
  console.log(`  ✘ ${e.message}`)
} finally {
  for (const sb of clean) {
    const { error } = await sb.rpc('lq_delete_account')
    if (error) console.log(`  ! no se pudo borrar una cuenta de prueba: ${errText(error)} (bórrala en Authentication → Users)`)
  }
  console.log(`\n${passed} correctas, ${failed} fallidas`)
  process.exit(failed ? 1 : 0)
}
