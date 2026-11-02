import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AVATAR_STYLES } from '../domain/catalog'
import type { Avatar } from '../domain/types'

type Tone = 'cyan' | 'violet' | 'pink' | 'lime' | 'amber' | 'ghost' | 'danger'

const TONES: Record<Tone, string> = {
  cyan: 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/60 hover:bg-neon-cyan/25 shadow-[0_0_14px_-4px_var(--color-neon-cyan)]',
  violet: 'bg-neon-violet/15 text-neon-violet border-neon-violet/60 hover:bg-neon-violet/25 shadow-[0_0_14px_-4px_var(--color-neon-violet)]',
  pink: 'bg-neon-pink/15 text-neon-pink border-neon-pink/60 hover:bg-neon-pink/25',
  lime: 'bg-neon-lime/15 text-neon-lime border-neon-lime/60 hover:bg-neon-lime/25',
  amber: 'bg-neon-amber/15 text-neon-amber border-neon-amber/60 hover:bg-neon-amber/25',
  ghost: 'bg-white/5 text-slate-200 border-white/15 hover:bg-white/10',
  danger: 'bg-red-500/15 text-red-300 border-red-400/50 hover:bg-red-500/25',
}

export function Button({
  tone = 'cyan',
  small,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; small?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border font-semibold tracking-wide transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5'
      } ${TONES[tone]} ${className}`}
    />
  )
}

export function Card({ className = '', children, glow }: { className?: string; children: ReactNode; glow?: 'cyan' | 'violet' }) {
  const g = glow === 'violet' ? 'border-neon-violet/40 shadow-[0_0_28px_-10px_var(--color-neon-violet)]' : glow === 'cyan' ? 'border-neon-cyan/40 shadow-[0_0_28px_-10px_var(--color-neon-cyan)]' : 'border-white/10'
  return <section className={`rounded-2xl border bg-ink-800/70 p-4 backdrop-blur ${g} ${className}`}>{children}</section>
}

export function Heading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="font-display text-2xl font-bold uppercase tracking-[0.12em] text-white">{children}</h1>
      {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
    </div>
  )
}

export function Chip({ children, color = '#94a3b8' }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium" style={{ borderColor: `${color}88`, color, background: `${color}18` }}>
      {children}
    </span>
  )
}

export function Bar({ ratio, color = 'var(--color-neon-cyan)', label }: { ratio: number; color?: string; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100)
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-3 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, var(--color-neon-violet))`, boxShadow: `0 0 12px ${color}` }} />
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-300">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export const inputCls =
  'w-full rounded-xl border border-white/15 bg-ink-900/80 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-neon-cyan focus:outline-none'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-neon-violet/40 bg-ink-900 p-5 shadow-[0_0_40px_-10px_var(--color-neon-violet)] sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold uppercase tracking-widest">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Empty({ icon = '🛰️', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">
      <div className="mb-2 text-3xl">{icon}</div>
      {children}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; badge?: number }[] }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-black/30 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${value === t.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {t.label}
          {!!t.badge && <span className="ml-1.5 rounded-full bg-neon-pink px-1.5 text-xs text-ink-950">{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}

/** Personaje 2D: el estilo, color y los objetos equipados se reflejan al instante (§70). */
export function AvatarView({ avatar, size = 96, name }: { avatar: Avatar; size?: number; name?: string }) {
  const glyph = AVATAR_STYLES.find((s) => s.id === avatar.style)?.glyph ?? '🏃'
  return (
    <div
      role="img"
      aria-label={`Avatar${name ? ` de ${name}` : ''}`}
      className={`relative shrink-0 overflow-hidden rounded-2xl ${avatar.background ? `bg-av-${avatar.background}` : 'bg-ink-700'} ${avatar.frame ? `frame-${avatar.frame}` : ''}`}
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 flex items-center justify-center animate-float" style={{ fontSize: size * 0.55, filter: `drop-shadow(0 0 ${size * 0.12}px ${avatar.color})` }}>
        {glyph}
      </div>
      <div className="absolute inset-x-3 bottom-2 h-1.5 rounded-full opacity-80 blur-[2px]" style={{ background: avatar.color }} />
      {avatar.accessory && (
        <div className="absolute right-1 top-0.5" style={{ fontSize: size * 0.28 }}>
          {avatar.accessory}
        </div>
      )}
    </div>
  )
}

export function Coin({ amount, className = '' }: { amount: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-bold text-neon-amber ${className}`} title="LIFECOINS">
      <span aria-hidden>🪙</span>
      {amount.toLocaleString('es')}
      <span className="sr-only"> LIFECOINS</span>
    </span>
  )
}

export function Xp({ amount, className = '' }: { amount: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-bold text-neon-cyan ${className}`}>
      <span aria-hidden>✨</span>
      {amount.toLocaleString('es')} XP
    </span>
  )
}
