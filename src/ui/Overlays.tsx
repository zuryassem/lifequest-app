import { Button } from './components'
import { useApp } from './store'

/** Avisos y celebraciones globales: se muestran también en las pantallas de acceso y configuración. */
export function Overlays() {
  const { toasts, levelUp, dismissLevelUp } = useApp()
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm shadow-lg ${t.kind === 'error' ? 'border-red-400/60 bg-red-950/95 text-red-100' : 'border-neon-lime/50 bg-ink-800/95 text-neon-lime'}`}>
            {t.kind === 'error' ? '⚠ ' : '✓ '}
            {t.text}
          </div>
        ))}
      </div>

      {levelUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={dismissLevelUp} role="dialog" aria-modal="true" aria-label="Subida de nivel">
          <div className="animate-pop rounded-3xl border border-neon-cyan bg-ink-900 p-8 text-center shadow-[0_0_80px_-10px_var(--color-neon-cyan)]">
            <div className="text-6xl animate-float" aria-hidden>
              🚀
            </div>
            <p className="mt-3 text-sm uppercase tracking-[0.3em] text-neon-violet">¡Subida de nivel!</p>
            <p className="font-display text-6xl font-extrabold text-white drop-shadow-[0_0_20px_var(--color-neon-cyan)]">{levelUp.level}</p>
            <p className="mt-2 text-slate-300">{levelUp.memberName} alcanzó el nivel {levelUp.level}. ¡Revisa la tienda: puede haber nuevos artículos desbloqueados!</p>
            <Button className="mt-5" onClick={dismissLevelUp}>
              Continuar
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
