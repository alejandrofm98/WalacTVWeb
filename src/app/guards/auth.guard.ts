// auth.guard.ts
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanActivateFn } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { map, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);

  // Usa el observable 'user' de @angular/fire/auth
  return user(auth).pipe(
    take(1),
    map(currentUser => {
      if (currentUser) {
        // Usuario está autenticado
        console.log('✅ Usuario autenticado:', currentUser.email);
        return true;
      } else {
        // Usuario NO está autenticado, redirigir al login
        console.log('❌ Usuario no autenticado, redirigiendo a /login');
        router.navigate(['/login']);
        return false;
      }
    })
  );
};
