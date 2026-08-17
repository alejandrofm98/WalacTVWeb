# AGENTS.md - walactvWeb

> Guia para agentes de codigo que trabajen en walactvWeb y en su ecosistema
> de proyectos hermanos (Android, API, scrapper). Secciones 0-3 son
> contexto obligatorio antes de tocar nada. Secciones 4-10 son referencia
> operativa.

## 0. Ecosistema y posicion del proyecto

walactvWeb es el cliente web de un ecosistema de 3 proyectos hermanos del mismo owner (`alejandrofm98`).

```
   +-------------+        +-------------+
   |  walactvWeb |        |   WalacTV   |
   |  Angular 20 |        |  Android TV |
   |  :4200      |        |  Kotlin     |
   +------+------+        +-----+-------+
          |   HTTP + JWT       |
          |  (REST + HLS web)  |  (REST + HLS android)
          v                    v
   +--------------------------------------+
   |          iptv-api (nodo central)     |
   |     FastAPI @ localhost:3010         |
   |  - REST + HLS proxy                  |
   |  - Postgres / Supabase               |
   +---+----------+-----------+-----------+
       |          |           |
       | lee JSON | escribe   | escribe scraper_failures
       v          v           v
   +--------+ +----------+ +-----------+
   |walactv-| | iptv-data| | Postgres  |
   |scrapper| | volumen  | | tabla     |
   | (Ofelia| | compartido| | scraper_  |
   |  cron) | |  (JSONs) | | failures  |
   +--------+ +----------+ +-----------+
```

### Tabla de proyectos hermanos

| Proyecto           | Rol                  | Stack                                | Repo                                                 | Relacion con walactvWeb                                           |
| ------------------ | -------------------- | ------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------- |
| iptv-api           | Backend central      | FastAPI 0.128, Pydantic, SQLAlchemy  | `github.com/alejandrofm98/iptv-api`                  | Proveedor de datos. Consume endpoints REST + HLS con perfil `web` |
| WalacTV (Android)  | Cliente TV           | Kotlin, Android TV                   | `github.com/alejandrofm98/WalacTV`                   | Mismo backend, perfil HLS `chromecast`                             |
| walactv-scrapper   | Productor catalogos  | Python 3.12, asyncpg, Ofelia         | `github.com/alejandrofm98/walactv-scrapper`          | Upstream de datos. iptv-api consume sus JSONs                     |

### Proyectos NO relacionados

`pistas-deportivas-frontend` (otro owner `JLAC008`, reserva de pistas deportivas) convive en este workspace pero no comparte codigo, datos ni redes. Tratar como proyecto ajeno.

## 1. Contexto rapido

- **Stack**: Angular 20, standalone components, RxJS, TypeScript estricto.
- **Puerto local**: `4200`. **Entry point**: `src/main.ts`.
- **Routing**: `src/app/app.routes.ts` — rutas publicas (`/login`, `/test-player`) y protegidas (`/`, `/channels`, `/player/:title`, `/iptv`).
- **Auth**: JWT propio via iptv-api. El interceptor `auth.interceptor.ts` anexa el token a cada request.
- **Backends**:
  - `apiWalactv` — API principal (REST + HLS).
  - `acestreamHost` — Proxy AceStream para streams P2P.
  - `iptvApiUrl` — iptv-api directo (auth, contenido).
- **Proxy**: `proxy.conf.json` redirige `/api` y `/acestream` al backend en desarrollo.
- **Firebase**: configuracion en `src/firebase-messaging-sw.js` para notificaciones push.

```bash
npm start                                # Dev server con proxy
npx ng serve --proxy-config proxy.conf.json # Equivalente
curl http://localhost:4200                # Verificar arranque
```

## 2. Arquitectura

### 2.1 Componentes principales

| Componente               | Archivo                                       | Rol                                         |
| ------------------------ | --------------------------------------------- | ------------------------------------------- |
| `App`                    | `src/app/app.ts`                              | Root, router-outlet                         |
| `HomeComponent`          | `src/app/pages/home/home.component.ts`        | Dashboard principal                         |
| `ChannelsComponent`      | `src/app/pages/channels/channels.component.ts`| Listado de canales                          |
| `VideoPlayerComponent`   | `src/app/pages/video-player/...`              | Reproductor HLS + AceStream                 |
| `IptvComponent`          | `src/app/pages/iptv/iptv.component.ts`        | Panel admin IPTV                            |
| `LoginComponent`         | `src/app/pages/login/login.component.ts`      | Autenticacion                               |
| `TestPlayerComponent`    | `src/app/pages/test-player/...`               | Player de pruebas                           |

### 2.2 Servicios

| Servicio                  | Archivo                                           | Rol                                    |
| ------------------------- | ------------------------------------------------- | -------------------------------------- |
| `AuthService`             | `src/app/services/auth.service.ts`                | Login, registro, sesion JWT            |
| `ContentService`          | `src/app/services/content.service.ts`             | Catalogos, busqueda, favoritos         |
| `StreamService`           | `src/app/services/stream.service.ts`              | URLs de stream, HLS, AceStream         |
| `WatchProgressService`    | `src/app/services/watch-progress.service.ts`      | Continuidad de visionado               |
| `CalendarService`         | `src/app/services/calendar.service.ts`            | EPG y programacion                     |
| `NotificationService`     | `src/app/services/notification.service.ts`        | Firebase Cloud Messaging               |
| `DeviceService`           | `src/app/services/device.service.ts`              | Identificacion y registro de device    |

### 2.3 Guards e interceptors

| Elemento                  | Archivo                                           | Rol                                    |
| ------------------------- | ------------------------------------------------- | -------------------------------------- |
| `authGuard`               | `src/app/guards/auth.guard.ts`                    | Protege rutas privadas                 |
| `adminGuard`              | `src/app/guards/admin.guard.ts`                   | Protege rutas de admin                 |
| `AuthInterceptor`         | `src/app/interceptors/auth.interceptor.ts`        | Anexa JWT a requests HTTP              |

### 2.4 Convenciones de codigo

- Componentes standalone (sin NgModules).
- DI via `inject()` (no constructor injection).
- Routing centralizado en `src/app/app.routes.ts`.
- Naming: PascalCase para clases, kebab-case para archivos.
- Booleanos: prefijos `is`/`has`. Constantes: `SCREAMING_SNAKE_CASE`.
- Imports: Angular -> terceros -> internos -> relativos.
- Sin emojis en codigo, comentarios ni docs.

## 3. Patrones obligatorios

1. **Standalone components**: todos los componentes deben ser standalone. No crear NgModules.
2. **inject() DI**: usar `inject(Service)` en lugar de constructor parameters.
3. **Routing**: declarar rutas en `app.routes.ts`. No registrar rutas en componentes.
4. **Auth guard**: cualquier ruta protegida debe usar `authGuard` o `adminGuard`.
5. **HTTP interceptor**: todos los requests HTTP pasan por `AuthInterceptor`. No agregar headers JWT manualmente.
6. **catchError**: manejar errores HTTP con `catchError` en servicios. No propagar errores sin contexto.
7. **Dark theme**: el proyecto usa dark theme por defecto. No agregar estilos claros sin autorizacion.
8. **OnPush**: preferir `ChangeDetectionStrategy.OnPush` cuando el componente no dependa de mutaciones externas.

## 4. Contratos publicos (cross-project)

Estos endpoints son contratos con iptv-api. Cambiarlos sin coordinar rompe el frontend.

### 4.1 Endpoints consumidos de iptv-api

| Endpoint                                    | Metodo | Componente/Servicio que lo usa          |
| ------------------------------------------- | ------ | --------------------------------------- |
| `/api/auth/login`                           | POST   | `AuthService`                           |
| `/api/auth/register`                        | POST   | `AuthService`                           |
| `/api/content/channels`                     | GET    | `ContentService`, `ChannelsComponent`   |
| `/api/content/movies`                       | GET    | `ContentService`                        |
| `/api/content/series`                       | GET    | `ContentService`                        |
| `/api/content/channels/all`                 | GET    | `ContentService`                        |
| `/api/content/countries?content_type=...`   | GET    | `ContentService`                        |
| `/api/content/stats?content_type=...`       | GET    | `ContentService`                        |
| `/api/content/{kind}/{id}`                  | GET    | `ContentService`                        |
| `/api/search?q=...&page=...&page_size=...`  | GET    | `ContentService`                        |
| `/api/full/{channels|movies|series}`        | GET    | `ContentService`                        |
| `/api/series/{name}/episodes?page=...`      | GET    | `ContentService`                        |
| `/api/watch-progress`                       | GET    | `WatchProgressService`                  |
| `/api/watch-progress/{id}`                  | PUT    | `WatchProgressService`                  |
| `/api/channel-favorites`                    | GET    | `ContentService`                        |
| `/api/channel-favorites`                    | POST   | `ContentService`                        |
| `/api/channel-favorites`                    | DELETE | `ContentService`                        |
| `/api/home?country=...`                     | GET    | `HomeComponent`                         |
| `/api/calendar/{today}?client=web`          | GET    | `CalendarService`                       |
| `/live/{username}/{password}/{channelId}`   | GET    | `StreamService`                         |
| `/movie/{username}/{password}/{providerId}` | GET    | `StreamService`                         |

### 4.2 Perfil HLS

- **web**: perfil por defecto para walactvWeb. Se envia en el header `hls_profile` via `AuthInterceptor`.
- **chromecast**: perfil para WalacTV Android. No usar en este proyecto.

### 4.3 Proxy AceStream

- `proxy.conf.json` redirige `/acestream/*` a `acestreamHost` configurado en `environment.ts`.
- Usado por `VideoPlayerComponent` para streams P2P.

## 5. Configuracion y secretos

### 5.1 Environment files

- `src/environments/environment.ts` — configuracion de desarrollo (completa).
- `src/environments/environment.prod.ts` — produccion (**incompleta**, ver roadmap).

### 5.2 Valores de environment

| Variable         | Uso                                              |
| ---------------- | ------------------------------------------------ |
| `apiWalactv`     | URL base del API principal                       |
| `acestreamHost`  | Host del proxy AceStream                         |
| `iptvApiUrl`     | URL directa de iptv-api                          |
| `adminEmails`    | Emails con acceso admin                          |
| `firebase`       | Config de Firebase (opcional)                    |

### 5.3 Proxy

- `proxy.conf.json` en raiz del proyecto.
- Redirige `/api` -> `apiWalactv` y `/acestream` -> `acestreamHost`.
- Solo activo en `ng serve` (desarrollo).

### 5.4 Secretos

- **Nunca commitear** `.env`, credenciales de Firebase, ni tokens.
- `docker/.env` contiene secretos de produccion. No versionar.
- Firebase config es publico (se usa en client-side). Las claves de servicio van en el backend.

## 6. Lint, formato, tipos y calidad

### 6.1 Comandos

```bash
npx ng lint                                  # ESLint via Angular CLI
npx tsc --noEmit                             # Type-check sin emitir
npx prettier --check "src/**/*.ts"           # Verificar formato
npx prettier --write "src/**/*.ts"           # Formatear
npm test                                     # Tests (watch mode)
ng test --watch=false                        # Tests (single run)
ng build                                     # Build de produccion
```

### 6.2 Configuracion

- **ESLint**: `eslint.config.js` en raiz. Reglas: `no-explicit-any` (warn), `no-unused-vars` (error, ignora `_`), `prefer-const`, `eqeqeq`.
- **TypeScript**: `tsconfig.json` con `strict: true`, `noImplicitReturns`, `strictTemplates`.
- **Prettier**: configurado en `package.json`. `printWidth: 100`, `singleQuote: true`.
- **Angular ESLint**: plugin `@angular-eslint/eslint-plugin` para reglas especificas de Angular.

### 6.3 Pre-commit y CI

NO estan configurados todavia. Roadmap en 9. Mientras tanto: correr los comandos de 6.1 manualmente antes de cada PR.

## 7. Testing

- **Framework**: Jasmine + Karma (configuracion en `karma.conf.js`).
- **Spec files**: solo 2 archivos de test:
  - `src/app/app.spec.ts` — smoke test del componente root.
  - `src/app/pages/home/home.component.spec.ts` — test basico del home.
- **Cobertura**: muy baja. La mayoria de componentes y servicios no tienen tests.
- **Patrones**:
  - Usar `TestBed.configureTestingModule` con imports standalone.
  - Mockear servicios via `jasmine.createSpyObj` o `provideHttpClientTesting`.
  - Tests de comportamiento, no de implementacion.
  - Ejecutar con `ng test --browsers=ChromeHeadless` en CI.

## 8. Criterios para cambios

1. No romper el routing: cualquier cambio en `app.routes.ts` debe mantener la estructura de rutas publicas/protegidas.
2. No romper la autenticacion: el interceptor JWT y los guards deben seguir funcionando. Probar login -> ruta protegida.
3. No romper el proxy: si se cambia `proxy.conf.json`, verificar que `/api` y `/acestream` siguen funcionando.
4. Mantener compatibilidad con iptv-api: si se agrega un consumo de endpoint nuevo, verificar que existe en el backend (seccion 4.1).
5. Sin estilos claros: el proyecto es dark-theme-only. No agregar temas light sin autorizacion.

## 9. Roadmap (no en esta iteracion)

1. ~~Configurar ESLint~~ (completado).
2. Configurar CI con GitHub Actions (lint + type-check + test + build).
3. Completar `environment.prod.ts` con todas las variables necesarias.
4. Agregar tests a componentes y servicios criticos (cubrir minimo 60%).
5. Eliminar duplicacion de CSS entre componentes (extraer tokens compartidos).
6. Dividir `VideoPlayerComponent` en sub-componentes (player, controls, quality selector).
7. Unificar `cast.d.ts` — definiciones de tipos Chromecast consolidadas.

## 10. Checklist antes de cerrar una tarea

1. Type-check limpio: `npx tsc --noEmit` sin errores.
2. Lint limpio: `npx ng lint` sin warnings nuevos.
3. Formato correcto: `npx prettier --check "src/**/*.ts"` sin diffs.
4. Tests pasando: `ng test --watch=false` sin fallos.
5. Build exitoso: `ng build` sin errores.
6. Routing verificado: rutas publicas accesibles sin auth, rutas protegidas redirigen a login.
7. Sin secretos en el diff: `git diff --staged | grep -iE 'key|secret|token|password|firebase'`.
8. Sin emojis en codigo, comentarios ni docs.
