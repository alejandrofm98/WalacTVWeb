import {Component, OnInit, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Router} from '@angular/router';
import {DataService} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {Agenda, Events, Enlaces} from '../../models';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';

@Component({
  selector: 'app-events-list',
  standalone: true,
  imports: [CommonModule, NavbarComponent],
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
    private router: Router,
    private playerState: PlayerStateService
  ) {
  }

  ngOnInit() {
    this.loadEvents();
  }

  loadEvents() {
    this.loading = true;
    this.error = null;

    this.dataService.getItems().subscribe({
      next: (data) => {
        this.agenda = data as Agenda;
        this.events = this.agenda.eventos || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err.message || 'Error al cargar eventos';
        console.error('Error loading events:', err);
        this.loading = false;
      }
    });
  }

  openEvent(event: Events) {
    const slug = slugify(event.titulo);

    // Guardamos el evento completo en el servicio de estado
    this.playerState.setEvent(event);

    // Navegamos con el slug limpio
    this.router.navigate(['/player', slug]);
  }


  formatTime(time: string): string {
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
