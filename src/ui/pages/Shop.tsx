import { useState } from 'react'
import { CATALOG } from '../../domain/catalog'
import type { CatalogItem, ShopSlot } from '../../domain/types'
import { AvatarView, Button, Card, Chip, Coin, Empty, Field, Heading, Modal, Tabs, inputCls } from '../components'
import { fmtDate, nameOf, statsOf } from '../selectors'
import { useApp } from '../store'

type Tab = 'digital' | 'family' | 'history'

const SLOT_LABEL: Record<ShopSlot, string> = { background: 'Fondos', frame: 'Marcos', accessory: 'Accesorios', title: 'Títulos' }

export function ShopPage() {
  const { snap, active, api, run } = useApp()
  const [tab, setTab] = useState<Tab>('digital')
  const [preview, setPreview] = useState<CatalogItem | null>(null)
  const [proposing, setProposing] = useState(false)
  if (!snap || !active) return null

  const isGuardian = active.role === 'guardian'
  const s = active.playsGame ? statsOf(snap, active.id) : null
  const owned = new Set(snap.inventory.filter((i) => i.memberId === active.id).map((i) => i.itemId))
  const rewards = snap.rewards.filter((r) => r.status === 'approved')
  const proposals = snap.rewards.filter((r) => r.status === 'proposed' && (isGuardian || r.createdBy === active.id))
  const redemptions = snap.redemptions.filter((r) => isGuardian || r.memberId === active.id).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Heading sub="Gasta tus LIFECOINS: son una moneda interna del juego, sin valor real.">Tienda</Heading>
      {s && (
        <p className="mb-4">
          Disponibles: <Coin amount={s.available} />
          {s.held > 0 && <span className="ml-2 text-sm text-slate-400">· {s.held} reservadas en canjes pendientes</span>}
        </p>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'digital', label: 'Artículos digitales' },
          { id: 'family', label: 'Recompensas familiares' },
          { id: 'history', label: 'Historial' },
        ]}
      />

      {tab === 'digital' &&
        (!active.playsGame ? (
          <Empty>Sólo los jugadores compran artículos digitales.</Empty>
        ) : (
          (Object.keys(SLOT_LABEL) as ShopSlot[]).map((slot) => (
            <div key={slot} className="mb-6">
              <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-slate-400">{SLOT_LABEL[slot]}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {CATALOG.filter((i) => i.slot === slot).map((item) => {
                  const has = owned.has(item.id)
                  const locked = !has && s!.level < item.minLevel
                  return (
                    <button key={item.id} type="button" onClick={() => setPreview(item)} className="rounded-2xl border border-white/10 bg-ink-800/70 p-3 text-left transition hover:border-neon-cyan/60">
                      <div className="font-semibold">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{item.description}</div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        {has ? <Chip color="#a3e635">En inventario</Chip> : locked ? <Chip color="#94a3b8">🔒 Nivel {item.minLevel}</Chip> : <Coin amount={item.price} />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        ))}

      {tab === 'family' && (
        <div className="grid gap-3">
          <div className="flex justify-end">
            <Button tone="violet" small onClick={() => setProposing(true)}>
              {isGuardian ? '＋ Nueva recompensa' : '💡 Proponer recompensa'}
            </Button>
          </div>
          {rewards.length === 0 && <Empty icon="🎁">{isGuardian ? 'Crea las recompensas de tu familia: elegir la película, una salida, tiempo extra…' : 'Todavía no hay recompensas familiares.'}</Empty>}
          {rewards.map((r) => {
            const affordable = !!s && s.available >= r.price
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{r.name}</h3>
                    {r.description && <p className="text-sm text-slate-400">{r.description}</p>}
                    {r.conditions && <p className="mt-1 text-xs text-slate-500">Condiciones: {r.conditions}</p>}
                  </div>
                  <Price amount={r.price} />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  {isGuardian && (
                    <Button tone="ghost" small onClick={() => run(() => api.archiveReward({ actorId: active.id, rewardId: r.id }), 'Recompensa retirada')}>
                      Retirar
                    </Button>
                  )}
                  {active.playsGame && (
                    <Button tone="amber" small disabled={!affordable} onClick={() => run(() => api.requestRedemption({ actorId: active.id, rewardId: r.id }), 'Solicitud enviada. Las monedas quedan reservadas hasta que se apruebe.')}>
                      {affordable ? (r.price === 0 ? 'Solicitar (gratis)' : 'Solicitar canje') : 'Monedas insuficientes'}
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
          {proposals.length > 0 && (
            <>
              <h2 className="mt-2 font-display text-sm font-bold uppercase tracking-widest text-slate-400">Propuestas</h2>
              {proposals.map((r) => (
                <Card key={r.id}>
                  <div className="flex justify-between">
                    <span>{r.name}</span>
                    <Coin amount={r.price} />
                  </div>
                  <p className="text-xs text-slate-500">Propuesta de {nameOf(snap, r.createdBy)} · pendiente de aprobación</p>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="grid gap-2">
          {redemptions.length === 0 && <Empty icon="🧾">Aún no hay canjes.</Empty>}
          {redemptions.map((r) => {
            const reward = snap.rewards.find((x) => x.id === r.rewardId)
            const label = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado', rescheduled: 'Reprogramado', refunded: 'Devuelto' }[r.status]
            const color = { pending: '#fbbf24', approved: '#a3e635', rejected: '#f472b6', rescheduled: '#60a5fa', refunded: '#94a3b8' }[r.status]
            return (
              <Card key={r.id}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{reward?.name}</div>
                    <div className="text-xs text-slate-500">
                      {nameOf(snap, r.memberId)} · {fmtDate(r.requestedAt)}
                      {r.scheduledFor && ` · para el ${r.scheduledFor}`}
                    </div>
                    {r.note && <div className="mt-1 text-sm text-slate-300">“{r.note}”</div>}
                  </div>
                  <div className="text-right">
                    <Chip color={color}>{label}</Chip>
                    <div className="mt-1">
                      <Coin amount={r.price} />
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)}>
          <div className="mb-4 flex items-center gap-4">
            <AvatarView
              size={120}
              avatar={{
                ...active.avatar,
                accessory: preview.slot === 'accessory' ? preview.value : active.avatar.accessory,
                background: preview.slot === 'background' ? preview.value : active.avatar.background,
                frame: preview.slot === 'frame' ? preview.value : active.avatar.frame,
                title: preview.slot === 'title' ? preview.value : active.avatar.title,
              }}
            />
            <div>
              <p className="text-sm text-slate-300">{preview.description}</p>
              {preview.slot === 'title' && <p className="mt-1 text-sm text-neon-violet">Título: «{preview.value}»</p>}
              <p className="mt-2">
                <Coin amount={preview.price} />
              </p>
              {preview.minLevel > 0 && <p className="text-xs text-slate-500">Requiere nivel {preview.minLevel}</p>}
            </div>
          </div>
          {owned.has(preview.id) ? (
            <Button className="w-full" tone="lime" onClick={() => run(() => api.equipItem({ actorId: active.id, memberId: active.id, itemId: preview.id }), 'Cambio guardado').then(() => setPreview(null))}>
              Equipar / quitar
            </Button>
          ) : (
            <Button
              className="w-full"
              tone="amber"
              disabled={!s || s.available < preview.price || s.level < preview.minLevel}
              onClick={() => run(() => api.buyCatalogItem({ actorId: active.id, itemId: preview.id }), '¡Comprado! Ya está en tu inventario.').then(() => setPreview(null))}
            >
              {!s ? 'Sólo los jugadores compran' : s.level < preview.minLevel ? `Necesitas nivel ${preview.minLevel}` : s.available < preview.price ? 'Monedas insuficientes' : 'Comprar'}
            </Button>
          )}
        </Modal>
      )}

      {proposing && <RewardForm onClose={() => setProposing(false)} />}
    </div>
  )
}

function Price({ amount }: { amount: number }) {
  return amount === 0 ? <Chip color="#a3e635">Gratis</Chip> : <Coin amount={amount} />
}

function RewardForm({ onClose }: { onClose: () => void }) {
  const { api, run, active } = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(100)
  const [conditions, setConditions] = useState('')
  if (!active) return null
  const guardian = active.role === 'guardian'
  return (
    <Modal title={guardian ? 'Nueva recompensa familiar' : 'Proponer recompensa'} onClose={onClose}>
      <Field label="Nombre">{(id) => <input id={id} className={inputCls} maxLength={60} placeholder="Elegir la película del viernes" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Descripción (opcional)">{(id) => <input id={id} className={inputCls} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <Field label="Precio en LIFECOINS" hint="0 = gratis">{(id) => <input id={id} className={inputCls} type="number" min={0} max={100000} value={price} onChange={(e) => setPrice(Number(e.target.value))} />}</Field>
      <Field label="Condiciones o límites (opcional)" hint="Por ejemplo: «sólo fines de semana» o «máximo 1 hora».">
        {(id) => <input id={id} className={inputCls} maxLength={300} value={conditions} onChange={(e) => setConditions(e.target.value)} />}
      </Field>
      {!guardian && <p className="mb-3 rounded-lg bg-neon-violet/10 p-3 text-sm text-neon-violet">Tu adulto tiene que aprobarla antes de que aparezca en la tienda.</p>}
      <Button
        className="w-full"
        disabled={!name.trim()}
        onClick={async () => {
          const ok = await run(() => api.createReward({ actorId: active.id, name, description, price, conditions }), guardian ? 'Recompensa creada' : 'Propuesta enviada')
          if (ok) onClose()
        }}
      >
        {guardian ? 'Crear recompensa' : 'Enviar propuesta'}
      </Button>
    </Modal>
  )
}
