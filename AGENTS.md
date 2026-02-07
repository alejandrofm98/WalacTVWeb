# AGENTS.md

## Build, Lint, and Test Commands

### Development
```bash
npm start                    # Start dev server with proxy
ng serve --proxy-config proxy.conf.json  # Same as npm start
npm run watch               # Build in watch mode for development
```

### Building
```bash
npm run build              # Production build
ng build                   # Alias for production build
ng build --configuration=development  # Development build with source maps
```

### Testing
```bash
npm test                   # Run all tests with Karma
ng test                    # Run all tests
ng test --watch=false      # Run tests once (no watch mode)
ng test --include='**/app.spec.ts'  # Run single test file
ng test --browsers=ChromeHeadless  # Run headless for CI
```

### TypeScript
```bash
npx tsc                    # Type-check only (no emit)
```

## Code Style Guidelines

### TypeScript Configuration
- **Strict mode is enabled** - no implicit `any`, explicit return types required
- **Modern module syntax** - `module: preserve` (ESNext modules)
- **Decorators enabled** - `experimentalDecorators: true` for Angular

### Angular 20 Best Practices
- Use **standalone components** exclusively (no NgModules unless required)
- Use **signals** for reactive state management (`import { signal } from '@angular/core'`)
- Use `inject()` for dependency injection instead of constructor when possible
- Declare component inputs with `@Input()` decorator or signal inputs
- Use `OnPush` change detection strategy for performance

### Naming Conventions
- **Components/Services/Classes**: PascalCase (`VideoPlayerComponent`, `AuthService`)
- **Files**: kebab-case for non-class files, PascalCase for classes (`video-player.component.ts`, `types.ts`)
- **Interfaces**: PascalCase, no `I` prefix (`UserProfile` not `IUserProfile`)
- **Constants**: SCREAMING_SNAKE_CASE
- **Private properties/methods**: prefix with underscore `_privateMethod()`

### Imports
- Use **bare module imports** (no relative paths when possible)
- Group imports: external Angular → external libraries → internal
- Use absolute imports (`@app/services/auth.service`) configured via TypeScript paths if available
- Relative imports only for sibling files (`./*`, `../*`)

### Formatting (Prettier)
- **Print width**: 100 characters
- **Single quotes**: always use `'` for strings
- **HTML templates**: Angular parser for proper template formatting

### Error Handling
- Use typed errors (`throw new Error('message')`)
- Handle async operations with proper error boundaries
- Use RxJS `catchError` operator for observables
- Never expose sensitive data in error messages

### General Rules
- Explicit return types on all functions
- No `any` types - use `unknown` or proper types
- Use arrow functions for callbacks
- Prefer `const` over `let`
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Single responsibility principle - one file per component with template/styles inline or separate
- Keep templates simple - extract complex logic to methods or services

### Testing (Jasmine/Karma)
- Place specs alongside source files (`*.spec.ts`)
- Use descriptive `describe` and `it` blocks
- Follow AAA pattern: Arrange, Act, Assert
- Mock external dependencies with `jasmine.createSpyObj` or `jest.spyOn`
