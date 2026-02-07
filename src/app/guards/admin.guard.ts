import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map(currentUser => {
      if (!currentUser) {
        router.navigate(['/login']);
        return false;
      }

      if (currentUser.role === 'admin') {
        console.log('✅ Usuario admin verificado:', currentUser.username);
        return true;
      }

      console.log('❌ Usuario no es admin, redirigiendo a /');
      router.navigate(['/']);
      return false;
    })
  );
};
