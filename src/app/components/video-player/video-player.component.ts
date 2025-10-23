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
import {CommonModule} from '@angular/common';
import {ActivatedRoute} from '@angular/router';
import {ChannelOption} from '../../models/channel-option.model';
import {DataService} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import Hls from 'hls.js';
import {Events} from '../../models';
import {slugify} from '../../utils/slugify';
import {HomeButton} from '../../shared/components/home-button/home-button';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule, HomeButton],
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
  currentOriginalUrl: string = ''; // Para comparar con los botones

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('title');
      if (slug) {
        const decodedTitle = slug.replace(/-/g, ' ');
        this.eventTitle = decodedTitle;
      }

      // Recuperamos el evento desde PlayerStateService
      const savedEvent = this.playerState.getEvent();
      if (savedEvent) {
        this.eventData = savedEvent;
        console.log('✅ Evento cargado desde PlayerState:', this.eventData);
        this.loadStreamFromEvent();
        return;
      }

      // Si no existe, buscamos en DataService por slug
      this.dataService.getItems().subscribe({
        next: (data) => {
          if (!data?.eventos) return;
          const foundEvent = data.eventos.find((e: Events) =>
            slugify(e.titulo) === slug
          );
          if (foundEvent) {
            this.eventData = foundEvent;
            console.log('✅ Evento encontrado:', this.eventData);
            console.log('📺 Enlaces disponibles:', this.eventData?.enlaces);
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

  /** 🔄 Cargar stream desde los datos del evento */
  private loadStreamFromEvent() {
    // ⚠️ Seguridad: comprobamos que eventData y enlaces existen
    const firstM3u8 = this.eventData?.enlaces?.[0]?.m3u8?.[0];
    if (!firstM3u8) {
      console.warn('⚠️ No hay streams disponibles en el evento');
      return;
    }

    // Guardamos la URL original para comparación en botones
    this.currentOriginalUrl = firstM3u8;
    const processedUrl = this.processStreamUrl(firstM3u8);
    this.streamUrl = processedUrl;

    this.shouldInitializePlayer = true;
    this.cdr.detectChanges();

    // Solo inicializar si el video element ya está disponible
    if (this.videoElement) {
      this.initializePlayer();
    }
  }

  /** 🔧 Procesar URL del stream */
  private processStreamUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);

      if (parsedUrl.toString().startsWith('http://127.0.0.1:6878')) {
        const id = parsedUrl.searchParams.get('id');
        return '/apiace/ace/manifest.m3u8?id=' + id;
      } else if (parsedUrl.toString().startsWith('https://walactv.walerike.com/proxy?url=')) {
        return parsedUrl.toString().replace('https://walactv.walerike.com', '/apiwalactv');
      }

      return url;
    } catch (e) {
      console.error('⚠️ Error parseando la URL del stream:', e);
      return url;
    }
  }

  /** 🎬 Inicializar HLS.js */
  private initializePlayer() {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      console.warn('⚠️ Video element no disponible aún');
      return;
    }

    const urlToUse = Array.isArray(this.streamUrl) ? this.streamUrl[0] : this.streamUrl;

    if (!urlToUse) {
      console.error('❌ No hay stream URL');
      return;
    }

    console.log('🎬 Inicializando player con URL:', urlToUse);

    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }

    if (Hls.isSupported()) {
      this.hls = new Hls({autoStartLoad: true});
      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        this.hls?.loadSource(urlToUse);
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(err => console.error('❌ Error al reproducir:', err));
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('⚠️ HLS.js error:', data);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = urlToUse;
      video.addEventListener('loadedmetadata', () => video.play());
    }

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

  /** 🎮 Controles */
  togglePlayPause() {
    const video = this.videoElement.nativeElement;
    if (video.paused) video.play().catch(console.error);
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

  /** Cambiar el stream activo al hacer click en un botón de canal */
  changeStream(stream: string) {
    console.log('🔄 Cambiando a stream:', stream);
    // Guardamos la URL original para que el botón se marque como activo
    this.currentOriginalUrl = stream;
    const processedUrl = this.processStreamUrl(stream);
    this.streamUrl = processedUrl;
    this.initializePlayer();
  }
}
