import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Input,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ActivatedRoute} from '@angular/router';
import {DataService} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import Hls from 'hls.js';
import {Events} from '../../models';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';
import {environment} from '../../../environments/environment';
import {Channel} from '../../models/channel.model';
import {Subscription} from 'rxjs';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule, NavbarComponent],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @Input() streamUrl: string | string[] = '';
  @Input() eventTitle: string = 'Reproducción en vivo';
  @Input() channel: Channel | null = null;

  private hls?: Hls;
  private shouldInitializePlayer = false;
  private dataService = inject(DataService);
  private playerState = inject(PlayerStateService);
  private cdr = inject(ChangeDetectorRef);
  private castSubscription?: Subscription;

  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;


  eventData?: Events;
  currentOriginalUrl: string = '';
  isChannelMode = false;

  constructor(private route: ActivatedRoute) {
  }

  ngOnInit() {

    this.route.paramMap.subscribe(params => {
      const slug = params.get('title');
      if (!slug) return;

      const savedChannel = this.playerState.getChannel();
      const savedEvent = this.playerState.getEvent();

      if (savedChannel && slugify(savedChannel.canal) === slug) {
        this.channel = savedChannel;
        this.isChannelMode = true;
        this.eventTitle = savedChannel.canal;
        this.loadStreamFromChannel();
        return;
      }

      if (savedEvent && slugify(savedEvent.titulo) === slug) {
        this.eventData = savedEvent;
        this.isChannelMode = false;
        this.eventTitle = savedEvent.titulo;
        this.loadStreamFromEvent();
        return;
      }

      this.loadFromBackend(slug);
    });
  }

  private loadFromBackend(slug: string) {
    this.dataService.getChannels().subscribe({
      next: (data) => {
        if (data?.canales) {
          const foundChannel = data.canales.find((c: Channel) =>
            slugify(c.canal) === slug
          );

          if (foundChannel) {
            this.channel = foundChannel;
            this.isChannelMode = true;
            this.eventTitle = foundChannel.canal;
            this.playerState.setChannel(foundChannel);
            this.loadStreamFromChannel();
            return;
          }
        }

        this.loadEventFromBackend(slug);
      },
      error: () => this.loadEventFromBackend(slug)
    });
  }

  private loadEventFromBackend(slug: string) {
    this.dataService.getItems().subscribe({
      next: (data) => {
        if (!data?.eventos) return;

        const foundEvent = data.eventos.find((e: Events) =>
          slugify(e.titulo) === slug
        );

        if (foundEvent) {
          this.eventData = foundEvent;
          this.isChannelMode = false;
          this.eventTitle = foundEvent.titulo;
          this.playerState.setEvent(foundEvent);
          this.loadStreamFromEvent();
        }
      }
    });
  }

  private loadStreamFromChannel() {
    if (!this.channel?.m3u8?.length) return;

    this.streamUrl = this.processStreamUrl(this.channel.m3u8[0]);
    this.currentOriginalUrl = this.channel.m3u8[0];
    this.shouldInitializePlayer = true;

    if (this.videoElement) {
      setTimeout(() => this.initializePlayer(), 0);
    }
  }

  ngAfterViewInit() {
    if (this.shouldInitializePlayer) {
      setTimeout(() => this.initializePlayer(), 0);
    }

    setTimeout(() => {
      const volumeSlider = document.querySelector('.volume-control input[type="range"]') as HTMLInputElement;
      if (volumeSlider) {
        const percentage = (this.volume * 100);
        volumeSlider.style.setProperty('--value', `${percentage}%`);
      }
    }, 100);
  }

  ngOnDestroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }
    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout);
    }
    if (this.castSubscription) {
      this.castSubscription.unsubscribe();
    }
  }

  get availableStreams(): string[] {
    if (this.isChannelMode && this.channel) {
      return this.channel.m3u8 ?? [];
    }
    if (!this.isChannelMode && this.eventData) {
      // Si el evento tiene varios enlaces, los aplana todos
      return this.eventData.enlaces?.flatMap(e => e.m3u8 ?? []) ?? [];
    }
    return [];
  }

  get streamSectionTitle(): string {
    if (this.isChannelMode && this.channel) {
      return this.channel.canal;
    }

    if (!this.isChannelMode && this.eventData?.enlaces?.length) {
      // Busca el enlace que contiene el stream actual
      const activeLink = this.eventData.enlaces.find(e =>
        e.m3u8?.includes(this.currentOriginalUrl)
      );
      return activeLink?.canal || this.eventData.enlaces[0].canal || 'Stream';
    }

    return 'Stream';
  }

  private loadStreamFromEvent() {
    const firstM3u8 = this.eventData?.enlaces?.[0]?.m3u8?.[0];
    if (!firstM3u8) return;

    this.currentOriginalUrl = firstM3u8;
    this.streamUrl = this.processStreamUrl(firstM3u8);
    this.shouldInitializePlayer = true;
    this.cdr.detectChanges();

    if (this.videoElement) {
      this.initializePlayer();
    }
  }

  private processStreamUrl(url: string, forChromecast: boolean = false): string {
    const apiBase = environment.apiWalactv;
    const acestreamBase = forChromecast ? 'https://acestream.walerike.com' : environment.acestreamHost;

    try {
      if (url.includes('127.0.0.1:6878') || url.includes('localhost:6878')) {
        const id = new URL(url).searchParams.get('id');
        if (id) {
          return `${acestreamBase}/ace/manifest.m3u8?id=${id}`;
        }
      }

      if (url.includes('acestream.walerike.com') || url.startsWith(acestreamBase)) {
        return url;
      }

      if (url.startsWith('https://walactv.walerike.com/proxy?url=')) {
        return url.replace('https://walactv.walerike.com', apiBase);
      }

      if (url.startsWith('/apiwalactv')) {
        return url.replace('/apiwalactv', apiBase);
      }

      if (url.startsWith('/apiace')) {
        return url.replace('/apiace', acestreamBase);
      }

      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }

      return url;
    } catch (e) {
      console.error('Error parseando URL:', e);
      return url;
    }
  }

  private initializePlayer() {
    const video = this.videoElement?.nativeElement;
    if (!video) return;

    const urlToUse = Array.isArray(this.streamUrl) ? this.streamUrl[0] : this.streamUrl;
    if (!urlToUse) return;

    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }

    if (Hls.isSupported()) {
      this.hls = new Hls({
        // Configuración optimizada para estabilidad (más parecido a VLC)
        debug: false,

        // Buffer más grande = más estable
        maxBufferLength: 60,              // VLC usa ~30-60s (antes: 30)
        maxMaxBufferLength: 600,          // Mantener
        maxBufferSize: 60 * 1000 * 1000,  // Mantener
        backBufferLength: 30,             // Reducido de 90 para liberar memoria

        // Tolerancia a problemas de red
        maxBufferHole: 1.0,               // Más tolerante (antes: 0.5)
        highBufferWatchdogPeriod: 5,      // Más tiempo antes de limpiar buffer (antes: 3)

        // Live streaming optimizado para estabilidad
        liveSyncDurationCount: 5,         // Más segmentos de sincronización (antes: 3)
        liveMaxLatencyDurationCount: 10,  // Más latencia permitida (antes: Infinity)
        liveDurationInfinity: false,      // Desactivar para mejor gestión de buffer
        liveBackBufferLength: 30,         // Buffer trasero para live

        // Carga y reintentos más agresivos
        autoStartLoad: true,
        startPosition: -1,

        // Timeouts más largos
        manifestLoadingTimeOut: 30000,    // 30s (antes: 20s)
        manifestLoadingMaxRetry: 15,      // Más reintentos (antes: 10)
        manifestLoadingRetryDelay: 2000,  // 2s entre reintentos

        levelLoadingTimeOut: 30000,       // 30s (antes: 20s)
        levelLoadingMaxRetry: 15,         // Más reintentos (antes: 10)
        levelLoadingRetryDelay: 2000,

        fragLoadingTimeOut: 60000,        // 60s para fragmentos (antes: 40s)
        fragLoadingMaxRetry: 15,          // Más reintentos (antes: 10)
        fragLoadingRetryDelay: 2000,      // 2s entre reintentos (antes: 1s)

        // Desactivar modo baja latencia
        lowLatencyMode: false,

        // Workers para mejor rendimiento
        enableWorker: true,

        // Configuración de red
        xhrSetup: (xhr: XMLHttpRequest) => {
          xhr.timeout = 60000;            // 60s (antes: 40s)
          xhr.withCredentials = false;
        },

        // Adaptive Bitrate más conservador
        abrEwmaDefaultEstimate: 500000,   // Estimación inicial conservadora (500kbps)
        abrBandWidthFactor: 0.85,         // Factor más conservador (default: 0.95)
        abrBandWidthUpFactor: 0.7,        // Más lento para subir calidad

        // Prevenir stalls
        maxFragLookUpTolerance: 0.5,      // Más tolerante buscando fragmentos
        maxStarvationDelay: 6,            // Más tiempo antes de considerar stalled (6s)
        maxLoadingDelay: 6,               // Más tiempo de carga permitido
      });

      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        this.hls?.loadSource(urlToUse);
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Intentar reproducir, si falla activar mute
        video.play().catch(() => {
          video.muted = true;
          return video.play();
        });
      });

      // Manejo de errores mejorado
      this.hls.on(Hls.Events.ERROR, (event, data) => {
        console.warn('HLS Error:', data.type, data.details, data.fatal);

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Error de red, intentando recuperar...');
              // Esperar más antes de reintentar
              setTimeout(() => {
                if (this.hls) {
                  this.hls.startLoad();
                }
              }, 3000); // 3s (antes: 1s)
              break;

            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Error de media, intentando recuperar...');
              this.hls?.recoverMediaError();
              break;

            default:
              console.error('Error fatal irrecuperable, reiniciando player...');
              this.hls?.destroy();
              // Esperar más antes de reiniciar completamente
              setTimeout(() => this.initializePlayer(), 5000); // 5s (antes: 2s)
              break;
          }
        }
      });

      // Logging adicional para debugging (opcional, quitar en producción)
      this.hls.on(Hls.Events.BUFFER_APPENDED, () => {
        const buffered = video.buffered;
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari nativo
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

    // Detectar y manejar stalls
    video.addEventListener('waiting', () => {
      console.log('Video buffering...');
    });

    video.addEventListener('stalled', () => {
      console.warn('Video stalled, intentando recuperar...');
      if (this.hls) {
        this.hls.startLoad();
      }
    });
  }

  togglePlayPause() {
    const video = this.videoElement.nativeElement;
    video.paused ? video.play().catch(console.error) : video.pause();
  }

  toggleMute() {
    this.videoElement.nativeElement.muted = !this.videoElement.nativeElement.muted;
  }

  setVolume(event: any): void {
    const newVolume = parseFloat(event.target.value);
    this.volume = newVolume;

    const percentage = (newVolume * 100);
    event.target.style.setProperty('--value', `${percentage}%`);

    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.volume = newVolume;
      this.isMuted = newVolume === 0;
    }
  }

  toggleFullscreen() {
    const container = this.videoElement.nativeElement.parentElement;

    if (!container) return;

    const doc = document as any;
    const elem = container as any;

    // Verificar si estamos en fullscreen
    const isInFullscreen = doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement;

    if (!isInFullscreen) {
      // Entrar en fullscreen
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
    } else {
      // Salir de fullscreen
      if (doc.exitFullscreen) {
        doc.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    }
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

  changeStream(stream: string) {
    this.currentOriginalUrl = stream;
    this.streamUrl = this.processStreamUrl(stream);
    this.initializePlayer();
  }

  changeChannelStream(index: number) {
    if (this.channel?.m3u8?.[index]) {
      this.streamUrl = this.channel.m3u8[index];
      this.currentOriginalUrl = this.channel.m3u8[index];
      this.initializePlayer();
    }
  }


}
