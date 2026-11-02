import { useState, type FormEvent } from 'react'
import { DomainError } from '../../domain/types'
import { Button, Card, Field, inputCls } from '../components'
import { useApp } from '../store'

type Mode = 'welcome' | 'login' | 'register' | 'recover'

export function AuthPage() {
  const { api, run, refresh } = useApp()
  const [mode, setMode] = useState<Mode>('welcome')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    if (mode === 'recover') {
      await run(async () => setInfo(await api.requestPasswordReset(email)))
    } else {
      const ok = await run(async () => {
        if (mode === 'login') return api.signIn(email, password)
        try {
          await api.signUp(email, password)
        } catch (e) {
          // No son errores de fondo: hay que confirmar el correo (o la cuenta ya existe) y entrar desde "Ya tengo cuenta".
          if (e instanceof DomainError && (e.code === 'confirm_email' || e.code === 'email_taken')) {
            setInfo(e.message)
            setMode('login')
            return
          }
          throw e
        }
      })
      if (ok) await refresh()
    }
    setBusy(false)
  }

  if (mode === 'welcome') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 text-center">
        <div className="mb-2 text-6xl animate-float" aria-hidden>
          🌌
        </div>
        <h1 className="font-display text-5xl font-extrabold uppercase tracking-[0.18em] text-white drop-shadow-[0_0_18px_var(--color-neon-cyan)]">LifeQuest</h1>
        <p className="mt-3 text-slate-300">Convierte tu vida real en una aventura: completa misiones, gana XP, sube de nivel y canjea recompensas, solo o en familia.</p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <Button onClick={() => setMode('register')}>Comenzar aventura</Button>
          <Button tone="ghost" onClick={() => setMode('login')}>
            Ya tengo cuenta
          </Button>
          <button type="button" className="text-sm text-slate-400 underline" onClick={() => setMode('recover')}>
            Recuperar mi cuenta
          </button>
        </div>
        {api.mode === 'local' && <LocalNotice />}
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
      <Card glow="cyan">
        <h1 className="mb-4 font-display text-xl font-bold uppercase tracking-widest">
          {mode === 'login' ? 'Iniciar sesión' : mode === 'register' ? 'Crear cuenta' : 'Recuperar cuenta'}
        </h1>
        <form onSubmit={submit}>
          <Field label="Correo electrónico">
            {(id) => <input id={id} className={inputCls} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          {mode !== 'recover' && (
            <Field label="Contraseña" hint={mode === 'register' ? 'Mínimo 8 caracteres.' : undefined}>
              {(id) => (
                <input
                  id={id}
                  className={inputCls}
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          )}
          {info && <p className="mb-3 rounded-lg bg-neon-amber/10 p-3 text-sm text-neon-amber">{info}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Crear cuenta' : 'Enviar enlace'}
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-sm text-slate-400">
          <button type="button" className="underline" onClick={() => setMode('welcome')}>
            ← Volver
          </button>
          {mode !== 'login' && (
            <button type="button" className="underline" onClick={() => setMode('login')}>
              Ya tengo cuenta
            </button>
          )}
          {mode === 'login' && (
            <button type="button" className="underline" onClick={() => setMode('recover')}>
              Olvidé mi contraseña
            </button>
          )}
        </div>
      </Card>
      {api.mode === 'local' && <LocalNotice />}
    </div>
  )
}

export function LocalNotice({ compact }: { compact?: boolean }) {
  return (
    <p className={`rounded-xl border border-neon-amber/40 bg-neon-amber/10 p-3 text-left text-xs text-neon-amber ${compact ? '' : 'mt-6'}`}>
      <strong>Modo local de desarrollo.</strong>{' '}
      {compact
        ? 'Datos sólo en este navegador, sin sincronizar ni proteger. Ver README para activar Supabase.'
        : 'Los datos se guardan sólo en este navegador y no se sincronizan ni están protegidos frente a quien use las herramientas del navegador. Para familias reales hay que activar Supabase (ver README).'}
    </p>
  )
}

/** Se muestra al abrir el enlace de recuperación enviado por correo (§260). */
export function ResetPasswordPage() {
  const { api, run, refresh } = useApp()
  const [password, setPassword] = useState('')
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
      <Card glow="violet">
        <h1 className="mb-4 font-display text-xl font-bold uppercase tracking-widest">Nueva contraseña</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (await run(() => api.updatePassword(password), 'Contraseña actualizada')) await refresh()
          }}
        >
          <Field label="Contraseña nueva" hint="Mínimo 8 caracteres.">
            {(id) => <input id={id} className={inputCls} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Button type="submit" className="w-full">
            Guardar contraseña
          </Button>
        </form>
      </Card>
    </div>
  )
}
