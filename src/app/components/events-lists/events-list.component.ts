import{ Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { Observable } from 'rxjs';
import { Agenda, Events, Enlaces } from '../../models';

@Component({
  selector: 'app-events-list',
  imports: [CommonModule],
  templateUrl: './events-list.component.html',
  styleUrls: ['./events-list.component.css']
})
export class EventsListComponent implements OnInit {
  agenda!: Agenda;
  events: Events[] = [];
  loading = true;
  error: string | null = null;
  private dataService = inject(DataService);

  constructor(
    private router: Router
  ) {}

  ngOnInit() {
    this.loadEvents();
  }

  loadEvents() {
    try {
      this.loading = true;
      this.error = null;

      // Using the data service instead of Supabase directly
      const items$ = this.dataService.getItems();

      items$.subscribe({
        next: (data) => {
          // Assuming the data is an array of Agenda items
          if (data) {
            this.agenda = data as Agenda;
            this.events = this.agenda.eventos || [];
          } else {
            this.events= [];
          }
          this.loading = false;
        },
        error: (err) => {
          this.error = err.message || 'Error al cargar eventos';
          console.error('Error loading events:', err);
          this.loading = false;
        }
      });
    } catch (err: any) {
      this.error= err.message || 'Error al cargar eventos';
      console.error('Error loading events:', err);
      this.loading = false;
    }
  }

  openEvent(event: Events) {
    // TODO: Implement navigation to event
    console.log('Opening event:', event);
  }

openChannel(enlace: Enlaces) {
  // Pasar solo un ID seguro
  this.router.navigate(['/player'], {
    queryParams: {
      streamId: enlace.m3u8, // ID interno del canal/evento
      channelName: enlace.canal
    }
  });
}


  formatTime(time: string):string {
    return time.substring(0, 5);
  }

  getCategoryName(category: string): string {
    const names: { [key: string]: string } = {
      'football': 'Fútbol',
      'basketball': 'Baloncesto',
      'tennis': 'Tenis',
      'football-american': 'Fútbol Americano',
      'racing': 'Carreras'
    };
    return names[category] || category;
  }
}
