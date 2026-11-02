import { beforeEach, describe, expect, it } from 'vitest'
import * as E from './engine'
import { levelForXp, levelProgress, xpForLevel } from './progression'
import { periodKey } from './recurrence'
import { DomainError, type Db, type Member } from './types'

let n = 0
let clock = new Date('2026-03-10T12:00:00') // martes
const ctx: E.Ctx = { now: () => clock, id: () => `id${String(++n).padStart(6, '0')}abcdef` }

let db: Db
let mom: Member
let kid: Member
let kid2: Member
const hash = { passwordHash: 'h', salt: 's' }

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof DomainError) return e.code
    throw e
  }
  return 'no_error'
}

function mission(overrides: Partial<E.MissionInput> = {}) {
  return E.createMission(db, ctx, mom, {
    title: 'Tender la cama', category: 'discipline', difficulty: 'easy', assigneeIds: [kid.id], recurrence: { type: 'daily' }, ...overrides,
  })
}

beforeEach(() => {
  n = 0
  clock = new Date('2026-03-10T12:00:00')
  db = E.emptyDb()
  const acc = E.registerAccount(db, ctx, { email: 'mama@example.com', ...hash })
  mom = E.createFamily(db, ctx, acc.id, { familyName: 'Los Pérez', guardianName: 'Mamá', playsGame: false }).member
  kid = E.addChild(db, ctx, mom, { name: 'Ana', ageBand: 'kid' })
  kid2 = E.addChild(db, ctx, mom, { name: 'Leo', ageBand: 'teen' })
})

describe('progresión', () => {
  it('cada nivel exige más XP que el anterior', () => {
    for (let l = 2; l < 60; l++) expect(xpForLevel(l + 1) - xpForLevel(l)).toBeGreaterThan(xpForLevel(l) - xpForLevel(l - 1))
  })
  it('calcula niveles y barra de progreso', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(59)).toBe(1)
    expect(levelForXp(60)).toBe(2)
    expect(xpForLevel(20)).toBe(4969)
    const p = levelProgress(30)
    expect(p.level).toBe(1)
    expect(p.ratio).toBeCloseTo(0.5)
  })
})

describe('recurrencia', () => {
  it('daily, días concretos y semanal', () => {
    expect(periodKey({ recurrence: { type: 'daily' } }, '2026-03-10')).toBe('2026-03-10')
    expect(periodKey({ recurrence: { type: 'days', days: [1, 3] } }, '2026-03-10')).toBeNull() // martes
    expect(periodKey({ recurrence: { type: 'days', days: [2] } }, '2026-03-10')).toBe('2026-03-10')
    expect(periodKey({ recurrence: { type: 'weekly' } }, '2026-03-12')).toBe('2026-03-09') // lunes de esa semana
    expect(periodKey({ recurrence: { type: 'weekly' } }, '2026-03-15')).toBe('2026-03-09') // domingo
  })
})

describe('cuentas y familias', () => {
  it('rechaza correos repetidos o inválidos', () => {
    expect(code(() => E.registerAccount(db, ctx, { email: 'MAMA@example.com', ...hash }))).toBe('email_taken')
    expect(code(() => E.registerAccount(db, ctx, { email: 'nope', ...hash }))).toBe('invalid_email')
  })
  it('el niño no tiene cuenta y arranca con monedas de bienvenida; el guardián que no juega no', () => {
    expect(kid.accountId).toBeNull()
    expect(E.memberStats(db, kid.id).coins).toBe(50)
    expect(E.memberStats(db, mom.id).coins).toBe(0)
  })
  it('un guardián que empieza a jugar recibe la bienvenida una sola vez', () => {
    E.setPlaysGame(db, ctx, mom, true)
    E.setPlaysGame(db, ctx, mom, false)
    E.setPlaysGame(db, ctx, mom, true)
    expect(E.memberStats(db, mom.id).coins).toBe(50)
  })
  it('una cuenta no puede crear dos familias', () => {
    expect(code(() => E.createFamily(db, ctx, mom.accountId!, { familyName: 'X', guardianName: 'Y', playsGame: true }))).toBe('already_set_up')
  })
  it('segundo adulto por invitación; máximo dos; invitación expira', () => {
    const invite = E.createInvite(db, ctx, mom)
    const acc2 = E.registerAccount(db, ctx, { email: 'papa@example.com', ...hash })
    clock = new Date(clock.getTime() + 49 * 3600_000)
    expect(code(() => E.joinFamily(db, ctx, acc2.id, { inviteCode: invite, name: 'Papá', playsGame: true }))).toBe('invalid_invite')
    clock = new Date('2026-03-10T12:00:00')
    const inv2 = E.createInvite(db, ctx, mom)
    const dad = E.joinFamily(db, ctx, acc2.id, { inviteCode: inv2, name: 'Papá', playsGame: true }).member
    expect(dad.role).toBe('guardian')
    expect(code(() => E.createInvite(db, ctx, mom))).toBe('limit')
  })
  it('una aventura individual no admite niños', () => {
    const acc = E.registerAccount(db, ctx, { email: 'solo@example.com', ...hash })
    const solo = E.createSolo(db, ctx, acc.id, { name: 'Sam' }).member
    expect(code(() => E.addChild(db, ctx, solo, { name: 'X', ageBand: 'kid' }))).toBe('solo')
  })
  it('resolveActor impide actuar sobre perfiles de otra familia', () => {
    const other = E.registerAccount(db, ctx, { email: 'otra@example.com', ...hash })
    E.createFamily(db, ctx, other.id, { familyName: 'Otra', guardianName: 'Z', playsGame: true })
    expect(code(() => E.resolveActor(db, other.id, kid.id))).toBe('forbidden')
    expect(E.resolveActor(db, mom.accountId!, kid.id).id).toBe(kid.id)
  })
  it('el snapshot nunca incluye datos de otras familias', () => {
    const other = E.registerAccount(db, ctx, { email: 'otra@example.com', ...hash })
    const m2 = E.createFamily(db, ctx, other.id, { familyName: 'Otra', guardianName: 'Z', playsGame: true }).member
    E.createMission(db, ctx, m2, { title: 'Secreta', category: 'health', difficulty: 'easy', assigneeIds: [m2.id] })
    const snap = E.snapshotFor(db, mom.accountId!)!
    expect(snap.missions.some((m) => m.title === 'Secreta')).toBe(false)
    expect(snap.members.every((m) => m.familyId === mom.familyId)).toBe(true)
  })
})

describe('misiones y permisos', () => {
  it('un guardián crea misiones activas; un niño sólo propone para sí', () => {
    expect(mission().status).toBe('active')
    const prop = E.createMission(db, ctx, kid, { title: 'Leer 20 min', category: 'education', difficulty: 'easy', assigneeIds: [kid.id] })
    expect(prop.status).toBe('proposed')
    expect(code(() => E.createMission(db, ctx, kid, { title: 'Para mi hermano', category: 'health', difficulty: 'easy', assigneeIds: [kid2.id] }))).toBe('forbidden')
  })
  it('un niño no puede aprobar propuestas ni modificar misiones', () => {
    const prop = E.createMission(db, ctx, kid, { title: 'Leer', category: 'education', difficulty: 'easy', assigneeIds: [kid.id] })
    expect(code(() => E.reviewMissionProposal(db, ctx, kid, prop.id, 'approve'))).toBe('forbidden')
    const m = mission()
    expect(code(() => E.updateMission(db, ctx, kid, m.id, { xp: 150 }))).toBe('forbidden')
  })
  it('una propuesta no se puede completar hasta que se apruebe; el guardián puede editarla al aprobar', () => {
    const prop = E.createMission(db, ctx, kid, { title: 'Leer', category: 'education', difficulty: 'easy', assigneeIds: [kid.id], recurrence: { type: 'daily' } })
    expect(code(() => E.completeMission(db, ctx, kid, { missionId: prop.id, memberId: kid.id }))).toBe('inactive')
    E.reviewMissionProposal(db, ctx, mom, prop.id, 'approve', { edits: { xp: 20 } })
    expect(db.missions.find((m) => m.id === prop.id)).toMatchObject({ status: 'active', xp: 20, reviewedBy: mom.id })
  })
  it('valida topes de recompensa y valores inválidos', () => {
    expect(code(() => mission({ xp: 151 }))).toBe('invalid_number')
    expect(code(() => mission({ coins: -1 }))).toBe('invalid_number')
    expect(code(() => mission({ difficulty: 'special', xp: 500, coins: 1000 }))).toBe('no_error')
    expect(code(() => mission({ title: '  ' }))).toBe('invalid_text')
    expect(code(() => mission({ assigneeIds: [] }))).toBe('no_assignee')
    expect(code(() => mission({ recurrence: { type: 'days', days: [] } }))).toBe('invalid_recurrence')
  })
  it('no asigna misiones a un guardián que no juega', () => {
    expect(code(() => mission({ assigneeIds: [mom.id] }))).toBe('not_player')
  })
})

describe('completar y recompensas', () => {
  it('con aprobación: queda pendiente, no da nada hasta que un guardián aprueba', () => {
    const m = mission({ xp: 30, coins: 10 })
    const c = E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    expect(c.status).toBe('pending')
    expect(E.memberStats(db, kid.id)).toMatchObject({ xp: 0, coins: 50 })
    E.reviewCompletion(db, ctx, mom, c.id, 'approve')
    expect(E.memberStats(db, kid.id)).toMatchObject({ xp: 30, coins: 60 })
    expect(db.completions[0]).toMatchObject({ completedBy: kid.id, reviewedBy: mom.id })
  })
  it('sin aprobación requerida: se otorga al instante', () => {
    const m = mission({ requiresApproval: false, xp: 25, coins: 12 })
    E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    expect(E.memberStats(db, kid.id)).toMatchObject({ xp: 25, coins: 62 })
  })
  it('no se puede completar dos veces el mismo periodo (anti-duplicados)', () => {
    const m = mission({ requiresApproval: false })
    E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    expect(code(() => E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id }))).toBe('duplicate')
    expect(db.ledger.filter((e) => e.refType === 'completion')).toHaveLength(1)
    // Al día siguiente sí toca de nuevo
    clock = new Date('2026-03-11T09:00:00')
    expect(code(() => E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id }))).toBe('no_error')
  })
  it('revisar dos veces no duplica la recompensa', () => {
    const m = mission({ xp: 30 })
    const c = E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    E.reviewCompletion(db, ctx, mom, c.id, 'approve')
    expect(code(() => E.reviewCompletion(db, ctx, mom, c.id, 'approve'))).toBe('already_reviewed')
    expect(E.memberStats(db, kid.id).xp).toBe(30)
  })
  it('rechazo: no otorga nada y permite reenviar; no se pierden XP ni niveles', () => {
    const m = mission({ xp: 30 })
    const c = E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    E.reviewCompletion(db, ctx, mom, c.id, 'reject', { note: 'Falta la almohada' })
    expect(E.memberStats(db, kid.id).xp).toBe(0)
    const again = E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    expect(again.id).toBe(c.id)
    E.reviewCompletion(db, ctx, mom, again.id, 'approve')
    expect(E.memberStats(db, kid.id).xp).toBe(30)
  })
  it('el bono por iniciativa sólo se paga si el guardián lo marca', () => {
    const m = mission({ xp: 20, coins: 10, initiativeXp: 5, initiativeCoins: 5 })
    const c = E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    E.reviewCompletion(db, ctx, mom, c.id, 'approve', { initiative: true })
    expect(E.memberStats(db, kid.id)).toMatchObject({ xp: 25, coins: 65 })
  })
  it('un niño no puede completar misiones ajenas, de otros días ni futuras; no aprueba su propio trabajo', () => {
    const m = mission({ assigneeIds: [kid.id, kid2.id] })
    expect(code(() => E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid2.id }))).toBe('forbidden')
    expect(code(() => E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id, dateKey: '2026-03-09' }))).toBe('forbidden')
    expect(code(() => E.completeMission(db, ctx, mom, { missionId: m.id, memberId: kid.id, dateKey: '2026-03-12' }))).toBe('future')
    const c = E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    expect(code(() => E.reviewCompletion(db, ctx, kid, c.id, 'approve'))).toBe('forbidden')
  })
  it('respeta misiones no asignadas, suspendidas y días que no tocan', () => {
    const m = mission({ assigneeIds: [kid.id], recurrence: { type: 'days', days: [1] } }) // lunes
    expect(code(() => E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id }))).toBe('not_due')
    const m2 = mission({ assigneeIds: [kid.id] })
    expect(code(() => E.completeMission(db, ctx, kid2, { missionId: m2.id, memberId: kid2.id }))).toBe('not_assigned')
    E.setMissionStatus(db, ctx, mom, m2.id, 'suspended')
    expect(code(() => E.completeMission(db, ctx, kid, { missionId: m2.id, memberId: kid.id }))).toBe('inactive')
  })
  it('editar una misión no altera lo ya ganado', () => {
    const m = mission({ xp: 30, requiresApproval: false })
    E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    E.updateMission(db, ctx, mom, m.id, { xp: 5 })
    expect(E.memberStats(db, kid.id).xp).toBe(30)
  })
  it('el progreso de cada hijo está completamente separado', () => {
    const m = mission({ assigneeIds: [kid.id, kid2.id], requiresApproval: false, xp: 40 })
    E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    expect(E.memberStats(db, kid.id).xp).toBe(40)
    expect(E.memberStats(db, kid2.id).xp).toBe(0)
  })
  it('sube de nivel automáticamente', () => {
    const m = mission({ difficulty: 'special', xp: 100, requiresApproval: false, recurrence: { type: 'once' } })
    E.completeMission(db, ctx, kid, { missionId: m.id, memberId: kid.id })
    expect(E.memberStats(db, kid.id).level).toBe(2)
  })
  it('un guardián que juega se autoaprueba; en modo solo nunca hay pendientes', () => {
    E.setPlaysGame(db, ctx, mom, true)
    const m = mission({ assigneeIds: [mom.id] })
    expect(E.completeMission(db, ctx, mom, { missionId: m.id, memberId: mom.id }).status).toBe('approved')
    const acc = E.registerAccount(db, ctx, { email: 'solo@example.com', ...hash })
    const solo = E.createSolo(db, ctx, acc.id, { name: 'Sam' }).member
    const sm = E.createMission(db, ctx, solo, { title: 'Correr', category: 'health', difficulty: 'easy', assigneeIds: [solo.id], requiresApproval: true })
    expect(sm.requiresApproval).toBe(false)
  })
})

describe('eliminación de perfiles', () => {
  it('borra el progreso del niño y archiva las misiones que quedan sin jugadores', () => {
    const solo = mission({ assigneeIds: [kid.id] })
    const shared = mission({ assigneeIds: [kid.id, kid2.id], title: 'Compartida' })
    E.removeChild(db, ctx, mom, kid.id)
    expect(db.members.some((m) => m.id === kid.id)).toBe(false)
    expect(db.ledger.some((e) => e.memberId === kid.id)).toBe(false)
    expect(db.missions.find((m) => m.id === solo.id)!.status).toBe('archived')
    expect(db.missions.find((m) => m.id === shared.id)).toMatchObject({ status: 'active', assigneeIds: [kid2.id] })
    expect(code(() => E.removeChild(db, ctx, kid2, kid2.id))).toBe('forbidden')
  })
})

describe('correcciones', () => {
  it('exigen motivo, quedan registradas y no permiten saldos negativos', () => {
    expect(code(() => E.correctLedger(db, ctx, mom, kid.id, { xp: 0, coins: -10, reason: '' }))).toBe('invalid_text')
    E.correctLedger(db, ctx, mom, kid.id, { xp: 10, coins: -10, reason: 'Error de captura' })
    expect(E.memberStats(db, kid.id)).toMatchObject({ xp: 10, coins: 40 })
    expect(code(() => E.correctLedger(db, ctx, mom, kid.id, { xp: 0, coins: -500, reason: 'Demasiado' }))).toBe('negative_balance')
    expect(code(() => E.correctLedger(db, ctx, kid, kid.id, { xp: 100, coins: 100, reason: 'trampa' }))).toBe('forbidden')
  })
})

describe('tienda digital', () => {
  it('compra descuenta monedas, agrega al inventario y no permite duplicados', () => {
    E.buyCatalogItem(db, ctx, kid, 'ac-visor') // 30
    expect(E.memberStats(db, kid.id).coins).toBe(20)
    expect(db.inventory.some((i) => i.memberId === kid.id && i.itemId === 'ac-visor')).toBe(true)
    expect(code(() => E.buyCatalogItem(db, ctx, kid, 'ac-visor'))).toBe('owned')
  })
  it('verifica saldo y nivel mínimo antes de descontar', () => {
    expect(code(() => E.buyCatalogItem(db, ctx, kid, 'bg-grid'))).toBe('no_error') // 40 <= 50
    expect(code(() => E.buyCatalogItem(db, ctx, kid, 'fr-violet'))).toBe('insufficient_funds') // quedan 10
    expect(code(() => E.buyCatalogItem(db, ctx, kid2, 'ac-crown'))).toBe('level_required')
    expect(E.memberStats(db, kid2.id).coins).toBe(50)
  })
  it('equipar refleja el cambio en el avatar y se puede quitar', () => {
    E.buyCatalogItem(db, ctx, kid, 'ac-visor')
    E.equipItem(db, kid, kid.id, 'ac-visor')
    expect(kid.avatar.accessory).toBe('🥽')
    E.equipItem(db, kid, kid.id, 'ac-visor')
    expect(kid.avatar.accessory).toBeNull()
    expect(code(() => E.equipItem(db, kid, kid.id, 'ac-crown'))).toBe('not_owned')
    expect(code(() => E.equipItem(db, kid, kid2.id, 'bg-nebula'))).toBe('forbidden')
  })
  it('un guardián que no juega no puede comprar', () => {
    expect(code(() => E.buyCatalogItem(db, ctx, mom, 'bg-grid'))).toBe('not_player')
  })
})

describe('recompensas familiares y canjes', () => {
  function reward(price = 40) {
    return E.createReward(db, ctx, mom, { name: 'Elegir la película', price })
  }
  it('un niño sólo propone; no se puede canjear hasta que se aprueba', () => {
    const r = E.createReward(db, ctx, kid, { name: 'Noche de pizza', price: 30 })
    expect(r.status).toBe('proposed')
    expect(code(() => E.requestRedemption(db, ctx, kid, r.id))).toBe('unavailable')
    E.reviewReward(db, ctx, mom, r.id, 'approve', { price: 35 })
    expect(code(() => E.requestRedemption(db, ctx, kid, r.id))).toBe('no_error')
    expect(db.rewards.find((x) => x.id === r.id)!.price).toBe(35)
  })
  it('las monedas se retienen al pedir y se descuentan sólo al aprobar', () => {
    const r = reward(40)
    const red = E.requestRedemption(db, ctx, kid, r.id)
    expect(E.memberStats(db, kid.id)).toMatchObject({ coins: 50, held: 40, available: 10 })
    expect(code(() => E.buyCatalogItem(db, ctx, kid, 'ac-visor'))).toBe('insufficient_funds') // la reserva cuenta
    E.reviewRedemption(db, ctx, mom, red.id, 'approve')
    expect(E.memberStats(db, kid.id)).toMatchObject({ coins: 10, held: 0, available: 10 })
  })
  it('no se puede pedir más de lo disponible ni reservar dos veces las mismas monedas', () => {
    const r = reward(40)
    E.requestRedemption(db, ctx, kid, r.id)
    expect(code(() => E.requestRedemption(db, ctx, kid, r.id))).toBe('insufficient_funds')
  })
  it('rechazar exige explicación y libera la reserva sin descontar nada', () => {
    const r = reward(40)
    const red = E.requestRedemption(db, ctx, kid, r.id)
    expect(code(() => E.reviewRedemption(db, ctx, mom, red.id, 'reject'))).toBe('note_required')
    E.reviewRedemption(db, ctx, mom, red.id, 'reject', { note: 'Hoy es día de colegio' })
    expect(E.memberStats(db, kid.id)).toMatchObject({ coins: 50, held: 0, available: 50 })
  })
  it('reprogramar mantiene la reserva; aprobar después descuenta; aprobar dos veces no duplica', () => {
    const r = reward(40)
    const red = E.requestRedemption(db, ctx, kid, r.id)
    E.reviewRedemption(db, ctx, mom, red.id, 'reschedule', { scheduledFor: '2026-03-14', note: 'El sábado' })
    expect(red.status).toBe('rescheduled')
    expect(E.memberStats(db, kid.id).held).toBe(40)
    E.reviewRedemption(db, ctx, mom, red.id, 'approve')
    expect(code(() => E.reviewRedemption(db, ctx, mom, red.id, 'approve'))).toBe('already_reviewed')
    expect(E.memberStats(db, kid.id).coins).toBe(10)
  })
  it('devolver un canje aprobado restituye las monedas una sola vez', () => {
    const r = reward(40)
    const red = E.requestRedemption(db, ctx, kid, r.id)
    E.reviewRedemption(db, ctx, mom, red.id, 'approve')
    E.refundRedemption(db, ctx, mom, red.id, 'No pudimos cumplirlo')
    expect(E.memberStats(db, kid.id).coins).toBe(50)
    expect(code(() => E.refundRedemption(db, ctx, mom, red.id))).toBe('invalid_state')
  })
  it('un niño no puede aprobar canjes ni crear recompensas activas', () => {
    const r = reward(10)
    const red = E.requestRedemption(db, ctx, kid, r.id)
    expect(code(() => E.reviewRedemption(db, ctx, kid, red.id, 'approve'))).toBe('forbidden')
    expect(E.createReward(db, ctx, kid, { name: 'Gratis', price: 1 }).status).toBe('proposed')
  })
  it('valida precio', () => {
    expect(code(() => E.createReward(db, ctx, mom, { name: 'X', price: -1 }))).toBe('invalid_number')
    expect(code(() => E.createReward(db, ctx, mom, { name: 'Gratis', price: 0 }))).toBe('no_error')
    expect(code(() => E.createReward(db, ctx, mom, { name: 'X', price: 1_000_000 }))).toBe('invalid_number')
  })
})

describe('invariantes del ledger', () => {
  it('xp y monedas siempre coinciden con la suma del ledger y no hay saldos negativos', () => {
    const m = mission({ requiresApproval: false, xp: 20, coins: 8 })
    for (const d of ['2026-03-08', '2026-03-09', '2026-03-10']) E.completeMission(db, ctx, mom, { missionId: m.id, memberId: kid.id, dateKey: d })
    E.buyCatalogItem(db, ctx, kid, 'ac-visor')
    const sum = db.ledger.filter((e) => e.memberId === kid.id)
    expect(E.memberStats(db, kid.id).xp).toBe(sum.reduce((a, e) => a + e.xp, 0))
    expect(E.memberStats(db, kid.id).coins).toBe(sum.reduce((a, e) => a + e.coins, 0))
    expect(E.memberStats(db, kid.id).coins).toBeGreaterThanOrEqual(0)
    expect(sum.every((e) => e.reason && e.createdAt && e.actorId)).toBe(true)
  })
})

describe('lista inicial de recompensas', () => {
  const items = (n: number, extra: Partial<E.RewardInput>[] = []): E.RewardInput[] =>
    Array.from({ length: n }, (_, i) => ({ name: `Premio ${i + 1}`, price: (i + 1) * 10, ...(extra[i] ?? {}) }))

  it('exige al menos 10 recompensas y no deja la lista a medias', () => {
    expect(code(() => E.setupRewards(db, ctx, mom, items(9)))).toBe('too_few_rewards')
    expect(db.rewards).toHaveLength(0)
    expect(db.families[0].rewardsSetupDone).toBe(false)
  })
  it('acepta 10 o más, algunas gratis, y deja las recompensas aprobadas y disponibles', () => {
    const list = items(12, [{ price: 0 }, { price: 0 }])
    E.setupRewards(db, ctx, mom, list)
    expect(db.rewards).toHaveLength(12)
    expect(db.rewards.every((r) => r.status === 'approved')).toBe(true)
    expect(db.rewards.filter((r) => r.price === 0)).toHaveLength(2)
    expect(db.families[0].rewardsSetupDone).toBe(true)
  })
  it('rechaza nombres repetidos, precios inválidos, niños y repetir la configuración', () => {
    expect(code(() => E.setupRewards(db, ctx, mom, items(10, [{ name: 'Premio 1' }, { name: 'premio 1' }])))).toBe('duplicate_reward')
    expect(code(() => E.setupRewards(db, ctx, mom, items(10, [{ price: -1 }])))).toBe('invalid_number')
    expect(code(() => E.setupRewards(db, ctx, kid, items(10)))).toBe('forbidden')
    E.setupRewards(db, ctx, mom, items(10))
    expect(code(() => E.setupRewards(db, ctx, mom, items(10)))).toBe('already_done')
  })
  it('una recompensa gratuita se canjea sin gastar monedas, y se puede pedir varias veces', () => {
    const free = E.createReward(db, ctx, mom, { name: 'Elegir primero', price: 0 })
    const r1 = E.requestRedemption(db, ctx, kid, free.id)
    E.reviewRedemption(db, ctx, mom, r1.id, 'approve')
    const r2 = E.requestRedemption(db, ctx, kid, free.id)
    E.reviewRedemption(db, ctx, mom, r2.id, 'approve')
    expect(E.memberStats(db, kid.id).coins).toBe(50)
  })
  it('se canjea las veces que alcancen los créditos, y no más', () => {
    const r = E.createReward(db, ctx, mom, { name: 'Película', price: 20 })
    E.requestRedemption(db, ctx, kid, r.id)
    E.requestRedemption(db, ctx, kid, r.id) // 40 reservadas
    expect(code(() => E.requestRedemption(db, ctx, kid, r.id))).toBe('insufficient_funds') // sólo quedan 10
    for (const red of db.redemptions) E.reviewRedemption(db, ctx, mom, red.id, 'approve')
    expect(E.memberStats(db, kid.id).coins).toBe(10)
    E.correctLedger(db, ctx, mom, kid.id, { xp: 0, coins: 30, reason: 'Ajuste de prueba' })
    expect(code(() => E.requestRedemption(db, ctx, kid, r.id))).toBe('no_error') // vuelve a alcanzar
  })
})

describe('consecuencias acordadas', () => {
  const rule = (extra: Partial<Parameters<typeof E.createConsequence>[3]> = {}) =>
    E.createConsequence(db, ctx, mom, {
      name: 'Pierdes una hora de tele', thresholdCoins: 30, appliesTo: [kid.id], confirmNoEssentials: true, ...extra,
    })

  it('se activa cuando las monedas disponibles bajan del umbral y se apaga al recuperarlas', () => {
    rule()
    expect(E.activeConsequences(db, kid.id)).toHaveLength(0) // 50 monedas
    E.buyCatalogItem(db, ctx, kid, 'ac-visor') // 30 → quedan 20
    expect(E.activeConsequences(db, kid.id).map((c) => c.name)).toEqual(['Pierdes una hora de tele'])
    expect(E.activeConsequences(db, kid2.id)).toHaveLength(0) // no le aplica
    E.correctLedger(db, ctx, mom, kid.id, { xp: 0, coins: 20, reason: 'Ajuste de prueba' })
    expect(E.activeConsequences(db, kid.id)).toHaveLength(0)
  })
  it('las monedas reservadas en canjes pendientes cuentan como no disponibles', () => {
    rule({ thresholdCoins: 30 })
    const r = E.createReward(db, ctx, mom, { name: 'Película', price: 25 })
    E.requestRedemption(db, ctx, kid, r.id) // disponibles: 25
    expect(E.activeConsequences(db, kid.id)).toHaveLength(1)
  })
  it('no toca monedas ni XP', () => {
    rule({ thresholdCoins: 500 })
    expect(E.activeConsequences(db, kid.id)).toHaveLength(1)
    expect(E.memberStats(db, kid.id)).toMatchObject({ xp: 0, coins: 50 })
  })
  it('exige confirmar que no afecta necesidades y rechaza las que sí', () => {
    expect(code(() => rule({ confirmNoEssentials: false }))).toBe('confirm_required')
    expect(code(() => rule({ name: 'No cenas hoy' }))).toBe('essential_needs')
    expect(code(() => rule({ name: 'Sin dormir temprano' }))).toBe('essential_needs')
    expect(code(() => rule({ description: 'Pierdes el desayuno' }))).toBe('essential_needs')
    expect(code(() => rule({ name: 'Pierdes un abrazo' }))).toBe('essential_needs')
    expect(code(() => rule({ name: 'Sin tele por una hora' }))).toBe('no_error')
  })
  it('valida umbral y destinatarios; los niños no pueden crearlas; se pueden archivar', () => {
    expect(code(() => rule({ thresholdCoins: 0 }))).toBe('invalid_number')
    expect(code(() => rule({ appliesTo: [] }))).toBe('no_assignee')
    expect(code(() => rule({ appliesTo: [mom.id] }))).toBe('not_player')
    expect(code(() => E.createConsequence(db, ctx, kid, { name: 'x', thresholdCoins: 10, appliesTo: [kid.id], confirmNoEssentials: true }))).toBe('forbidden')
    const r = rule({ thresholdCoins: 500 })
    E.archiveConsequence(db, ctx, mom, r.id)
    expect(E.activeConsequences(db, kid.id)).toHaveLength(0)
    expect(code(() => E.archiveConsequence(db, ctx, kid, r.id))).toBe('forbidden')
  })
})
