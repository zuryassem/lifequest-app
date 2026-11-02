import { describe, expect, it } from 'vitest'
import { DomainError } from '../domain/types'
import { createLocalApi, type StorageLike } from './localApi'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof DomainError) return e.code
    throw e
  }
  return 'no_error'
}

describe('LocalApi (flujo completo con persistencia)', () => {
  it('registro, familia, misión, aprobación y datos persistentes tras "recargar"', async () => {
    const storage = memoryStorage()
    let api = createLocalApi(storage)
    await api.signUp('mama@example.com', 'supersecreta1')
    await api.createFamily({ familyName: 'Los Pérez', guardianName: 'Mamá', playsGame: false })
    let snap = (await api.getSnapshot())!
    const mom = snap.members.find((m) => m.role === 'guardian')!
    await api.addChild({ actorId: mom.id, name: 'Ana', ageBand: 'kid' })
    snap = (await api.getSnapshot())!
    const kid = snap.members.find((m) => m.role === 'child')!

    await api.createMission({
      actorId: mom.id,
      mission: { title: 'Tender la cama', category: 'discipline', difficulty: 'easy', assigneeIds: [kid.id], recurrence: { type: 'daily' } },
    })
    snap = (await api.getSnapshot())!
    await api.completeMission({ actorId: kid.id, missionId: snap.missions[0].id, memberId: kid.id })
    snap = (await api.getSnapshot())!
    expect(snap.completions[0].status).toBe('pending')
    await api.reviewCompletion({ actorId: mom.id, completionId: snap.completions[0].id, decision: 'approve' })

    // Simula cerrar y volver a abrir la app: nueva instancia sobre el mismo almacenamiento.
    api = createLocalApi(storage)
    snap = (await api.getSnapshot())!
    expect(snap.ledger.filter((e) => e.refType === 'completion')).toHaveLength(1)
    expect(snap.ledger.reduce((s, e) => s + (e.memberId === kid.id ? e.xp : 0), 0)).toBe(10)
  })

  it('un error no deja datos a medias (transacción atómica)', async () => {
    const storage = memoryStorage()
    const api = createLocalApi(storage)
    await api.signUp('a@example.com', 'supersecreta1')
    await api.createSolo({ name: 'Sam' })
    const before = storage.data.get('lifequest.local.db.v1')
    const me = (await api.getSnapshot())!.members[0]
    expect(await errCode(api.createMission({ actorId: me.id, mission: { title: 'X', category: 'health', difficulty: 'easy', assigneeIds: [me.id], xp: 99999 } }))).toBe('invalid_number')
    expect(storage.data.get('lifequest.local.db.v1')).toBe(before)
  })

  it('autenticación: contraseña débil, credenciales erróneas, sesión y cuentas aisladas', async () => {
    const storage = memoryStorage()
    const api = createLocalApi(storage)
    expect(await errCode(api.signUp('a@example.com', 'corta'))).toBe('weak_password')
    await api.signUp('a@example.com', 'supersecreta1')
    await api.createSolo({ name: 'Ana' })
    const mine = (await api.getSnapshot())!.members[0]
    await api.signOut()
    expect(await api.getSession()).toBeNull()
    expect(await errCode(api.signIn('a@example.com', 'incorrecta1'))).toBe('bad_credentials')
    expect(await errCode(api.signIn('nadie@example.com', 'supersecreta1'))).toBe('bad_credentials')
    expect(await errCode(api.getSnapshot())).toBe('no_session')

    await api.signUp('b@example.com', 'otrasecreta1')
    // La cuenta B no puede actuar sobre el perfil de A aunque conozca su id.
    expect(await errCode(api.setPlaysGame({ actorId: mine.id, playsGame: true }))).toBe('forbidden')
    await api.createSolo({ name: 'Beto' })
    expect((await api.getSnapshot())!.members.map((m) => m.name)).toEqual(['Beto'])
    await api.signIn('a@example.com', 'supersecreta1')
    expect((await api.getSession())!.email).toBe('a@example.com')
  })

  it('PIN: se verifica sin guardarse en claro', async () => {
    const storage = memoryStorage()
    const api = createLocalApi(storage)
    await api.signUp('a@example.com', 'supersecreta1')
    await api.createFamily({ familyName: 'F', guardianName: 'Mamá', playsGame: false })
    const mom = (await api.getSnapshot())!.members[0]
    expect(await errCode(api.setPin({ actorId: mom.id, pin: '12' }))).toBe('invalid_pin')
    await api.setPin({ actorId: mom.id, pin: '4821' })
    expect(await api.verifyPin({ actorId: mom.id, pin: '4821' })).toBe(true)
    expect(await api.verifyPin({ actorId: mom.id, pin: '0000' })).toBe(false)
    expect(storage.data.get('lifequest.local.db.v1')).not.toContain('4821')
    expect(storage.data.get('lifequest.local.db.v1')).not.toContain('supersecreta1')
  })

  it('eliminar la cuenta borra la familia y todos sus datos', async () => {
    const storage = memoryStorage()
    const api = createLocalApi(storage)
    await api.signUp('a@example.com', 'supersecreta1')
    await api.createFamily({ familyName: 'F', guardianName: 'Mamá', playsGame: true })
    const mom = (await api.getSnapshot())!.members[0]
    await api.addChild({ actorId: mom.id, name: 'Ana', ageBand: 'kid' })
    await api.deleteAccount()
    const db = JSON.parse(storage.data.get('lifequest.local.db.v1')!)
    expect(db.accounts).toHaveLength(0)
    expect(db.members).toHaveLength(0)
    expect(db.ledger).toHaveLength(0)
    expect(db.families).toHaveLength(0)
  })
})
