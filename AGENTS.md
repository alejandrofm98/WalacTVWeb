# AGENTS.md

## Build, Lint, and Test Commands

### Development
```bash
npm start                              # Start dev server with proxy
ng serve --proxy-config proxy.conf.json # Same as npm start
npm run watch                          # Build in watch mode for development
```

### Building
```bash
npm run build                          # Production build
ng build                               # Alias for production build
ng build --configuration=development   # Development build with source maps
```

### Testing
```bash
npm test                               # Run all tests with Karma
ng test                                # Run all tests
ng test --watch=false                  # Run tests once (no watch mode)
ng test --include='**/app.spec.ts'     # Run single test file
ng test --browsers=ChromeHeadless      # Run headless for CI
```

### TypeScript
```bash
npx tsc                                # Type-check only (no emit)
```

## Code Style Guidelines

### TypeScript Configuration
- **Strict mode enabled**: `strict: true` in tsconfig.json
- **No implicit any**: All functions must have explicit types
- **No implicit returns**: All code paths must return a value
- **Modern module syntax**: `module: preserve` (ESNext modules)
- **Decorators enabled**: `experimentalDecorators: true` for Angular
- **Target**: ES2022 with isolated modules

### Angular 20 Best Practices
- Use **standalone components** exclusively (no NgModules)
- Use **signals** for reactive state: `import { signal } from '@angular/core'`
- Use `inject()` for dependency injection instead of constructor injection
- Declare inputs with `@Input()` decorator or signal inputs
- Use `OnPush` change detection for performance
- Implement lifecycle interfaces explicitly (`OnInit`, `OnDestroy`, etc.)

### Naming Conventions
- **Components/Services/Classes**: PascalCase (`VideoPlayerComponent`, `AuthService`)
- **Files**: kebab-case for non-class files, PascalCase for class files
  - Components: `video-player.component.ts`
  - Services: `data.service.ts`
  - Utils: `slugify.ts`
- **Interfaces/Types**: PascalCase, no `I` prefix (`UserProfile` not `IUserProfile`)
- **Constants**: SCREAMING_SNAKE_CASE
- **Private members**: prefix with underscore `_privateMethod()`
- **Boolean properties**: use `is` or `has` prefix (`isLoading`, `hasMore`)

### Imports Organization
```typescript
// 1. Angular imports first
import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

// 2. Third-party libraries
import { Observable } from 'rxjs';

// 3. Internal absolute imports (if paths configured)
import { DataService } from '@app/services/data.service';

// 4. Relative imports last
import { slugify } from '../../utils/slugify';
import { NavbarComponent } from '../navbar/navbar.component';
```

### Formatting (Prettier)
- **Print width**: 100 characters
- **Single quotes**: Always use `'` for strings
- **HTML templates**: Angular parser for template formatting
- **Trailing commas**: No trailing commas in multi-line objects

### Component Structure
```typescript
@Component({
  selector: 'app-component-name',     // prefix with 'app-'
  standalone: true,                    // always standalone
  imports: [CommonModule, ...],        // declare dependencies
  templateUrl: './component-name.component.html',
  styleUrls: ['./component-name.component.css']
})
export class ComponentNameComponent implements OnInit, OnDestroy {
  // Public properties first
  publicProperty = '';
  
  // Private properties with underscore
  private _privateProperty = '';
  
  // Inject services
  private dataService = inject(DataService);
  
  // Lifecycle hooks
  ngOnInit(): void { }
  ngOnDestroy(): void { }
}
```

### Error Handling
- Use typed errors: `throw new Error('message')`
- Handle async operations with proper error boundaries
- Use RxJS `catchError` operator for observables
- Never expose sensitive data in error messages
- Log errors with descriptive context

### Type Safety Rules
- Explicit return types on all functions
- No `any` types - use `unknown` or proper interfaces
- Use strict null checks - handle undefined/null explicitly
- Prefer `const` over `let` - never use `var`
- Use arrow functions for callbacks
- Use optional chaining (`?.`) and nullish coalescing (`??`)

### Code Organization
- Single responsibility principle - one file per component
- Keep templates simple - extract complex logic to methods/services
- Group related methods together
- Private helper methods at the bottom of the class
- Constants at the top of the file or in separate constants files

### Testing (Jasmine/Karma)
- Place specs alongside source files (`*.spec.ts`)
- Use descriptive `describe` and `it` blocks
- Follow AAA pattern: Arrange, Act, Assert
- Mock external dependencies with `jasmine.createSpyObj`
- Test component logic, not Angular framework
