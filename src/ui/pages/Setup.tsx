import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Field, inputCls } from '../components'
import { useApp } from '../store'

type Step = 'choose' | 'solo' | 'family' | 'join'

export function SetupPage() {
  const { api, run, session, signedOut } = useApp()
  const nav = useNavigate()
  const [step, setStep] = useState<Step>('choose')
  const [name, setName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [plays, setPlays] = useState(true)
  const [code, setCode] = useState('')

  async function finish(op: () => Promise<unknown>) {
    const ok = await run(op)
    if (ok) nav('/character', { replace: true })
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-5 py-8">
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-[0.15em]">Elige tu aventura</h1>
        <p className="mt-1 text-slate-400">Sesión de {session?.email}</p>
      </div>

      {step === 'choose' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice icon="🧑‍🚀" title="Aventura individual" text="Tus propias misiones, XP y recompensas." onClick={() => setStep('solo')} />
          <Choice icon="👨‍👩‍👧‍👦" title="Crear una familia" text="Administra a tus hijos, asigna misiones y aprueba recompensas." onClick={() => setStep('family')} />
          <button type="button" className="text-sm text-slate-400 underline sm:col-span-2" onClick={() => setStep('join')}>
            Tengo un código de invitación familiar
          </button>
        </div>
      )}

      {step === 'solo' && (
        <Card glow="cyan">
          <Field label="Nombre de jugador">{(id) => <input id={id} className={inputCls} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Button className="w-full" disabled={!name.trim()} onClick={() => finish(() => api.createSolo({ name }))}>
            Crear personaje
          </Button>
        </Card>
      )}

      {step === 'family' && (
        <Card glow="violet">
          <Field label="Nombre de la familia">{(id) => <input id={id} className={inputCls} maxLength={40} placeholder="Los Pérez" value={familyName} onChange={(e) => setFamilyName(e.target.value)} />}</Field>
          <Field label="Tu nombre">{(id) => <input id={id} className={inputCls} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-medium text-slate-300">¿Cómo quieres usar LifeQuest?</legend>
            <label className="mb-2 flex cursor-pointer gap-3 rounded-xl border border-white/10 p-3 has-[:checked]:border-neon-cyan">
              <input type="radio" name="mode" checked={!plays} onChange={() => setPlays(false)} />
              <span>
                <strong>Sólo administrar.</strong>
                <span className="block text-sm text-slate-400">Gestiono misiones y recompensas de mi familia, sin jugar.</span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-xl border border-white/10 p-3 has-[:checked]:border-neon-cyan">
              <input type="radio" name="mode" checked={plays} onChange={() => setPlays(true)} />
              <span>
                <strong>Administrar y jugar.</strong>
                <span className="block text-sm text-slate-400">También tendré mi avatar, nivel y recompensas. Puedo cambiarlo después.</span>
              </span>
            </label>
          </fieldset>
          <p className="mb-3 text-xs text-slate-500">Al añadir a menores confirmas que eres su madre, padre o tutor legal y que autorizas su perfil. Los perfiles infantiles no llevan correo ni datos de contacto.</p>
          <Button className="w-full" disabled={!name.trim() || !familyName.trim()} onClick={() => finish(() => api.createFamily({ familyName, guardianName: name, playsGame: plays }))}>
            Crear familia
          </Button>
        </Card>
      )}

      {step === 'join' && (
        <Card>
          <Field label="Código de invitación">{(id) => <input id={id} className={`${inputCls} uppercase tracking-widest`} placeholder="ABCD-EFGH" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <Field label="Tu nombre">{(id) => <input id={id} className={inputCls} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={plays} onChange={(e) => setPlays(e.target.checked)} /> También quiero jugar
          </label>
          <Button className="w-full" disabled={!name.trim() || !code.trim()} onClick={() => finish(() => api.joinFamily({ inviteCode: code, name, playsGame: plays }))}>
            Unirme
          </Button>
        </Card>
      )}

      {step !== 'choose' && (
        <button type="button" className="text-sm text-slate-400 underline" onClick={() => setStep('choose')}>
          ← Cambiar de opción
        </button>
      )}
      <button
        type="button"
        className="text-sm text-slate-500 underline"
        onClick={async () => {
          await api.signOut()
          signedOut()
        }}
      >
        Cerrar sesión
      </button>
    </div>
  )
}

function Choice({ icon, title, text, onClick }: { icon: string; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl border border-neon-cyan/30 bg-ink-800/70 p-5 text-left transition hover:border-neon-cyan hover:shadow-[0_0_28px_-8px_var(--color-neon-cyan)]">
      <div className="mb-2 text-4xl">{icon}</div>
      <div className="font-display text-lg font-bold uppercase tracking-wider">{title}</div>
      <p className="mt-1 text-sm text-slate-400">{text}</p>
    </button>
  )
}
