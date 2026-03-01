# AGENTS.md

## Project Context

- Angular 20 app using standalone components.
- Main domain: events, channels, video playback, and IPTV admin panel.
- Routing is split between public pages (`/login`, `/test-player`) and protected pages (`/`, `/channels`, `/player/:title`, `/iptv`).

## Build, Test, and Type-Check Commands

### Development

```bash
npm start                                # Dev server with proxy.conf.json
ng serve --proxy-config proxy.conf.json # Equivalent to npm start
npm run watch                            # ng build --watch --configuration development
```

### Build

```bash
npm run build                            # Production build
ng build                                 # Same as npm run build
ng build --configuration=development     # Development build with source maps
```

### Tests

```bash
npm test                                 # Run tests in watch mode
ng test --watch=false                    # Single-run test execution
ng test --browsers=ChromeHeadless        # Headless execution
ng test --include='**/app.spec.ts'       # Run a specific spec pattern
```

### TypeScript Check

```bash
npx tsc --noEmit
```

## Environment and Proxy Notes

- Development proxy config: `proxy.conf.json`.
- Environment file: `src/environments/environment.ts`.
- Key environment values used by services:
  - `apiWalactv`
  - `acestreamHost`
  - `iptvApiUrl`
  - `adminEmails`

## Code Style Guidelines

### TypeScript and Angular

- Keep strict typing (`strict: true`, `noImplicitReturns`, `strictTemplates`).
- Prefer `inject()` for dependency injection.
- Use standalone components only (no NgModules).
- Add explicit return types to public methods and helpers.
- Avoid `any`; prefer exact models, union types, or `unknown`.

### Naming and Files

- Classes, components, services, interfaces, and types: PascalCase.
- File names: kebab-case (for example `video-player.component.ts`, `auth.service.ts`).
- Boolean names: use `is`/`has` prefixes.
- Constants: SCREAMING_SNAKE_CASE.

### Imports Order

1. Angular imports.
2. Third-party imports.
3. Internal imports.
4. Relative imports.

### Formatting

- Prettier config is in `package.json`.
- `printWidth: 100`.
- `singleQuote: true`.
- Angular HTML parser for `*.html` templates.

### Component Structure

- Keep components focused and small.
- Public API/properties at the top, helpers at the bottom.
- Keep complex business logic in services.
- Prefer `OnPush` when behavior allows it.

### Error Handling and RxJS

- Throw typed errors with useful context.
- Handle async failures with `catchError` where applicable.
- Do not leak sensitive values in logs or error messages.

### Testing Guidelines

- Keep specs alongside source files (`*.spec.ts`).
- Use clear `describe`/`it` names and AAA structure.
- Mock dependencies via `jasmine.createSpyObj`.
- Test business logic and component behavior, not framework internals.
