// app.routes.ts
import { Routes } from '@angular/router';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { EventsListComponent } from './components/events-lists/events-list.component';
import { LoginComponent } from './components/login/login.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  // Ruta pública (sin guard)
  { path: 'login', component: LoginComponent },

  // Rutas protegidas (requieren autenticación)
  {
    path: '',
    component: EventsListComponent,
    canActivate: [authGuard],
    pathMatch: 'full'
  },
  {
    path: 'player/:title',
    component: VideoPlayerComponent,
    canActivate: [authGuard]
  },

  // Catch-all: redirige a la página principal (que está protegida)
  { path: '**', redirectTo: '', pathMatch: 'full' }
];
