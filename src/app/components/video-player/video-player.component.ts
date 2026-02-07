import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  ViewChild,
  HostListener
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ActivatedRoute, Router} from '@angular/router';
import {DataService, IptvChannel} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';


declare const mpegts: any;

interface StreamSource {
  name: string;
  url: string;
  logo?: string;
  group?: string;
}

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule, NavbarComponent],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;

  streamUrl: string = '';
  eventTitle: string = 'Reproducción en vivo';

  private player: any;
  private hlsPlayer: any;
  private shouldInitializePlayer = false;
  private dataService = inject(DataService);
  private playerState = inject(PlayerStateService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);

  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;

  currentOriginalUrl: string = '';
  isChannelMode = false;

  allChannels: IptvChannel[] = [];
  currentChannelIndex: number = -1;
  isFullscreen = false;

  showChannelOverlay = false;
  private hideChannelOverlayTimeout?: number;

  currentChannel: IptvChannel | null = null;
  availableStreams: StreamSource[] = [];

  private touchStartX = 0;
  private touchStartY = 0;
  private touchEndX = 0;
  private touchEndY = 0;

  constructor(private route: ActivatedRoute) {
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (!this.isChannelMode) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nextChannel();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previousChannel();
    }
  }

  @HostListener('document:fullscreenchange')
  @HostListener('document:webkitfullscreenchange')
  @HostListener('document:mozfullscreenchange')
  @HostListener('document:msfullscreenchange')
  onFullscreenChange() {
    const doc = document as any;
    this.isFullscreen = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    if (!this.isFullscreen) {
      this.unlockOrientation();
      this.showNavbar();
    }

    this.cdr.markForCheck();
  }

  @HostListener('window:orientationchange', ['$event'])
  onOrientationChange(event: any) {
    console.log('Orientación cambiada:', event.target.screen.orientation.type);
  }

  onTouchStart(event: TouchEvent): void {
    if (!this.isChannelMode) return;

    this.touchStartX = event.changedTouches[0].screenX;
    this.touchStartY = event.changedTouches[0].screenY;
  }

  onTouchEnd(event: TouchEvent): void {
    if (!this.isChannelMode) return;

    this.touchEndX = event.changedTouches[0].screenX;
    this.touchEndY = event.changedTouches[0].screenY;
    this.handleSwipeGesture();
  }

  private handleSwipeGesture(): void {
    const swipeThreshold = 50;
    const deltaX = this.touchEndX - this.touchStartX;
    const deltaY = Math.abs(this.touchEndY - this.touchStartY);

    if (Math.abs(deltaX) > swipeThreshold && deltaY < swipeThreshold) {
      if (deltaX > 0) {
        this.previousChannel();
      } else {
        this.nextChannel();
      }
    }
  }

  ngOnInit() {
    this.loadAllChannels();

    this.route.paramMap.subscribe(params => {
      const slug = params.get('title');
      if (!slug) return;

      const savedChannel = this.playerState.getChannel() as IptvChannel | null;

      if (savedChannel && slugify(savedChannel.nombre) === slug) {
        this.currentChannel = savedChannel;
        this.isChannelMode = true;
        this.eventTitle = savedChannel.nombre;
        this.updateCurrentChannelIndex();
        this.loadStreamFromChannel();
        return;
      }

      this.loadFromBackend(slug);
    });
  }

  private loadAllChannels(): void {
    this.dataService.getChannels(0, 100).subscribe({
      next: (response) => {
        this.allChannels = response.items;
        this.allChannels.sort((a, b) => (a.num || 0) - (b.num || 0));
        this.updateCurrentChannelIndex();
        console.log('📺 Canales cargados:', this.allChannels.length);
      },
      error: (error) => console.error('Error cargando canales:', error)
    });
  }

  private updateCurrentChannelIndex(): void {
    if (this.currentChannel && this.allChannels.length > 0) {
      this.currentChannelIndex = this.allChannels.findIndex(
        c => c.id === this.currentChannel!.id
      );
    }
  }

  nextChannel(): void {
    if (!this.isChannelMode || this.allChannels.length === 0) return;
    const currentIndex = this.allChannels.findIndex(c => c.id === this.currentChannel?.id);
    if (currentIndex === -1 || currentIndex >= this.allChannels.length - 1) return;
    const nextChannel = this.allChannels[currentIndex + 1];
    this.navigateToChannel(nextChannel);
  }

  previousChannel(): void {
    if (!this.isChannelMode || this.allChannels.length === 0) return;
    const currentIndex = this.allChannels.findIndex(c => c.id === this.currentChannel?.id);
    if (currentIndex <= 0) return;
    const prevChannel = this.allChannels[currentIndex - 1];
    this.navigateToChannel(prevChannel);
  }

  private navigateToChannel(channel: IptvChannel): void {
    this.currentChannel = channel;
    this.eventTitle = channel.nombre;
    this.currentChannelIndex = this.allChannels.findIndex(c => c.id === channel.id);

    const savedChannel = this.playerState.getChannel() as IptvChannel | null;
    if (savedChannel?.id !== channel.id) {
      this.playerState.setChannel(channel);
    }

    const slug = slugify(channel.nombre);
    this.router.navigate(['/player', slug], { replaceUrl: true });

    this.showChannelOverlay = true;
    if (this.hideChannelOverlayTimeout) {
      clearTimeout(this.hideChannelOverlayTimeout);
    }
    this.hideChannelOverlayTimeout = window.setTimeout(() => {
      this.showChannelOverlay = false;
      this.cdr.markForCheck();
    }, 3000);

    this.loadStreamFromChannel();
  }

  get hasPreviousChannel(): boolean {
    if (!this.isChannelMode || this.allChannels.length === 0 || !this.currentChannel) return false;
    const currentIndex = this.allChannels.findIndex(c => c.id === this.currentChannel!.id);
    return currentIndex > 0;
  }

  get hasNextChannel(): boolean {
    if (!this.isChannelMode || this.allChannels.length === 0 || !this.currentChannel) return false;
    const currentIndex = this.allChannels.findIndex(c => c.id === this.currentChannel!.id);
    return currentIndex !== -1 && currentIndex < this.allChannels.length - 1;
  }

  private loadFromBackend(slug: string) {
    this.dataService.getChannels(0, 100).subscribe({
      next: (response) => {
        const foundChannel = response.items.find(c =>
          slugify(c.nombre) === slug
        );

        if (foundChannel) {
          this.currentChannel = foundChannel;
          this.isChannelMode = true;
          this.eventTitle = foundChannel.nombre;
          this.playerState.setChannel(foundChannel);
          this.updateCurrentChannelIndex();
          this.loadStreamFromChannel();
        }
      },
      error: () => console.error('Canal no encontrado')
    });
  }

  private loadStreamFromChannel() {
    if (!this.currentChannel?.id || !this.currentChannel.stream_url) return;

    this.streamUrl = this.currentChannel.stream_url;
    this.currentOriginalUrl = this.currentChannel.stream_url;
    this.availableStreams = [{
      name: this.currentChannel.nombre,
      url: this.currentChannel.stream_url,
      logo: this.currentChannel.logo,
      group: this.currentChannel.grupo
    }];

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
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    if (this.hlsPlayer) {
      this.hlsPlayer.destroy();
      this.hlsPlayer = null;
    }
    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout);
    }
    if (this.hideChannelOverlayTimeout) {
      clearTimeout(this.hideChannelOverlayTimeout);
    }
    this.unlockOrientation();
    this.showNavbar();
  }

  private initializePlayer() {
    const video = this.videoElement?.nativeElement;
    if (!video || !this.streamUrl) {
      console.error('❌ Video element or stream URL not available');
      return;
    }

    const urlToUse = this.streamUrl;
    console.log('🎬 Inicializando player con URL:', urlToUse);

    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    if (this.hlsPlayer) {
      this.hlsPlayer.destroy();
      this.hlsPlayer = null;
    }

    const wasPlaying = !video.paused;
    const currentVolume = video.volume;
    const wasMuted = video.muted;

    const urlLower = urlToUse.toLowerCase();
    const isHLS = urlLower.includes('.m3u8');
    const isMP4 = urlLower.includes('.mp4');
    const isMKV = urlLower.includes('.mkv');
    const isChannel = !isHLS && !isMP4 && !isMKV;

    // Wait for libraries to load
    const waitForLibs = (): Promise<{ Hls: any; mpegts: any }> => {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const Hls = (window as any).Hls;
          const mpegts = (window as any).mpegts;
          if (Hls || mpegts) {
            clearInterval(checkInterval);
            resolve({ Hls, mpegts });
          }
        }, 100);
        // Timeout after 5 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve({ Hls: (window as any).Hls, mpegts: (window as any).mpegts });
        }, 5000);
      });
    };

    waitForLibs().then(({ Hls, mpegts }) => {
      console.log('🎬 Libraries loaded:', { Hls: !!Hls, mpegts: !!mpegts });

      let playerInitialized = false;

      if (isHLS && Hls && Hls.isSupported()) {
        console.log('🎬 Usando HLS.js');
        playerInitialized = true;
        this.initHlsPlayer(video, urlToUse, wasPlaying, wasMuted);
      } else if (isChannel && mpegts && mpegts.isSupported()) {
        console.log('🎬 Usando MPEG-TS (mpegts.js)');
        playerInitialized = true;
        this.initMpegtsPlayer(video, urlToUse, wasPlaying, wasMuted);
      } else if ((isMP4 || isMKV) && (video.canPlayType('video/mp4') || video.canPlayType('video/webm'))) {
        console.log('🎬 Usando video nativo (MP4/MKV)');
        playerInitialized = true;
        video.src = urlToUse;
        video.load();
        this.playVideo(video, wasPlaying, wasMuted);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        console.log('🎬 Usando HLS nativo (Safari)');
        playerInitialized = true;
        video.src = urlToUse;
        video.load();
        this.playVideo(video, wasPlaying, wasMuted);
      } else if (mpegts && mpegts.isSupported()) {
        console.log('🎬 Usando MPEG-TS como fallback');
        playerInitialized = true;
        this.initMpegtsPlayer(video, urlToUse, wasPlaying, wasMuted);
      } else {
        console.warn('⚠️ Navegador no soporta formatos');
        playerInitialized = true;
        video.src = urlToUse;
        video.load();
        this.playVideo(video, wasPlaying, wasMuted);
      }

      if (!playerInitialized) {
        console.error('❌ No se pudo inicializar ningún player');
      }
    });

    this.setupVideoEventListeners(video);
  }

  private initHlsPlayer(video: HTMLVideoElement, url: string, wasPlaying: boolean, wasMuted: boolean): void {
    const Hls = (window as any).Hls;

    this.hlsPlayer = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
      debug: false
    });

    this.hlsPlayer.loadSource(url);
    this.hlsPlayer.attachMedia(video);

    this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('✅ HLS manifest parsed');
      video.volume = video.volume;
      video.muted = wasMuted;
      this.playVideo(video, wasPlaying, wasMuted);
    });

    this.hlsPlayer.on(Hls.Events.ERROR, (event: any, data: any) => {
      console.error('❌ HLS error:', data);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('🔄 HLS network error, retrying...');
            this.hlsPlayer?.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('🔄 HLS media error, recovering...');
            this.hlsPlayer?.recoverMediaError();
            break;
          default:
            console.log('🛑 HLS fatal error');
            this.hlsPlayer?.destroy();
            this.hlsPlayer = null;
            break;
        }
      }
    });
  }

  private initMpegtsPlayer(video: HTMLVideoElement, url: string, wasPlaying: boolean, wasMuted: boolean): void {
    const mpegts = (window as any).mpegts;

    this.player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: url,
      enableWorker: true,
      liveBufferLatencyChasing: true,
      lazyLoad: false,
      enableStashBuffer: false,
      stashInitialSize: 128
    });

    this.player.on(mpegts.Events.ERROR, (type: any, detail: any) => {
      console.error('❌ MPEG-TS error:', type, detail);
    });

    this.player.on(mpegts.Events.LOADING_COMPLETE, () => {
      console.log('✅ MPEG-TS loaded');
    });

    this.player.attachMediaElement(video);
    this.player.load();
    video.volume = video.volume;
    video.muted = wasMuted;
    this.playVideo(video, wasPlaying, wasMuted);
  }

  private playVideo(video: HTMLVideoElement, wasPlaying: boolean, wasMuted: boolean): void {
    if (wasPlaying) {
      video.play().catch(() => {});
    } else {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    }
  }

  private setupVideoEventListeners(video: HTMLVideoElement): void {
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

    video.addEventListener('waiting', () => {
      console.log('Video esperando datos...');
    });

    video.addEventListener('canplay', () => {
      console.log('Video puede comenzar a reproducirse');
    });

    video.addEventListener('error', (e) => {
      console.error('❌ Error en el elemento de video:', e);
      const mpegtsLib = (window as any).mpegts;
      console.error('❌ Video error details:', {
        src: video.src,
        currentSrc: video.currentSrc,
        error: video.error ? {
          code: video.error.code,
          message: video.error.message
        } : null,
        networkState: video.networkState,
        readyState: video.readyState,
        mpegtsSupported: mpegtsLib?.isSupported()
      });

      // Retry with mpegts if native failed and not already using it
      if (!this.player && mpegtsLib?.isSupported()) {
        console.log('🔄 Reintentando con mpegts.js...');
        const urlToUse = this.streamUrl;
        try {
          this.player = mpegtsLib.createPlayer({
            type: 'mpegts',
            isLive: true,
            url: urlToUse,
            enableWorker: true,
            liveBufferLatencyChasing: true,
            lazyLoad: false,
            enableStashBuffer: false,
            stashInitialSize: 128
          });
          this.player.on(mpegtsLib.Events.ERROR, (type: any, detail: any) => {
            console.error('❌ mpegts.js retry error:', type, detail);
          });
          this.player.attachMediaElement(video);
          this.player.load();
          console.log('✅mpegts.js iniciado correctamente');
        } catch (err) {
          console.error('❌ Error iniciando mpegts.js:', err);
        }
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

  private hideNavbar(): void {
    const navbar = document.querySelector('app-navbar') as HTMLElement;
    if (navbar) {
      navbar.style.display = 'none';
    }
  }

  private showNavbar(): void {
    const navbar = document.querySelector('app-navbar') as HTMLElement;
    if (navbar) {
      navbar.style.display = '';
    }
  }

  toggleFullscreen() {
    const container = this.videoElement.nativeElement.parentElement;
    if (!container) return;

    const doc = document as any;
    const elem = container as any;

    const isInFullscreen = doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement;

    if (!isInFullscreen) {
      this.hideNavbar();

      if (elem.requestFullscreen) elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
      else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
      else if (elem.msRequestFullscreen) elem.msRequestFullscreen();

      this.lockToLandscape();
    } else {
      this.unlockOrientation();

      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
      else if (doc.msExitFullscreen) doc.msExitFullscreen();
    }
  }

  private lockToLandscape(): void {
    if (this.isOrientationLockSupported()) {
      const screenOrientation = (screen as any).orientation;

      screenOrientation.lock('landscape')
        .then(() => {
          console.log('✅ Pantalla bloqueada en orientación horizontal');
        })
        .catch((error: any) => {
          console.log('⚠️ No se pudo bloquear la orientación:', error);
        });
    }
  }

  private unlockOrientation(): void {
    if (this.isOrientationLockSupported()) {
      (screen as any).orientation.unlock();
      console.log('✅ Orientación desbloqueada');
    }
  }

  private isOrientationLockSupported(): boolean {
    return !!(
      typeof screen !== 'undefined' &&
      (screen as any).orientation &&
      typeof (screen as any).orientation.lock === 'function'
    );
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

  changeStream(stream: StreamSource) {
    this.streamUrl = stream.url;
    this.currentOriginalUrl = stream.url;
    this.initializePlayer();
  }
}
