import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { Channel } from '../../models/channel.model';

@Component({
  selector: 'app-tv-channels',
  standalone: true,
  imports: [CommonModule, FormsModule, VideoPlayerComponent],
  templateUrl: './tv-channels.component.html',
  styleUrls: ['./tv-channels.component.css']
})
export class TvChannelsComponent implements OnInit {
  channels: Channel[] = [];
  filteredChannels: Channel[] = [];
  selectedChannel: Channel | null = null;
  searchTerm: string = '';

  constructor(private dataService: DataService) {}

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
    this.selectedChannel = channel;
  }

  closePlayer(): void {
    console.log('❌ Cerrando reproductor');
    this.selectedChannel = null;
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
