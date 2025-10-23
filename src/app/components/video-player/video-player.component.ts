import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  Input,
  OnDestroy,
  ChangeDetectorRef,
  OnInit,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ChannelOption } from '../../models/channel-option.model';
import { DataService } from '../../services/data.service';
import { PlayerStateService } from '../../services/player-state.service';
import Hls from 'hls.js';
import { Events } from '../../models';
import {slugify} from '../../utils/slugify';

@Component({
  selector: 'app-video-player',
  imports: [CommonModule],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @Input() streamUrl: string | string[] = '';
  @Input() eventTitle: string = 'Reproducción en vivo';

  private hls?: Hls;
  private shouldInitializePlayer = false;
  private dataService = inject(DataService);
  private playerState = inject(PlayerStateService);
  private cdr = inject(ChangeDetectorRef);

  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;

  eventData?: Events;

  // Opciones de canales (para mantener compatibilidad con tu HTML)
  channel1Options: ChannelOption[] = [
    { label: 'Opción 1', value: 'option1' },
    { label: 'Opción 2', value: 'option2' },
    { label: 'Opción 3', value: 'option3' },
    { label: 'Opción 4', value: 'option4' }
  ];

  channel2Options: ChannelOption[] = [
    { label: 'Opción 1', value: 'option1' },
    { label: 'Opción 2', value: 'option2' },
    { label: 'Opción 3', value: 'option3' },
    { label: 'Opción 4', value: 'option4' }
  ];

  selectedChannel1Option = 'option1';
  selectedChannel2Option = 'option1';

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
  this.route.paramMap.subscribe(params => {
    const slug = params.get('title');
    if (slug) {
      // Lo convertimos a algo parecido al título original
      const decodedTitle = slug.replace(/-/g, ' ');
      this.eventTitle = decodedTitle;
    }

    // Intentamos recuperar el evento desde PlayerStateService
    const savedEvent = this.playerState.getEvent();
    if (savedEvent) {
      this.eventData = savedEvent;
      this.loadStreamFromEvent();
      return;
    }

    // Si no existe, buscamos en el DataService por título aproximado
    this.dataService.getItems().subscribe({
      next: (data) => {
        if (!data?.eventos) return;
        const foundEvent = data.eventos.find((e: Events) =>
          slugify(e.titulo) === slug
        );
        if (foundEvent) {
          this.eventData = foundEvent;
          this.loadStreamFromEvent();
        } else {
          console.warn('❌ Evento no encontrado para el slug:', slug);
        }
      },
      error: (err) => console.error('❌ Error al cargar eventos:', err)
    });
  });
}

  ngAfterViewInit() {
    if (this.shouldInitializePlayer) {
      setTimeout(() => this.initializePlayer(), 0);
    }
  }

  ngOnDestroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }
    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout);
    }
  }

  /** =========================================================
   * 🔄 Cargar stream desde los datos del evento
   * ========================================================= */
  private loadStreamFromEvent() {
    if (!this.eventData?.enlaces?.length) return;

    const enlace = this.eventData.enlaces[0].m3u8[0];
    if (!enlace) return;

    // Si la URL apunta a un proxy o ACE Stream, la adaptamos
    try {
      const url = new URL(enlace);

      if (url.toString().startsWith('http://127.0.0.1:6878')) {
        const id = url.searchParams.get('id');
        this.streamUrl = '/apiace/ace/manifest.m3u8?id=' + id;
      } else if (url.toString().startsWith('https://walactv.walerike.com/proxy?url=')) {
        const fullUrl = url.toString();
        this.streamUrl = fullUrl.replace('https://walactv.walerike.com', '/apiwalactv');
      } else {
        this.streamUrl = enlace;
      }
    } catch (e) {
      console.error('⚠️ Error parseando la URL del stream:', e);
      this.streamUrl = enlace;
    }

    this.shouldInitializePlayer = true;
    this.cdr.detectChanges();
    this.initializePlayer();
  }

  /** =========================================================
   * 🎬 Inicializar HLS.js
   * ========================================================= */
  private initializePlayer() {
    const video = this.videoElement.nativeElement;
    const urlToUse = Array.isArray(this.streamUrl) ? this.streamUrl[0] : this.streamUrl;

    if (!urlToUse) {
      console.error('❌ No hay stream URL');
      return;
    }

    console.log('🎥 Inicializando HLS con URL:', urlToUse);

    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }

    if (Hls.isSupported()) {
      this.hls = new Hls({ autoStartLoad: true });
      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        console.log('📡 Media attached, cargando URL HLS...');
        this.hls?.loadSource(urlToUse);
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('✅ Manifest parsed, listo para reproducir');
        video.play().catch(err => console.error('❌ Error al reproducir:', err));
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('⚠️ HLS.js error:', data);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Soporte nativo (Safari)
      video.src = urlToUse;
      video.addEventListener('loadedmetadata', () => video.play());
    }

    // Eventos de control
    video.addEventListener('play', () => {
      this.isPlaying = true;
      this.cdr.markForCheck();
    });
    video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.cdr.markForCheck();
    });
    video.addEventListener('volumechange', () => {
      this.volume = video.volume;
      this.isMuted = video.muted;
      this.cdr.markForCheck();
    });
  }

  // 🎮 Controles de reproducción
  togglePlayPause() {
    const video = this.videoElement.nativeElement;
    if (video.paused) video.play().catch(err => console.error('❌ Error al reproducir:', err));
    else video.pause();
  }

  toggleMute() {
    const video = this.videoElement.nativeElement;
    video.muted = !video.muted;
  }

  setVolume(event: Event) {
    const input = event.target as HTMLInputElement;
    const video = this.videoElement.nativeElement;
    video.volume = parseFloat(input.value);
  }

  toggleFullscreen() {
    const video = this.videoElement.nativeElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else video.requestFullscreen();
  }

  onMouseMove() {
    this.showControls = true;
    if (this.hideControlsTimeout) clearTimeout(this.hideControlsTimeout);
    this.hideControlsTimeout = window.setTimeout(() => {
      if (this.isPlaying) {
        this.showControls = false;
        this.cdr.markForCheck();
      }
    }, 3000);
  }

  onMouseLeave() {
    if (this.isPlaying) {
      this.showControls = false;
      this.cdr.markForCheck();
    }
  }

  // 🔘 Métodos de selección de canales (los que faltaban)
  selectChannel1Option(value: string) {
    this.selectedChannel1Option = value;
  }

  selectChannel2Option(value: string) {
    this.selectedChannel2Option = value;
  }
}
