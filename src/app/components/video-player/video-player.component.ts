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
import { ChromecastService, CastState } from '../../services/chromecast.service';
import Hls from 'hls.js';
import { Events } from '../../models';
import { slugify } from '../../utils/slugify';
import { NavbarComponent } from '../../shared/components/navbar-component/navbar.component';
import { environment } from '../../../environments/environment';
import { Channel } from '../../models/channel.model';
import { Subscription } from 'rxjs';

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
  private chromecastService = inject(ChromecastService);
  private cdr = inject(ChangeDetectorRef);
  private castSubscription?: Subscription;

  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;

  castState: CastState = {
    isAvailable: false,
    isConnected: false,
    isPlaying: false,
    deviceName: null,
    currentTime: 0,
    duration: 0
  };

  loadingChromecast = false;
  chromecastLoadingProgress = 0;
  chromecastLoadingMessage = '';

  eventData?: Events;
  currentOriginalUrl: string = '';
  isChannelMode = false;

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.castSubscription = this.chromecastService.castState$.subscribe(state => {
      this.castState = state;
      this.cdr.markForCheck();

      if (state.isConnected && this.videoElement?.nativeElement) {
        const video = this.videoElement.nativeElement;
        if (!video.paused) {
          video.pause();
        }
      }
    });

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
        video.play().catch(() => {
          video.muted = true;
          return video.play();
        });
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
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
    if (this.channel?.m3u8?.[index]) {
      this.streamUrl = this.channel.m3u8[index];
      this.currentOriginalUrl = this.channel.m3u8[index];
      this.initializePlayer();
    }
  }

  async startCasting() {
    if (!this.castState.isAvailable) {
      alert('Chromecast no está disponible');
      return;
    }

    try {
      this.loadingChromecast = true;
      this.chromecastLoadingProgress = 10;
      this.chromecastLoadingMessage = 'Preparando stream...';
      this.cdr.detectChanges();

      const videoEl = this.videoElement?.nativeElement;
      const originalUrl = this.currentOriginalUrl;

      if (!originalUrl) {
        alert('No hay stream cargado');
        this.loadingChromecast = false;
        return;
      }

      let chromecastUrl = this.processStreamUrl(originalUrl, true);

      if (chromecastUrl.includes('/getstream?')) {
        chromecastUrl = chromecastUrl.replace('/getstream?', '/manifest.m3u8?');
      }

      // Pre-inicializar stream para AceStream
      if (videoEl?.paused) {
        this.chromecastLoadingMessage = 'Iniciando buffer...';
        this.chromecastLoadingProgress = 20;
        this.cdr.detectChanges();

        try {
          await videoEl.play();
        } catch {
          videoEl.muted = true;
          await videoEl.play();
        }

        // Esperar 30 segundos para buffer
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          this.chromecastLoadingProgress = 20 + Math.floor((i / 30) * 50);
          this.chromecastLoadingMessage = `Cargando buffer... ${i + 1}/30s`;
          this.cdr.detectChanges();
        }
      }

      this.chromecastLoadingMessage = 'Conectando con Chromecast...';
      this.chromecastLoadingProgress = 80;
      this.cdr.detectChanges();

      if (this.castState.isConnected) {
        await this.loadMediaToChromecast();
      } else {
        await this.chromecastService.requestSession();

        this.chromecastLoadingMessage = 'Enviando stream...';
        this.chromecastLoadingProgress = 90;
        this.cdr.detectChanges();

        await new Promise(resolve => setTimeout(resolve, 2000));
        await this.loadMediaToChromecast();
      }

      this.chromecastLoadingProgress = 100;
      this.chromecastLoadingMessage = 'Stream cargado';
      this.cdr.detectChanges();

      setTimeout(() => {
        this.loadingChromecast = false;
        this.cdr.detectChanges();
      }, 2000);

    } catch (error: any) {
      this.loadingChromecast = false;
      this.cdr.detectChanges();

      if (error.code !== 'cancel') {
        alert('Error al conectar con Chromecast:\n\n' + (error.message || 'Error desconocido'));
      }

      const videoEl = this.videoElement?.nativeElement;
      if (videoEl?.paused) {
        videoEl.play().catch(() => {});
      }
    }
  }

  private async loadMediaToChromecast(): Promise<void> {
    const originalUrl = this.currentOriginalUrl;

    if (!originalUrl) {
      throw new Error('No hay stream disponible');
    }

    let chromecastUrl = this.processStreamUrl(originalUrl, true);

    if (chromecastUrl.includes('/getstream?')) {
      chromecastUrl = chromecastUrl.replace('/getstream?', '/manifest.m3u8?');
    }

    if (!chromecastUrl.startsWith('https://acestream.walerike.com')) {
      const url = new URL(chromecastUrl.startsWith('http') ? chromecastUrl : 'https://dummy.com' + chromecastUrl);
      const id = url.searchParams.get('id');

      if (id) {
        chromecastUrl = `https://acestream.walerike.com/ace/manifest.m3u8?id=${id}`;
      } else {
        throw new Error('URL de stream inválida');
      }
    }

    if (chromecastUrl.includes('localhost') || chromecastUrl.includes('127.0.0.1')) {
      throw new Error('No se pueden transmitir URLs locales a Chromecast');
    }

    if (!chromecastUrl.startsWith('https://')) {
      throw new Error('Chromecast requiere URLs HTTPS');
    }

    const currentState = this.chromecastService.getCurrentState();
    if (!currentState.isConnected) {
      throw new Error('La conexión con Chromecast se perdió');
    }

    const videoEl = this.videoElement?.nativeElement;
    if (videoEl && !videoEl.paused) {
      videoEl.pause();
    }

    await this.chromecastService.loadMedia(chromecastUrl, this.eventTitle);
  }

  stopCasting() {
    this.chromecastService.endSession();

    const videoEl = this.videoElement?.nativeElement;
    if (videoEl?.paused) {
      videoEl.play().catch(() => {});
    }
  }

  toggleCastPlayPause() {
    if (!this.castState.isConnected) return;
    this.chromecastService.togglePlayPause();
  }
}
