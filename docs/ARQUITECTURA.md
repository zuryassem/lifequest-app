# LIFEQUEST — Arquitectura, modelo de datos y etapas

## 1. Decisiones clave

| Tema | Decisión | Motivo |
|---|---|---|
| UI | React 19 + TypeScript + Tailwind CSS 4 + Vite | Prompt §21; base única para web y móvil |
| Móvil | Capacitor (`capacitor.config.ts`) | Prompt §22 |
| Backend objetivo | Supabase (Auth + Postgres + RLS + funciones RPC) | Prompt §23 |
| Lógica de negocio | **Un solo motor en TypeScript puro** (`src/domain`) sin dependencias de UI ni red | Testeable; la misma lógica se replica en SQL |
| Acceso a datos | Interfaz `LifeQuestApi` con dos adaptadores | Permite funcionar hoy sin credenciales |

### Los dos adaptadores

```
UI (React) ──► LifeQuestApi (interfaz)
                  ├── LocalApi      → motor TS + localStorage      (modo local / desarrollo)
                  └── SupabaseApi   → RPC SQL + RLS en Postgres    (producción)
```

* **LocalApi** guarda todo en el navegador. Sirve para desarrollar, probar y demostrar sin infraestructura. **No es seguro frente a un usuario que manipule el navegador** (prompt §125, §267): quien abra DevTools puede editar `localStorage`. Por eso la app muestra un aviso permanente en modo local y no debe usarse con familias reales.
* **SupabaseApi** delega *toda* operación que toca XP, LIFECOINS o permisos en funciones SQL `security definer`. Las tablas no admiten `insert/update/delete` directo del cliente: sólo lectura filtrada por RLS. Es el modo de producción.
* Se elige con `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Sin ellas → modo local.

## 2. Estructura de carpetas

```
src/
  domain/        Tipos, progresión (niveles), recurrencia, motor de reglas (puro)
  data/          Interfaz LifeQuestApi, LocalApi, SupabaseApi, selección por entorno
  ui/            Componentes, páginas, tema, contexto de sesión
supabase/
  migrations/    Esquema, RLS y funciones RPC
  tests/         Pruebas del SQL ejecutadas sobre PGlite (Postgres real en WASM)
docs/
```

## 3. Modelo de datos

```
account (auth.users en Supabase)
   │ 1..n
family ──────────────┐ kind: solo | family, code (único), invite_code
   │ 1..n            │
member  (role: guardian|child; account_id NULL para niños)
   │                 │
   ├─ mission ───────┤ created_by, status: proposed|active|suspended|archived
   │    └─ completion  (mission, member, period_key) UNIQUE
   │          status: pending|approved|rejected; completed_by, reviewed_by, *_at
   ├─ ledger_entry     xp, coins, reason, ref_type, ref_id  UNIQUE(member, ref_type, ref_id)
   ├─ family_reward    precio, estado proposed|approved|archived
   ├─ inventory_item   (member, catalog_item_id, equipped)
   └─ redemption       pending|approved|rejected|rescheduled|refunded
catalog_item           catálogo digital global (avatares, fondos, marcos, títulos)
audit_log              quién hizo qué y cuándo
```

Invariantes:

* `xp` y `coins` de un miembro **no son columnas editables**: son la suma de su `ledger_entry`.
* Monedas *disponibles* = saldo del ledger − retenciones de canjes `pending`/`rescheduled` (§142).
* `UNIQUE(member, ref_type, ref_id)` en el ledger hace idempotente cada recompensa (§264).
* Un niño nunca tiene `account_id` en la Etapa 1 (sin correo, sin datos personales: §47, §49, §270).

## 4. Permisos

| Acción | Guardián | Niño |
|---|---|---|
| Crear misión activa / recompensa | ✔ | ✘ (sólo **propone**) |
| Aprobar propuestas, completar revisiones | ✔ | ✘ |
| Marcar misión propia como completada | ✔ (si juega) | ✔ |
| Comprar ítem digital | ✔ (si juega) | ✔ |
| Pedir canje familiar | ✔ (si juega) | ✔ |
| Aprobar canje | ✔ | ✘ |
| Añadir niños, invitar 2.º adulto, ver estadísticas | ✔ | ✘ |

En Supabase cada RPC comprueba `auth.uid()` y la pertenencia a la familia. Un niño opera desde la sesión de su guardián en el mismo dispositivo ("modo niño"); volver a modo adulto exige PIN. **Limitación conocida de la Etapa 1:** el PIN se comprueba en el cliente; el servidor sólo sabe que la cuenta es de un guardián. Ver "Pendiente".

## 5. Progresión (documentada también en `src/domain/progression.ts`)

`XP total para alcanzar el nivel L = round(60 · (L−1)^1.5)` → nivel 2 = 60, nivel 5 = 480, nivel 10 = 1 620, nivel 20 = 4 969.
Recompensas por defecto (modificables por familia, con topes): fácil 10 XP / 5 🪙, media 25 / 12, difícil 50 / 25, especial 100 / 60.
Topes por misión: 150 XP y 300 🪙 (especiales: 500 XP y 1 000 🪙).

## 6. Etapas

| Etapa | Contenido | Estado |
|---|---|---|
| **1 — Núcleo jugable** | Registro/login, individual o familia, niños, personaje básico, misiones (crear, proponer, completar, aprobar), XP, LIFECOINS, ledger, nivel, tienda digital y familiar con canjes, panel familiar, persistencia local, esquema SQL + RLS + RPC, pruebas | esta entrega |
| 2 | Estadísticas con gráficos, logros, rachas, mapa de progresión | pendiente |
| 3 | Asistente de IA (función edge con proveedor intercambiable) | pendiente |
| 4 | Personalización avanzada de avatar, Premium (permisos por *feature flag*), exportación/eliminación de datos | pendiente |
| 5 | Capacitor iOS/Android, publicación | configuración preparada |
