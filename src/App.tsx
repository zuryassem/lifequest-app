import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { LifeQuestApi } from './data/api'
import { Layout } from './ui/Layout'
import { Overlays } from './ui/Overlays'
import { AuthPage, ResetPasswordPage } from './ui/pages/Auth'
import { CharacterPage } from './ui/pages/Character'
import { FamilyPage } from './ui/pages/Family'
import { HomePage } from './ui/pages/Home'
import { MissionsPage } from './ui/pages/Missions'
import { ProfilePage } from './ui/pages/Profile'
import { RewardsSetupPage } from './ui/pages/RewardsSetup'
import { SetupPage } from './ui/pages/Setup'
import { ShopPage } from './ui/pages/Shop'
import { AppProvider, useApp } from './ui/store'

function Gate() {
  const { ready, session, snap, api, me } = useApp()
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center font-display text-lg uppercase tracking-[0.3em] text-neon-cyan" role="status">
        Cargando…
      </div>
    )
  }
  if (session && api.isPasswordRecovery()) return <ResetPasswordPage />
  if (!session) return <AuthPage />
  if (!snap) return <SetupPage />
  // Primer paso obligatorio: elegir al menos 10 recompensas antes de usar la app.
  if (me && !snap.family.rewardsSetupDone) return <RewardsSetupPage />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="missions" element={<MissionsPage />} />
        <Route path="shop" element={<ShopPage />} />
        <Route path="family" element={<FamilyPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="character" element={<CharacterPage />} />
        <Route path="character/:memberId" element={<CharacterPage key="other" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App({ api }: { api: LifeQuestApi }) {
  return (
    <AppProvider api={api}>
      <BrowserRouter>
        <Gate />
        <Overlays />
      </BrowserRouter>
    </AppProvider>
  )
}
