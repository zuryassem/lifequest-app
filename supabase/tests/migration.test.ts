/**
 * Prueba la migración SQL en un Postgres real (PGlite, WASM): reglas de negocio, RLS y permisos.
 * No sustituye una prueba contra un proyecto Supabase real (ver README), pero valida que el SQL
 * compila, que las reglas coinciden con el motor TypeScript y que el cliente no puede escribir.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { xpForLevel } from '../../src/domain/progression'

let pg: PGlite

beforeAll(async () => {
  pg = new PGlite()
  // Simula lo que Supabase ya trae: esquema auth, auth.uid() y los roles de la API.
  await pg.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
  `)
  for (const file of ['0001_init.sql', '0002_rewards_setup_consequences.sql']) {
    await pg.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  }
}, 60_000)

interface User {
  id: string
  rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T>
  sel(sql: string, params?: unknown[]): Promise<any[]>
}

async function asUser<T>(id: string, fn: () => Promise<T>): Promise<T> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id])
  await pg.exec('set role authenticated')
  try {
    return await fn()
  } finally {
    await pg.exec('reset role')
  }
}

async function newUser(): Promise<User> {
  const id = randomUUID()
  await pg.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@example.com`])
  return {
    id,
    rpc: (fn, args = {}) =>
      asUser(id, async () => {
        const keys = Object.keys(args)
        const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
        // PostgREST convierte arreglos JSON a uuid[]; aquí se hace a mano. El resto de objetos va como jsonb.
        const values = keys.map((k) => {
          const v = args[k]
          if (k === 'p_applies_to') return `{${(v as string[]).join(',')}}`
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
        })
        const r = await pg.query<any>(`select public.${fn}(${named}) as r`, values)
        return r.rows[0].r
      }),
    sel: (sql, params = []) => asUser(id, async () => (await pg.query<any>(sql, params)).rows),
  }
}

/** Mamá (no juega) + una hija. */
async function family() {
  const mom = await newUser()
  const momMember = await mom.rpc<string>('lq_create_family', { p_family_name: 'Los Pérez', p_guardian_name: 'Mamá', p_plays_game: false })
  const kid = await mom.rpc<string>('lq_add_child', { p_actor: momMember, p_name: 'Ana', p_age_band: 'kid' })
  return { mom, momMember, kid }
}

const balance = async (u: User, member: string) =>
  (await u.sel('select coalesce(sum(xp),0)::int xp, coalesce(sum(coins),0)::int coins from ledger where member_id = $1', [member]))[0]

const mission = (kidId: string, extra: Record<string, unknown> = {}) => ({
  title: 'Tender la cama', category: 'discipline', difficulty: 'easy', recurrence: { type: 'daily' }, assignee_ids: [kidId], ...extra,
})

describe('familias y permisos', () => {
  it('crea familia con bienvenida sólo para quien juega, y niños sin cuenta', async () => {
    const { mom, momMember, kid } = await family()
    expect((await balance(mom, kid)).coins).toBe(50)
    expect((await balance(mom, momMember)).coins).toBe(0)
    const members = await mom.sel('select role, account_id from members order by role')
    expect(members.find((m) => m.role === 'child').account_id).toBeNull()
  })

  it('una cuenta no puede crear dos familias', async () => {
    const { mom } = await family()
    await expect(mom.rpc('lq_create_solo', { p_name: 'Otra' })).rejects.toThrow(/already_set_up/)
  })

  it('otra cuenta no ve datos ajenos ni puede actuar con un perfil ajeno', async () => {
    const a = await family()
    const b = await family()
    await a.mom.rpc('lq_create_mission', { p_actor: a.momMember, p_input: mission(a.kid) })
    expect(await b.mom.sel('select * from missions')).toHaveLength(0)
    expect((await b.mom.sel('select id from members')).map((m) => m.id)).not.toContain(a.kid)
    await expect(b.mom.rpc('lq_create_mission', { p_actor: a.momMember, p_input: mission(a.kid) })).rejects.toThrow(/forbidden/)
    await expect(b.mom.rpc('lq_add_child', { p_actor: a.momMember, p_name: 'X', p_age_band: 'kid' })).rejects.toThrow(/forbidden/)
  })

  it('segundo adulto por invitación, máximo dos', async () => {
    const { mom, momMember } = await family()
    const code = await mom.rpc<string>('lq_create_invite', { p_actor: momMember })
    const dad = await newUser()
    await dad.rpc('lq_join_family', { p_invite_code: code.toLowerCase(), p_name: 'Papá', p_plays_game: true })
    expect((await dad.sel('select id from members')).length).toBe(3)
    await expect(mom.rpc('lq_create_invite', { p_actor: momMember })).rejects.toThrow(/limit/)
    const third = await newUser()
    await expect(third.rpc('lq_join_family', { p_invite_code: code, p_name: 'X', p_plays_game: true })).rejects.toThrow(/invalid_invite/)
  })
})

describe('el cliente no puede escribir (RLS + privilegios)', () => {
  it('INSERT/UPDATE/DELETE directos sobre tablas sensibles están denegados', async () => {
    const { mom, momMember, kid } = await family()
    await expect(mom.sel(`insert into ledger (member_id, xp, coins, reason, ref_type, ref_id, actor_id) values ($1, 0, 9999, 'trampa', 'correction', 'x', $1)`, [kid])).rejects.toThrow(/permission denied/)
    await expect(mom.sel('update ledger set coins = 999999')).rejects.toThrow(/permission denied/)
    await expect(mom.sel('delete from ledger')).rejects.toThrow(/permission denied/)
    await expect(mom.sel(`update members set plays_game = true, role = 'guardian' where id = $1`, [kid])).rejects.toThrow(/permission denied/)
    await expect(mom.sel(`update missions set xp = 500`)).rejects.toThrow(/permission denied/)
    await expect(mom.sel(`update completions set status = 'approved'`)).rejects.toThrow(/permission denied/)
    expect((await balance(mom, kid)).coins).toBe(50)
    void momMember
  })

  it('la tabla de PIN no es legible y un usuario anónimo no ve nada', async () => {
    const { mom, momMember } = await family()
    await mom.rpc('lq_set_pin', { p_actor: momMember, p_hash: 'abc123' })
    await expect(mom.sel('select * from member_secrets')).rejects.toThrow(/permission denied/)
    expect(await mom.rpc('lq_verify_pin', { p_actor: momMember, p_hash: 'abc123' })).toBe(true)
    expect(await mom.rpc('lq_verify_pin', { p_actor: momMember, p_hash: 'otro' })).toBe(false)
    expect((await mom.sel('select has_pin from members where id = $1', [momMember]))[0].has_pin).toBe(true)
    await pg.exec('reset role; set role anon')
    await expect(pg.query('select * from missions')).rejects.toThrow(/permission denied/)
    await expect(pg.query(`select public.lq_create_solo('x')`)).rejects.toThrow(/permission denied/)
    await pg.exec('reset role')
  })

  it('las funciones auxiliares privadas no son ejecutables por el cliente', async () => {
    const { mom, kid } = await family()
    await expect(mom.sel(`select lq_private.grant_ledger($1, 9999, 9999, 'x', 'correction', 'z', $1)`, [kid])).rejects.toThrow(/permission denied/)
  })
})

describe('misiones, XP y LIFECOINS', () => {
  it('flujo completo: crear, completar (pendiente), aprobar, anti-duplicado', async () => {
    const { mom, momMember, kid } = await family()
    const m = await mom.rpc<string>('lq_create_mission', { p_actor: momMember, p_input: mission(kid, { xp: 30, coins: 10 }) })
    const c = await mom.rpc<string>('lq_complete_mission', { p_actor: kid, p_mission: m, p_member: kid, p_date: null })
    expect((await mom.sel('select status from completions where id = $1', [c]))[0].status).toBe('pending')
    expect(await balance(mom, kid)).toEqual({ xp: 0, coins: 50 })
    await expect(mom.rpc('lq_complete_mission', { p_actor: kid, p_mission: m, p_member: kid, p_date: null })).rejects.toThrow(/duplicate/)
    await mom.rpc('lq_review_completion', { p_actor: momMember, p_completion: c, p_decision: 'approve', p_note: null, p_initiative: false })
    expect(await balance(mom, kid)).toEqual({ xp: 30, coins: 60 })
    await expect(mom.rpc('lq_review_completion', { p_actor: momMember, p_completion: c, p_decision: 'approve', p_note: null, p_initiative: false })).rejects.toThrow(/already_reviewed/)
    expect(await balance(mom, kid)).toEqual({ xp: 30, coins: 60 })
    // Trazabilidad: quién la creó, completó y aprobó.
    const row = (await mom.sel('select completed_by, reviewed_by from completions where id = $1', [c]))[0]
    expect(row).toEqual({ completed_by: kid, reviewed_by: momMember })
    expect((await mom.sel('select count(*)::int n from audit_log where action like $1', ['completion.%']))[0].n).toBe(2)
  })

  it('bono por iniciativa, rechazo con reenvío y topes de recompensa', async () => {
    const { mom, momMember, kid } = await family()
    const m = await mom.rpc<string>('lq_create_mission', { p_actor: momMember, p_input: mission(kid, { xp: 20, coins: 10, initiative_xp: 5, initiative_coins: 5 }) })
    const c = await mom.rpc<string>('lq_complete_mission', { p_actor: kid, p_mission: m, p_member: kid, p_date: null })
    await mom.rpc('lq_review_completion', { p_actor: momMember, p_completion: c, p_decision: 'reject', p_note: 'Falta', p_initiative: false })
    expect(await balance(mom, kid)).toEqual({ xp: 0, coins: 50 })
    const again = await mom.rpc<string>('lq_complete_mission', { p_actor: kid, p_mission: m, p_member: kid, p_date: null })
    expect(again).toBe(c)
    await mom.rpc('lq_review_completion', { p_actor: momMember, p_completion: c, p_decision: 'approve', p_note: null, p_initiative: true })
    expect(await balance(mom, kid)).toEqual({ xp: 25, coins: 65 })
    await expect(mom.rpc('lq_create_mission', { p_actor: momMember, p_input: mission(kid, { xp: 151 }) })).rejects.toThrow(/invalid_number/)
    await expect(mom.rpc('lq_create_mission', { p_actor: momMember, p_input: mission(kid, { coins: -1 }) })).rejects.toThrow(/invalid_number/)
    await mom.rpc('lq_create_mission', { p_actor: momMember, p_input: mission(kid, { difficulty: 'special', xp: 500, coins: 1000 }) })
  })

  it('un niño sólo propone para sí; el adulto aprueba (con ediciones) y sólo entonces se puede completar', async () => {
    const { mom, momMember, kid } = await family()
    const sibling = await mom.rpc<string>('lq_add_child', { p_actor: momMember, p_name: 'Leo', p_age_band: 'teen' })
    await expect(mom.rpc('lq_create_mission', { p_actor: kid, p_input: mission(sibling) })).rejects.toThrow(/forbidden/)
    const p = await mom.rpc<string>('lq_create_mission', { p_actor: kid, p_input: mission(kid, { title: 'Leer' }) })
    expect((await mom.sel('select status from missions where id = $1', [p]))[0].status).toBe('proposed')
    await expect(mom.rpc('lq_complete_mission', { p_actor: kid, p_mission: p, p_member: kid, p_date: null })).rejects.toThrow(/inactive/)
    await expect(mom.rpc('lq_review_mission', { p_actor: kid, p_mission: p, p_decision: 'approve', p_note: null, p_edits: null })).rejects.toThrow(/forbidden/)
    await mom.rpc('lq_review_mission', { p_actor: momMember, p_mission: p, p_decision: 'approve', p_note: null, p_edits: { xp: 20 } })
    const row = (await mom.sel('select status, xp, reviewed_by from missions where id = $1', [p]))[0]
    expect(row).toEqual({ status: 'active', xp: 20, reviewed_by: momMember })
  })

  it('un niño no puede completar misiones ajenas; no asignadas, suspendidas y días que no tocan se rechazan', async () => {
    const { mom, momMember, kid } = await family()
    const sibling = await mom.rpc<string>('lq_add_child', { p_actor: momMember, p_name: 'Leo', p_age_band: 'teen' })
    const m = await mom.rpc<string>('lq_create_mission', { p_actor: momMember, p_input: mission(kid) })
    await expect(mom.rpc('lq_complete_mission', { p_actor: kid, p_mission: m, p_member: sibling, p_date: null })).rejects.toThrow(/forbidden/)
    await expect(mom.rpc('lq_complete_mission', { p_actor: sibling, p_mission: m, p_member: sibling, p_date: null })).rejects.toThrow(/not_assigned/)
    await expect(mom.rpc('lq_complete_mission', { p_actor: momMember, p_mission: m, p_member: kid, p_date: '2999-01-01' })).rejects.toThrow(/future/)
    const otherDay = (new Date().getUTCDay() + 3) % 7
    const m2 = await mom.rpc<string>('lq_create_mission', { p_actor: momMember, p_input: mission(kid, { recurrence: { type: 'days', days: [otherDay] } }) })
    await expect(mom.rpc('lq_complete_mission', { p_actor: kid, p_mission: m2, p_member: kid, p_date: null })).rejects.toThrow(/not_due/)
    await mom.rpc('lq_set_mission_status', { p_actor: momMember, p_mission: m, p_status: 'suspended' })
    await expect(mom.rpc('lq_complete_mission', { p_actor: kid, p_mission: m, p_member: kid, p_date: null })).rejects.toThrow(/inactive/)
  })

  it('correcciones exigen motivo y no dejan saldos negativos; el ledger es idempotente por restricción única', async () => {
    const { mom, momMember, kid } = await family()
    await expect(mom.rpc('lq_correct_ledger', { p_actor: momMember, p_member: kid, p_xp: 0, p_coins: -10, p_reason: '' })).rejects.toThrow(/invalid_text/)
    await mom.rpc('lq_correct_ledger', { p_actor: momMember, p_member: kid, p_xp: 10, p_coins: -10, p_reason: 'Error de captura' })
    expect(await balance(mom, kid)).toEqual({ xp: 10, coins: 40 })
    await expect(mom.rpc('lq_correct_ledger', { p_actor: momMember, p_member: kid, p_xp: 0, p_coins: -500, p_reason: 'Demasiado' })).rejects.toThrow(/negative_balance/)
    await expect(mom.rpc('lq_correct_ledger', { p_actor: kid, p_member: kid, p_xp: 100, p_coins: 100, p_reason: 'trampa' })).rejects.toThrow(/forbidden/)
    // Un segundo "welcome" para el mismo jugador viola la restricción única.
    await expect(pg.query(`insert into ledger (member_id, coins, reason, ref_type, ref_id, actor_id) values ($1, 50, 'dup', 'welcome', 'welcome', $1)`, [kid])).rejects.toThrow(/duplicate key/)
  })
})

describe('tienda digital', () => {
  it('compra descuenta una vez, agrega inventario, no duplica y respeta saldo y nivel', async () => {
    const { mom, momMember, kid } = await family()
    await mom.rpc('lq_buy_item', { p_actor: kid, p_item: 'ac-visor' }) // 30
    expect((await balance(mom, kid)).coins).toBe(20)
    await expect(mom.rpc('lq_buy_item', { p_actor: kid, p_item: 'ac-visor' })).rejects.toThrow(/owned/)
    await expect(mom.rpc('lq_buy_item', { p_actor: kid, p_item: 'bg-grid' })).rejects.toThrow(/insufficient_funds/)
    await expect(mom.rpc('lq_buy_item', { p_actor: kid, p_item: 'ac-crown' })).rejects.toThrow(/level_required|insufficient_funds/)
    await expect(mom.rpc('lq_buy_item', { p_actor: momMember, p_item: 'bg-grid' })).rejects.toThrow(/not_player/)
    expect((await balance(mom, kid)).coins).toBe(20)
  })

  it('equipar refleja el avatar y se puede quitar', async () => {
    const { mom, kid } = await family()
    await mom.rpc('lq_buy_item', { p_actor: kid, p_item: 'ac-visor' })
    await mom.rpc('lq_equip_item', { p_actor: kid, p_member: kid, p_item: 'ac-visor' })
    expect((await mom.sel('select avatar from members where id = $1', [kid]))[0].avatar.accessory).toBe('🥽')
    await mom.rpc('lq_equip_item', { p_actor: kid, p_member: kid, p_item: 'ac-visor' })
    expect((await mom.sel('select avatar from members where id = $1', [kid]))[0].avatar.accessory).toBeNull()
    await expect(mom.rpc('lq_equip_item', { p_actor: kid, p_member: kid, p_item: 'ac-crown' })).rejects.toThrow(/not_owned/)
  })
})

describe('recompensas familiares y canjes', () => {
  async function withReward(price = 40) {
    const f = await family()
    const reward = await f.mom.rpc<string>('lq_create_reward', { p_actor: f.momMember, p_name: 'Elegir la película', p_description: '', p_price: price, p_conditions: '' })
    return { ...f, reward }
  }
  const held = async (f: Awaited<ReturnType<typeof withReward>>) =>
    (await f.mom.sel(`select coalesce(sum(price),0)::int h from redemptions where member_id = $1 and status in ('pending','rescheduled')`, [f.kid]))[0].h

  it('un niño propone; sólo aprobada se puede canjear', async () => {
    const f = await family()
    const r = await f.mom.rpc<string>('lq_create_reward', { p_actor: f.kid, p_name: 'Pizza', p_description: '', p_price: 30, p_conditions: '' })
    await expect(f.mom.rpc('lq_request_redemption', { p_actor: f.kid, p_reward: r })).rejects.toThrow(/unavailable/)
    await f.mom.rpc('lq_review_reward', { p_actor: f.momMember, p_reward: r, p_decision: 'approve', p_name: null, p_price: 35, p_conditions: null })
    expect((await f.mom.sel('select price, status from rewards where id = $1', [r]))[0]).toEqual({ price: 35, status: 'approved' })
    await f.mom.rpc('lq_request_redemption', { p_actor: f.kid, p_reward: r })
  })

  it('las monedas se retienen al pedir y se descuentan sólo al aprobar; no se reservan dos veces', async () => {
    const f = await withReward(40)
    const red = await f.mom.rpc<string>('lq_request_redemption', { p_actor: f.kid, p_reward: f.reward })
    expect(await held(f)).toBe(40)
    expect((await balance(f.mom, f.kid)).coins).toBe(50)
    await expect(f.mom.rpc('lq_request_redemption', { p_actor: f.kid, p_reward: f.reward })).rejects.toThrow(/insufficient_funds/)
    await expect(f.mom.rpc('lq_buy_item', { p_actor: f.kid, p_item: 'ac-visor' })).rejects.toThrow(/insufficient_funds/)
    await f.mom.rpc('lq_review_redemption', { p_actor: f.momMember, p_redemption: red, p_decision: 'approve', p_note: null, p_scheduled_for: null })
    expect((await balance(f.mom, f.kid)).coins).toBe(10)
    expect(await held(f)).toBe(0)
    await expect(f.mom.rpc('lq_review_redemption', { p_actor: f.momMember, p_redemption: red, p_decision: 'approve', p_note: null, p_scheduled_for: null })).rejects.toThrow(/already_reviewed/)
  })

  it('rechazar exige explicación y libera la reserva; reprogramar la mantiene; devolver restituye una vez', async () => {
    const f = await withReward(40)
    const r1 = await f.mom.rpc<string>('lq_request_redemption', { p_actor: f.kid, p_reward: f.reward })
    await expect(f.mom.rpc('lq_review_redemption', { p_actor: f.momMember, p_redemption: r1, p_decision: 'reject', p_note: null, p_scheduled_for: null })).rejects.toThrow(/note_required/)
    await f.mom.rpc('lq_review_redemption', { p_actor: f.momMember, p_redemption: r1, p_decision: 'reject', p_note: 'Hoy hay colegio', p_scheduled_for: null })
    expect(await held(f)).toBe(0)
    expect((await balance(f.mom, f.kid)).coins).toBe(50)

    const r2 = await f.mom.rpc<string>('lq_request_redemption', { p_actor: f.kid, p_reward: f.reward })
    await f.mom.rpc('lq_review_redemption', { p_actor: f.momMember, p_redemption: r2, p_decision: 'reschedule', p_note: 'El sábado', p_scheduled_for: '2030-01-05' })
    expect(await held(f)).toBe(40)
    await f.mom.rpc('lq_review_redemption', { p_actor: f.momMember, p_redemption: r2, p_decision: 'approve', p_note: null, p_scheduled_for: null })
    expect((await balance(f.mom, f.kid)).coins).toBe(10)
    await f.mom.rpc('lq_refund_redemption', { p_actor: f.momMember, p_redemption: r2, p_note: 'No pudimos' })
    expect((await balance(f.mom, f.kid)).coins).toBe(50)
    await expect(f.mom.rpc('lq_refund_redemption', { p_actor: f.momMember, p_redemption: r2, p_note: null })).rejects.toThrow(/invalid_state/)
  })

  it('un niño no puede aprobar canjes ni crear recompensas activas; el precio se valida', async () => {
    const f = await withReward(10)
    const red = await f.mom.rpc<string>('lq_request_redemption', { p_actor: f.kid, p_reward: f.reward })
    await expect(f.mom.rpc('lq_review_redemption', { p_actor: f.kid, p_redemption: red, p_decision: 'approve', p_note: null, p_scheduled_for: null })).rejects.toThrow(/forbidden/)
    const r = await f.mom.rpc<string>('lq_create_reward', { p_actor: f.kid, p_name: 'Gratis', p_description: '', p_price: 1, p_conditions: '' })
    expect((await f.mom.sel('select status from rewards where id = $1', [r]))[0].status).toBe('proposed')
    await expect(f.mom.rpc('lq_create_reward', { p_actor: f.momMember, p_name: 'X', p_description: '', p_price: -1, p_conditions: '' })).rejects.toThrow(/invalid_number/)
  })
})

describe('progresión y eliminación de datos', () => {
  it('la fórmula SQL de niveles coincide con la de TypeScript (niveles 1 a 100)', async () => {
    for (let l = 1; l <= 100; l++) {
      const r = await pg.query<{ v: number }>('select lq_private.xp_for_level($1::int) v', [l])
      expect(r.rows[0].v, `nivel ${l}`).toBe(xpForLevel(l))
    }
    const lvl = await pg.query<{ v: number }>('select lq_private.level_for_xp(60) v')
    expect(lvl.rows[0].v).toBe(2)
  })

  it('eliminar un niño borra su progreso; eliminar la cuenta del único adulto borra la familia entera', async () => {
    const { mom, momMember, kid } = await family()
    const m = await mom.rpc<string>('lq_create_mission', { p_actor: momMember, p_input: mission(kid) })
    await mom.rpc('lq_remove_child', { p_actor: momMember, p_child: kid })
    expect(await mom.sel('select * from ledger where member_id = $1', [kid])).toHaveLength(0)
    expect((await mom.sel('select assignee_ids, status from missions where id = $1', [m]))[0]).toEqual({ assignee_ids: [], status: 'archived' })
    const fam = (await mom.sel('select id from families'))[0].id
    await mom.rpc('lq_delete_account')
    const left = await pg.query<{ n: number }>('select count(*)::int n from members where family_id = $1', [fam])
    expect(left.rows[0].n).toBe(0)
    expect((await pg.query<{ n: number }>('select count(*)::int n from auth.users where id = $1', [mom.id])).rows[0].n).toBe(0)
  })
})

describe('recompensas iniciales y consecuencias (migración 0002)', () => {
  const tenRewards = (n = 10) => Array.from({ length: n }, (_, i) => ({ name: `Premio ${i + 1}`, description: '', price: i * 10, conditions: '' }))

  it('exige 10 recompensas como mínimo, acepta precio 0, no se repite y es sólo para adultos', async () => {
    const { mom, momMember, kid } = await family()
    await expect(mom.rpc('lq_setup_rewards', { p_actor: momMember, p_rewards: tenRewards(9) })).rejects.toThrow(/too_few_rewards/)
    await expect(mom.rpc('lq_setup_rewards', { p_actor: kid, p_rewards: tenRewards(10) })).rejects.toThrow(/forbidden/)
    const dup = tenRewards(10)
    dup[1].name = 'premio 1'
    await expect(mom.rpc('lq_setup_rewards', { p_actor: momMember, p_rewards: dup })).rejects.toThrow(/duplicate_reward/)
    const bad = tenRewards(10)
    bad[3].price = -5
    await expect(mom.rpc('lq_setup_rewards', { p_actor: momMember, p_rewards: bad })).rejects.toThrow(/invalid_number/)
    expect(await mom.sel('select id from rewards')).toHaveLength(0) // nada a medias
    expect(await mom.rpc('lq_setup_rewards', { p_actor: momMember, p_rewards: tenRewards(12) })).toBe(12)
    const rows = await mom.sel('select price, status from rewards')
    expect(rows).toHaveLength(12)
    expect(rows.filter((r) => r.price === 0)).toHaveLength(1)
    expect(rows.every((r) => r.status === 'approved')).toBe(true)
    expect((await mom.sel('select rewards_setup_done d from families'))[0].d).toBe(true)
    await expect(mom.rpc('lq_setup_rewards', { p_actor: momMember, p_rewards: tenRewards(10) })).rejects.toThrow(/already_done/)
  })

  it('una recompensa gratuita se canjea sin gastar monedas y puede pedirse varias veces', async () => {
    const { mom, momMember, kid } = await family()
    const free = await mom.rpc<string>('lq_create_reward', { p_actor: momMember, p_name: 'Elegir primero', p_description: '', p_price: 0, p_conditions: '' })
    for (let i = 0; i < 2; i++) {
      const red = await mom.rpc<string>('lq_request_redemption', { p_actor: kid, p_reward: free })
      await mom.rpc('lq_review_redemption', { p_actor: momMember, p_redemption: red, p_decision: 'approve', p_note: null, p_scheduled_for: null })
    }
    expect((await balance(mom, kid)).coins).toBe(50)
    await expect(mom.rpc('lq_create_reward', { p_actor: momMember, p_name: 'X', p_description: '', p_price: -1, p_conditions: '' })).rejects.toThrow(/invalid_number/)
  })

  it('se canjea las veces que alcancen los créditos', async () => {
    const { mom, momMember, kid } = await family()
    const r = await mom.rpc<string>('lq_create_reward', { p_actor: momMember, p_name: 'Película', p_description: '', p_price: 20, p_conditions: '' })
    await mom.rpc('lq_request_redemption', { p_actor: kid, p_reward: r })
    await mom.rpc('lq_request_redemption', { p_actor: kid, p_reward: r })
    await expect(mom.rpc('lq_request_redemption', { p_actor: kid, p_reward: r })).rejects.toThrow(/insufficient_funds/)
  })

  it('crear consecuencias: confirmación, necesidades básicas, umbral, destinatarios y permisos', async () => {
    const { mom, momMember, kid } = await family()
    const mk = (over: Record<string, unknown> = {}) =>
      mom.rpc('lq_create_consequence', {
        p_actor: momMember, p_name: 'Pierdes una hora de tele', p_description: '', p_threshold: 30, p_applies_to: [kid], p_confirm: true, ...over,
      })
    await expect(mk({ p_confirm: false })).rejects.toThrow(/confirm_required/)
    await expect(mk({ p_name: 'No cenas hoy' })).rejects.toThrow(/essential_needs/)
    await expect(mk({ p_name: 'Sin dormir temprano' })).rejects.toThrow(/essential_needs/)
    await expect(mk({ p_description: 'Pierdes el desayuno' })).rejects.toThrow(/essential_needs/)
    await expect(mk({ p_name: 'Pierdes un abrazo' })).rejects.toThrow(/essential_needs/)
    await expect(mk({ p_threshold: 0 })).rejects.toThrow(/invalid_number/)
    await expect(mk({ p_applies_to: [] })).rejects.toThrow(/no_assignee/)
    await expect(mk({ p_applies_to: [momMember] })).rejects.toThrow(/not_player/)
    await expect(mom.rpc('lq_create_consequence', { p_actor: kid, p_name: 'x', p_description: '', p_threshold: 5, p_applies_to: [kid], p_confirm: true })).rejects.toThrow(/forbidden/)
    const id = await mk()
    expect((await mom.sel('select threshold_coins, status from consequences where id = $1', [id]))[0]).toEqual({ threshold_coins: 30, status: 'active' })
    await mom.rpc('lq_archive_consequence', { p_actor: momMember, p_rule: id })
    expect((await mom.sel('select status from consequences where id = $1', [id]))[0].status).toBe('archived')
  })

  it('las consecuencias son privadas por familia y el cliente no puede escribirlas', async () => {
    const a = await family()
    const b = await family()
    const id = await a.mom.rpc<string>('lq_create_consequence', { p_actor: a.momMember, p_name: 'Algo', p_description: '', p_threshold: 10, p_applies_to: [a.kid], p_confirm: true })
    expect(await b.mom.sel('select * from consequences')).toHaveLength(0)
    await expect(b.mom.rpc('lq_archive_consequence', { p_actor: b.momMember, p_rule: id })).rejects.toThrow(/forbidden/)
    await expect(a.mom.sel(`update consequences set status = 'archived'`)).rejects.toThrow(/permission denied/)
    await expect(a.mom.sel(`insert into consequences (family_id, name, threshold_coins, applies_to, created_by) values ($1, 'x', 1, '{}', $2)`, [(await a.mom.sel('select id from families'))[0].id, a.momMember])).rejects.toThrow(/permission denied/)
  })

  it('eliminar a un niño lo quita de las consecuencias y retira las que quedan vacías', async () => {
    const { mom, momMember, kid } = await family()
    const id = await mom.rpc<string>('lq_create_consequence', { p_actor: momMember, p_name: 'Algo', p_description: '', p_threshold: 10, p_applies_to: [kid], p_confirm: true })
    await mom.rpc('lq_remove_child', { p_actor: momMember, p_child: kid })
    expect((await mom.sel('select applies_to, status from consequences where id = $1', [id]))[0]).toEqual({ applies_to: [], status: 'archived' })
  })

  it('el SQL reconoce las mismas palabras de necesidades básicas que TypeScript', async () => {
    const { touchesEssentialNeeds } = await import('../../src/domain/engine')
    for (const t of ['No cenas hoy', 'Sin dormir', 'Pierdes el desayuno', 'Un abrazo', 'Sin agua', 'Sin tele por una hora', 'Menos videojuegos', 'Una salida al parque', 'Sueño', 'Cariño', 'Bañarse']) {
      const r = await pg.query<{ v: boolean }>('select lq_private.touches_essentials($1) v', [t])
      expect(r.rows[0].v, t).toBe(touchesEssentialNeeds(t))
    }
  })
})
