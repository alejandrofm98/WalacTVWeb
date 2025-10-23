import { Routes } from '@angular/router';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { EventsListComponent } from './components/events-lists/events-list.component';

export const routes: Routes = [
  { path: '', component: EventsListComponent, pathMatch: 'full' },
  { path: 'player/:title', component: VideoPlayerComponent },
  { path: '**', redirectTo: '' } // Catch-all route that redirects to the events list
];