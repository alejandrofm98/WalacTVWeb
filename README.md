# Walactv Web

Frontend en Angular 20 para reproducir canales/eventos y gestionar IPTV con autenticacion por roles.

## Requisitos

- Node.js 20+
- npm 10+

## Instalacion

```bash
npm install
```

## Configuracion de entorno

La app usa variables en `src/environments/environment.ts`.

Valores usados actualmente:

- `apiWalactv`: proxy para API de Walactv (`/apiwalactv`)
- `acestreamHost`: proxy para AceStream (`/apiace`)
- `iptvApiUrl`: URL base de autenticacion/gestion IPTV (por defecto `http://localhost:3010`)
- `adminEmails`: correos con permisos de administracion

El proyecto incluye `proxy.conf.json` para desarrollo local con `ng serve`/`npm start`.

## Desarrollo

```bash
npm start
```

Alternativas:

```bash
ng serve --proxy-config proxy.conf.json
npm run watch
```

La app queda disponible en `http://localhost:4200/`.

## Build

```bash
npm run build
```

Build de desarrollo:

```bash
ng build --configuration=development
```

## Tests

```bash
npm test
```

Correr tests una sola vez o en headless:

```bash
ng test --watch=false
ng test --browsers=ChromeHeadless
```

## Rutas principales

- `/login`: acceso publico
- `/`: listado de eventos (protegido)
- `/channels`: listado de canales (protegido)
- `/player/:title`: reproductor (protegido)
- `/iptv`: panel IPTV (protegido y solo admin)
- `/test-player`: reproductor de prueba

## Stack tecnico

- Angular 20 standalone components
- RxJS
- Karma + Jasmine para unit tests
- HLS.js para reproduccion

## Notas

- No hay framework e2e configurado actualmente.
- Si cambias endpoints/backend, revisa `proxy.conf.json` y `src/environments/environment.ts`.
