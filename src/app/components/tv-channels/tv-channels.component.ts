import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { PlayerStateService } from '../../services/player-state.service';
import { Channel } from '../../models/channel.model';
import { slugify } from '../../utils/slugify';

@Component({
  selector: 'app-tv-channels',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tv-channels.component.html',
  styleUrls: ['./tv-channels.component.css']
})
export class TvChannelsComponent implements OnInit {
  channels: Channel[] = [];
  filteredChannels: Channel[] = [];
  searchTerm: string = '';

  constructor(
    private dataService: DataService,
    private playerState: PlayerStateService,
    private router: Router
  ) {}

  ngOnInit(): void {
    console.log('📺 Componente TV Channels iniciado');
    this.loadChannels();
  }

  loadChannels(): void {
    this.dataService.getChannels().subscribe({
      next: (data: { canales: Channel[] }) => {
        if (data && data.canales) {
          this.channels = data.canales;
          this.filteredChannels = [...this.channels];
          console.log('✅ Canales cargados:', this.channels);
        } else {
          console.log('⚠️ No se encontraron canales en el documento');
          this.channels = [];
          this.filteredChannels = [];
        }
      },
      error: (error) => {
        console.error('❌ Error cargando canales:', error);
        this.channels = [];
        this.filteredChannels = [];
      }
    });
  }

  onChannelClick(channel: Channel): void {
    console.log('▶️ Canal seleccionado:', channel.canal);

    // Guardamos el canal en el servicio de estado
    this.playerState.setChannel(channel);

    // Creamos el slug del nombre del canal
    const slug = slugify(channel.canal);

    // Navegamos al reproductor con el slug
    this.router.navigate(['/player', slug]);
  }

  onSearch(): void {
    if (!this.searchTerm.trim()) {
      this.filteredChannels = [...this.channels];
      return;
    }

    const searchTermLower = this.searchTerm.toLowerCase();
    this.filteredChannels = this.channels.filter(channel =>
      channel.canal.toLowerCase().includes(searchTermLower)
    );
  }
}
