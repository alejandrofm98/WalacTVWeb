// app.routes.ts
import { Routes } from '@angular/router';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { IptvPanelComponent } from './components/iptv-panel/iptv-panel.component';
import { EventsListComponent } from './components/events-lists/events-list.component';
import { TvChannelsComponent }  from './components/tv-channels/tv-channels.component';
import { LoginComponent } from './components/login/login.component';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';

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
    path: 'channels',
    component: TvChannelsComponent,
    canActivate: [authGuard],
    pathMatch: 'full'
  },
  {
    path: 'player/:title',
    component: VideoPlayerComponent,
    canActivate: [authGuard]
  },
  {
    path: 'iptv',
    component: IptvPanelComponent,
    canActivate: [authGuard, adminGuard],
    pathMatch: 'full'
  },

  // Catch-all: redirige a la página principal (que está protegida)
  { path: '**', redirectTo: '', pathMatch: 'full' }
];
