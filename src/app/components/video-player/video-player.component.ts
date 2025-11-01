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
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../services/data.service';
import { PlayerStateService } from '../../services/player-state.service';
import Hls from 'hls.js';
import { Events } from '../../models';
import { slugify } from '../../utils/slugify';
import { NavbarComponent } from '../../shared/components/navbar-component/navbar.component';
import { environment } from '../../../environments/environment';
import { Channel } from '../../models/channel.model';

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

  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;

  eventData?: Events;
  currentOriginalUrl: string = '';
  isChannelMode = false;

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('title');
      if (!slug) return;

      console.log('🔍 Slug detectado:', slug);

      // Intentar cargar desde el estado guardado primero
      const savedChannel = this.playerState.getChannel();
      const savedEvent = this.playerState.getEvent();

      if (savedChannel && slugify(savedChannel.canal) === slug) {
        console.log('✅ Canal encontrado en estado:', savedChannel.canal);
        this.channel = savedChannel;
        this.isChannelMode = true;
        this.eventTitle = savedChannel.canal;
        this.loadStreamFromChannel();
        return;
      }

      if (savedEvent && slugify(savedEvent.titulo) === slug) {
        console.log('✅ Evento encontrado en estado:', savedEvent.titulo);
        this.eventData = savedEvent;
        this.isChannelMode = false;
        this.eventTitle = savedEvent.titulo;
        this.loadStreamFromEvent();
        return;
      }

      // Si no hay estado guardado, buscar en el backend
      console.log('🔄 Buscando en backend...');
      this.loadFromBackend(slug);
    });
  }

  private loadFromBackend(slug: string) {
    // Primero intentar buscar en canales
    this.dataService.getChannels().subscribe({
      next: (data) => {
        if (data?.canales) {
          const foundChannel = data.canales.find((c: Channel) =>
            slugify(c.canal) === slug
          );

          if (foundChannel) {
            console.log('✅ Canal encontrado en backend:', foundChannel.canal);
            this.channel = foundChannel;
            this.isChannelMode = true;
            this.eventTitle = foundChannel.canal;
            this.playerState.setChannel(foundChannel); // Guardar para futuras recargas
            this.loadStreamFromChannel();
            return;
          }
        }

        // Si no es un canal, buscar en eventos
        this.loadEventFromBackend(slug);
      },
      error: (err) => {
        console.error('❌ Error al cargar canales:', err);
        this.loadEventFromBackend(slug);
      }
    });
  }

  private loadEventFromBackend(slug: string) {
    this.dataService.getItems().subscribe({
      next: (data) => {
        if (!data?.eventos) {
          console.error('❌ No se encontraron eventos');
          return;
        }

        const foundEvent = data.eventos.find((e: Events) =>
          slugify(e.titulo) === slug
        );

        if (foundEvent) {
          console.log('✅ Evento encontrado en backend:', foundEvent.titulo);
          this.eventData = foundEvent;
          this.isChannelMode = false;
          this.eventTitle = foundEvent.titulo;
          this.playerState.setEvent(foundEvent); // Guardar para futuras recargas
          this.loadStreamFromEvent();
        } else {
          console.error('❌ No se encontró contenido con slug:', slug);
        }
      },
      error: (err) => console.error('❌ Error al cargar eventos:', err)
    });
  }

  private loadStreamFromChannel() {
    if (!this.channel?.m3u8?.length) {
      console.error('❌ No hay URL de stream para el canal');
      return;
    }

    console.log('📺 Cargando stream del canal:', this.channel.m3u8[0]);

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
  }

  ngOnDestroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }
    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout);
    }
    // NO limpiar el estado aquí para que funcione el reload
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

  private processStreamUrl(url: string): string {
    const apiBase = environment.apiWalactv;
    const acestreamBase = environment.acestreamHost;

    try {
      if (url.includes('127.0.0.1:6878') || url.includes('localhost:6878')) {
        const id = new URL(url).searchParams.get('id');
        if (id) return `${acestreamBase}/ace/manifest.m3u8?id=${id}`;
      }

      if (url.startsWith(acestreamBase)) return url;

      if (url.startsWith('https://walactv.walerike.com/proxy?url=')) {
        return url.replace('https://walactv.walerike.com', apiBase);
      }

      if (url.startsWith('/apiwalactv')) {
        return url.replace('/apiwalactv', apiBase);
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

    console.log('🎬 Inicializando reproductor con URL:', urlToUse);

    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }

    if (Hls.isSupported()) {
      this.hls = new Hls({
        debug: false,
        autoStartLoad: true,
        startPosition: -1,
        maxBufferLength: 30,
        maxMaxBufferLength: 600,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 3,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: Infinity,
        liveDurationInfinity: true,
        enableWorker: true,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 10,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 10,
        fragLoadingTimeOut: 40000,
        fragLoadingMaxRetry: 10,
        fragLoadingRetryDelay: 1000,
        lowLatencyMode: false,
        backBufferLength: 90,
        xhrSetup: (xhr: XMLHttpRequest) => {
          xhr.timeout = 40000;
          xhr.withCredentials = false;
        }
      });

      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        this.hls?.loadSource(urlToUse);
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(err => {
          video.muted = true;
          return video.play();
        });
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS Error:', data.type, data.details);

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setTimeout(() => this.hls?.startLoad(), 1000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              this.hls?.recoverMediaError();
              break;
            default:
              this.hls?.destroy();
              setTimeout(() => this.initializePlayer(), 2000);
              break;
          }
        }
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

  togglePlayPause() {
    const video = this.videoElement.nativeElement;
    video.paused ? video.play().catch(console.error) : video.pause();
  }

  toggleMute() {
    this.videoElement.nativeElement.muted = !this.videoElement.nativeElement.muted;
  }

  setVolume(event: Event) {
    const input = event.target as HTMLInputElement;
    this.videoElement.nativeElement.volume = parseFloat(input.value);
  }

  toggleFullscreen() {
    const video = this.videoElement.nativeElement;
    document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen();
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
    if (this.channel && this.channel.m3u8 && this.channel.m3u8[index]) {
      console.log('🔄 Cambiando a stream alternativo:', this.channel.m3u8[index]);
      this.streamUrl = this.channel.m3u8[index];
      this.currentOriginalUrl = this.channel.m3u8[index];
      this.initializePlayer();
    }
  }
}
