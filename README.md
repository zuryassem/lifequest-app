# LIFEQUEST

La vida real como una aventura RPG futurista, en solitario o en familia. React 19 + TypeScript + Tailwind 4 + Vite, con Supabase como backend de producción y Capacitor para iOS/Android.

> **Estado: Etapa 1 (núcleo jugable).** Hay una lista transparente de lo implementado y lo pendiente al final. La arquitectura y el modelo de datos están en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

## Ejecutar en local

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 85 pruebas: motor, capa de datos y SQL sobre Postgres real (PGlite)
npm run build      # tsc + vite build → dist/
```

Sin variables de entorno la app funciona en **modo local**: todo se guarda en `localStorage` del navegador. Sirve para desarrollar y probar; **no es seguro ni se sincroniza** (cualquiera con las DevTools puede editar sus monedas). La app lo avisa en pantalla. No lo uses con familias reales.

## Activar Supabase (producción)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Aplica el esquema: pega en *SQL Editor* y ejecuta, en orden, `supabase/migrations/0001_init.sql` y después `0002_rewards_setup_consequences.sql` (o `supabase db push` con la CLI).
3. En *Authentication → Providers* deja activado Email. Decide si exiges confirmar el correo. En *URL Configuration* añade la URL de tu sitio (la usa el enlace de recuperación de contraseña).
4. Copia `.env.example` a `.env` y rellena `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Project Settings → API). **Nunca** pongas la clave `service_role` en el front.
5. `npm run dev` ya usa Supabase.
6. **Verifica el proyecto:** desactiva temporalmente *Confirm email* (Authentication → Providers → Email) y ejecuta `npm run verify:supabase`. Crea dos cuentas desechables, recorre registro → misión → aprobación → compra → canje, comprueba que el cliente no puede escribir en `ledger` ni ver datos ajenos, y borra las cuentas al terminar. Vuelve a activar *Confirm email* después.
   Si prefieres dejar *Confirm email* activado, `npm run verify:supabase:anon` comprueba sin iniciar sesión que un visitante anónimo no puede leer ni escribir nada y que las funciones existen; el flujo con sesión se prueba entonces a mano con `npm run dev`, confirmando el correo.

**Correo de confirmación (SMTP).** El correo integrado de Supabase permite sólo ~2 mensajes por hora. Este proyecto usa SMTP propio con Resend (`smtp.resend.com`, puerto 465, usuario `resend`, la contraseña es una API key con permiso *Sending access*; se configura en Authentication → Emails → SMTP Settings). Con el remitente de prueba `onboarding@resend.dev` Resend sólo entrega al correo con el que te registraste; **antes de abrir la app a otras personas hay que verificar un dominio propio en Resend** y usar un remitente de ese dominio. Gmail como SMTP exige verificación en dos pasos y contraseña de aplicación, y no se recomienda para producción. Si el registro falla, el motivo exacto está en Logs → Auth del panel de Supabase.

Cómo se protege (§125, §257, §258, §267): las tablas sólo admiten **lectura** filtrada por familia mediante RLS; no hay políticas de insert/update/delete. Toda escritura pasa por funciones `lq_*` (`security definer`) que comprueban `auth.uid()` y reproducen las reglas del motor. XP y LIFECOINS no son columnas: son la suma de `ledger`, con restricción única `(member_id, ref_type, ref_id)` que hace cada recompensa idempotente. Los saldos se bloquean por jugador (`for update`) para evitar carreras.

> ⚠ El adaptador `src/data/supabaseApi.ts` y el esquema están probados con PGlite (Postgres real, con roles `anon`/`authenticated` y RLS simulando a Supabase), **pero no contra un proyecto Supabase real**: nadie lo ha conectado todavía. Es lo primero que hay que verificar al configurar el proyecto (registro, confirmación de correo, enlace de recuperación).

## Desplegar la web

Cualquier hosting estático sirve (`dist/`). Para Vercel ya está `vercel.json` (reescritura SPA). Define las dos variables `VITE_SUPABASE_*` en el panel.

## Apps móviles (Capacitor)

`capacitor.config.ts` está listo (`appId: app.lifequest.game`, `webDir: dist`). Pasos:

```bash
npm i @capacitor/core @capacitor/ios @capacitor/android
npm run build
npx cap add ios && npx cap add android
npx cap sync
npx cap open ios       # requiere Xcode y una cuenta Apple Developer para publicar
npx cap open android   # requiere Android Studio
```

Cambia `appId`/`appName` antes de publicar. Los iconos, pantallas de carga, ficha de tienda, política de privacidad y la declaración de datos de menores (App Store *Kids/Made for Kids*, Google *Families*) hay que prepararlos aparte.

## Estructura

```
src/domain/    Motor de reglas puro (engine.ts), progresión, recurrencia, catálogo, tipos
src/data/      Interfaz LifeQuestApi + LocalApi (navegador) + SupabaseApi (producción)
src/ui/        Páginas, componentes, estado global
supabase/      migrations/0001_init.sql y 0002_rewards_setup_consequences.sql (esquema+RLS+RPC) y tests/ (SQL sobre PGlite)
docs/          Arquitectura, modelo de datos, etapas
```

Reglas clave y dónde viven: fórmula de niveles `src/domain/progression.ts` (documentada y duplicada en SQL; un test comprueba que coinciden en los niveles 1–100) · permisos y recompensas `src/domain/engine.ts` ↔ `supabase/migrations/0001_init.sql` · catálogo digital `src/domain/catalog.ts` ↔ tabla `catalog_items`.

## Qué hay implementado (Etapa 1)

- Registro, inicio y cierre de sesión; recuperación de contraseña (Supabase); eliminación de cuenta; exportación JSON de los datos familiares.
- Aventura individual o familia con código único; uno o dos adultos (invitación de 48 h); perfiles infantiles **sin correo ni cuenta**; el adulto puede sólo administrar o administrar y jugar, y cambiarlo sin perder datos.
- Modo niño con interfaz restringida (sin administración, ni por URL) y PIN de adulto opcional para volver.
- Creación y edición de personaje 2D (estilo, color, intereses, objetivos) con vista previa en vivo.
- Misiones: seis categorías, cuatro dificultades, repetición (una vez / diaria / días concretos / semanal), condiciones de término, recompensas con topes, bono por iniciativa, aprobación opcional, rechazo con nota y reenvío, suspender/reanudar/archivar, propuestas de los hijos con aprobación o edición del adulto, registro de quién creó/completó/aprobó y cuándo.
- XP, niveles (fórmula configurable), LIFECOINS, libro de movimientos inmutable con idempotencia, correcciones justificadas, celebración al subir de nivel.
- **Lista inicial de recompensas obligatoria:** al crear la familia (o la aventura individual) hay que elegir al menos 10 recompensas de una lista sugerida y editable, o propias; algunas pueden costar 0 y se pueden añadir más de 10. Se canjean las veces que se quiera mientras haya monedas disponibles (las reservadas en canjes pendientes no cuentan).
- **Consecuencias acordadas** (Familia → Acuerdos): reglas del tipo «si tiene menos de N LIFECOINS disponibles, pasa X», con destinatarios elegidos. Se muestran con transparencia al jugador en su pantalla de inicio y el adulto ve quién las tiene activas. **La app no las ejecuta ni quita XP/monedas: las hace efectivas el adulto.** Se rechazan (con un filtro de palabras, que no es infalible) las que mencionen comida, sueño, descanso, educación, salud o afecto, y exigen confirmarlo (§122).
- Tienda digital (15 artículos, vista previa, nivel mínimo, inventario, equipar) y tienda familiar privada con propuestas, reserva de monedas, aprobar / rechazar con explicación / reprogramar / devolver, e historial.
- Panel familiar (aprobaciones, integrantes, acuerdos vigentes, ajustes y registro de actividad), centro de aventura, misiones con filtros y pestañas, perfil con estadísticas por categoría.
- Accesibilidad: opción de reducir animaciones, `prefers-reduced-motion`, etiquetas ARIA, foco visible. Diseño responsive con navegación inferior en móvil.

## Pendiente o parcial (sin maquillar)

| Tema | Estado |
|---|---|
| Mapa de progresión, logros, rachas, gráficos semanales/mensuales (§216, §226–250) | **No hecho** (Etapa 2). Sólo hay conteo por categoría. |
| Asistente de IA (§151–175) | **No hecho** (Etapa 3). Requiere una Edge Function con la clave del proveedor en el servidor; la interfaz `LifeQuestApi` permite añadirlo sin reescribir. |
| Premium y pagos (§276–287) | **No hecho.** No se simula ningún pago. Faltan RevenueCat/Stripe/StoreKit/Play Billing y verificación de recibos. |
| Votaciones familiares (§196–199) | Diferidas por diseño. |
| Personalización avanzada (peinados, ropa, más estilos) | Parcial: estilo, color y 4 ranuras de objetos. Los campos `hair`/`outfit` existen pero no hay opciones. |
| Sincronización en vivo entre dispositivos (§261) | Los datos se leen al abrir y tras cada acción. **No hay suscripción en tiempo real** ni cola offline (§262). En modo local sólo se sincronizan pestañas del mismo navegador. |
| Notificaciones push a los padres (§140) | Sólo cola y contador dentro de la app. |
| El PIN y el "modo niño" **no son seguridad del servidor** | El niño juega con la sesión de su adulto. El PIN sólo bloquea la interfaz; quien controle el dispositivo desbloqueado podría actuar como adulto. Solución prevista: sesiones propias por niño con credenciales de dispositivo. |
| Autorización parental (§48) | Casilla de consentimiento y minimización de datos. **No hay verificación** (p. ej. cobro simbólico, documento) ni asesoría legal COPPA/GDPR-K: hay que revisarlo con un abogado antes de lanzar. |
| Fecha y zona horaria en servidor | El servidor tolera ±1 día respecto a UTC; el cliente decide «hoy» con su reloj. |
| Lecturas con más de 1 000 filas | La API de Supabase pagina a 1 000; el historial de un hogar muy activo necesitará paginación. |
| Borrado de datos | Eliminar cuenta/niño funciona; no hay retención ni copia de seguridad cifrada documentada. |
| Pruebas de interfaz automatizadas / navegadores | Recorrido manual en Chromium (escritorio y móvil). No hay E2E ni pruebas en Safari/Firefox, ni en dispositivos iOS/Android. |
| Contraseñas del modo local | PBKDF2 en el navegador; es sólo para desarrollo. |
