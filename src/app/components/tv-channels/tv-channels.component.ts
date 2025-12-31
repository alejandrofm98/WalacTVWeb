import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Router} from '@angular/router';
import {DataService} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {Channel} from '../../models/channel.model';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';

interface ChannelGroup {
  grupo: string;
  channels: Channel[];
  expanded: boolean;
}

@Component({
  selector: 'app-tv-channels',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './tv-channels.component.html',
  styleUrls: ['./tv-channels.component.css']
})
export class TvChannelsComponent implements OnInit {
  channels: Channel[] = [];
  groupedChannels: ChannelGroup[] = [];
  searchTerm: string = '';

  constructor(
    private dataService: DataService,
    private playerState: PlayerStateService,
    private router: Router
  ) {
  }

  ngOnInit(): void {
    console.log('📺 Componente TV Channels iniciado');
    this.loadChannels();
  }

  loadChannels(): void {
    this.dataService.getChannels().subscribe({
      next: (data: any) => {
        if (data && data["items"]) {
          // Convertir el objeto a array
          this.channels = Object.values(data["items"]) as Channel[];
          this.groupChannels();
          console.log('✅ Canales cargados:', this.channels);
          console.log('✅ Grupos creados:', this.groupedChannels);
        } else {
          console.log('⚠️ No se encontraron canales en el documento');
          this.channels = [];
          this.groupedChannels = [];
        }
      },
      error: (error) => {
        console.error('❌ Error cargando canales:', error);
        this.channels = [];
        this.groupedChannels = [];
      }
    });
  }

  private groupChannels(): void {
    const groups = new Map<string, Channel[]>();

    // Agrupar canales por grupo
    this.channels.forEach(channel => {
      const grupo = channel.grupo || 'Sin grupo';
      if (!groups.has(grupo)) {
        groups.set(grupo, []);
      }
      groups.get(grupo)!.push(channel);
    });

    // Convertir Map a array y ordenar alfabéticamente por grupo
    this.groupedChannels = Array.from(groups.entries())
      .map(([grupo, channels]) => ({
        grupo,
        channels: channels.sort((a, b) => a.numero - b.numero),
        expanded: true  // Por defecto todos expandidos
      }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo));
  }

  toggleGroup(group: ChannelGroup): void {
    group.expanded = !group.expanded;
  }

  onChannelClick(channel: Channel): void {
    console.log('▶️ Canal seleccionado:', channel.nombre);

    // Guardamos el canal en el servicio de estado
    this.playerState.setChannel(channel);

    // Creamos el slug del nombre del canal
    const slug = slugify(channel.nombre);

    // Navegamos al reproductor con el slug
    this.router.navigate(['/player', slug]);
  }

  onSearch(): void {
    if (!this.searchTerm.trim()) {
      this.groupChannels();
      return;
    }

    const searchTermLower = this.searchTerm.toLowerCase();
    const searchTermNumber = parseInt(this.searchTerm);

    const filteredChannels = this.channels.filter(channel => {
      // Buscar por nombre
      const matchesName = channel.nombre.toLowerCase().includes(searchTermLower);
      // Buscar por grupo
      const matchesGroup = channel.grupo.toLowerCase().includes(searchTermLower);
      // Buscar por número exacto
      const matchesNumber = !isNaN(searchTermNumber) && channel.numero === searchTermNumber;

      return matchesName || matchesGroup || matchesNumber;
    });

    // Reagrupar los canales filtrados
    const groups = new Map<string, Channel[]>();
    filteredChannels.forEach(channel => {
      const grupo = channel.grupo || 'Sin grupo';
      if (!groups.has(grupo)) {
        groups.set(grupo, []);
      }
      groups.get(grupo)!.push(channel);
    });

    this.groupedChannels = Array.from(groups.entries())
      .map(([grupo, channels]) => ({
        grupo,
        channels: channels.sort((a, b) => a.numero - b.numero),
        expanded: true  // Al buscar, expandir todos los grupos
      }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo));
  }

  get totalChannels(): number {
    return this.groupedChannels.reduce((sum, group) => sum + group.channels.length, 0);
  }
}
