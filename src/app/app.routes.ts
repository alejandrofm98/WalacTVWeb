// app.routes.ts
import { Routes } from '@angular/router';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { IptvPanelComponent } from './components/iptv-panel/iptv-panel.component';
import { EventsListComponent } from './components/events-list/events-list.component';
import { ChannelsComponent } from './components/channels/channels.component';
import { LoginComponent } from './components/login/login.component';
import { TestPlayerComponent } from './components/test-player/test-player.component';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [
  // Ruta pública (sin guard)
  { path: 'login', component: LoginComponent },
  { path: 'test-player', component: TestPlayerComponent },

  // Rutas protegidas (requieren autenticación)
  {
    path: '',
    component: EventsListComponent,
    canActivate: [authGuard],
    pathMatch: 'full'
  },
  {
    path: 'channels',
    component: ChannelsComponent,
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
