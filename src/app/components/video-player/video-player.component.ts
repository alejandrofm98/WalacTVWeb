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
import {of, expand, reduce} from 'rxjs';
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

  private channelsLoaded = false;
  private boundKeyboardHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(private route: ActivatedRoute) {
    this.volume = this.playerState.getVolume();
    this.isMuted = this.playerState.isMuted();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Only handle navigation when in channel mode and channels are loaded
    if (!this.isChannelMode || this.allChannels.length < 2) return;

    // Prevent handling if user is typing in an input
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    console.log('[KeyNav] key=', event.key, 'currentChannelIndex=', this.currentChannelIndex, 'total=', this.allChannels.length, 'isChannelMode=', this.isChannelMode);

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
      case 'Right':
      case 'Up':
        event.preventDefault();
        event.stopPropagation();
        this.nextChannel();
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'Left':
      case 'Down':
        event.preventDefault();
        event.stopPropagation();
        this.previousChannel();
        break;
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
    if (!this.isChannelMode || this.allChannels.length < 2) return;

    this.touchStartX = event.changedTouches[0].screenX;
    this.touchStartY = event.changedTouches[0].screenY;
  }

  onTouchEnd(event: TouchEvent): void {
    if (!this.isChannelMode || this.allChannels.length < 2) return;

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
        this.setChannel(savedChannel);
        return;
      }

      this.findChannelBySlug(slug);
    });
  }

  private loadAllChannels(): void {
    const BATCH_SIZE = 500; // Load channels in batches to avoid overwhelming the API

    // First, get the first batch and total count
    this.dataService.getChannels(0, BATCH_SIZE).subscribe({
      next: (firstResponse) => {
        let allItems = [...firstResponse.items];
        const total = firstResponse.total;

        console.log(`📺 Cargando canales: ${allItems.length} de ${total} (total)`);

        // If there are more channels, load them in batches
        if (total > BATCH_SIZE) {
          const remainingBatches = Math.ceil((total - BATCH_SIZE) / BATCH_SIZE);
          let completedBatches = 0;

          // Create an array of observables for remaining batches
          const batchRequests = [];
          for (let i = 1; i <= remainingBatches; i++) {
            const skip = i * BATCH_SIZE;
            batchRequests.push(
              this.dataService.getChannels(skip, BATCH_SIZE).toPromise()
            );
          }

          // Execute all remaining batches
          Promise.all(batchRequests).then(responses => {
            responses.forEach(response => {
              if (response && response.items) {
                allItems = [...allItems, ...response.items];
              }
              completedBatches++;
            });

            this.allChannels = allItems;
            this.allChannels.sort((a, b) => (a.num || 0) - (b.num || 0));
            this.channelsLoaded = true;
            console.log('📺 Todos los canales cargados:', this.allChannels.length);

            if (this.currentChannel) {
              this.updateCurrentChannelIndex();
            }
          }).catch(error => {
            console.error('Error cargando batches adicionales:', error);
            this.allChannels = allItems;
            this.allChannels.sort((a, b) => (a.num || 0) - (b.num || 0));
            this.channelsLoaded = true;
            if (this.currentChannel) {
              this.updateCurrentChannelIndex();
            }
          });
        } else {
          // All channels loaded in first batch
          this.allChannels = allItems;
          this.allChannels.sort((a, b) => (a.num || 0) - (b.num || 0));
          this.channelsLoaded = true;
          console.log('📺 Canales cargados:', this.allChannels.length);

          if (this.currentChannel) {
            this.updateCurrentChannelIndex();
          }
        }
      },
      error: (error) => {
        console.error('Error cargando canales:', error);
        this.channelsLoaded = true;
        if (this.currentChannel) {
          this.updateCurrentChannelIndex();
        }
      }
    });
  }

  private findChannelBySlug(slug: string): void {
    if (!this.channelsLoaded) {
      setTimeout(() => this.findChannelBySlug(slug), 200);
      return;
    }

    let foundChannel = this.allChannels.find(c => slugify(c.nombre) === slug);

    if (!foundChannel) {
      foundChannel = this.allChannels.find(c =>
        slugify(c.nombre).includes(slug) || slug.includes(slugify(c.nombre))
      );
    }

    if (foundChannel) {
      this.setChannel(foundChannel);
    } else {
      console.warn('Canal no encontrado:', slug);
    }
  }

  private setChannel(channel: IptvChannel): void {
    this.currentChannel = channel;
    this.isChannelMode = true;
    this.eventTitle = channel.nombre;
    this.playerState.setChannel(channel);

    this.loadStreamFromChannel();

    // Update index after stream loads, allowing channels to be fully loaded
    if (this.channelsLoaded) {
      this.updateCurrentChannelIndex();
    }
  }

  private updateCurrentChannelIndex(): void {
    if (!this.currentChannel) return;
    this.currentChannelIndex = this.allChannels.findIndex(
      c => c.id === this.currentChannel!.id
    );

    // Note: We no longer add the current channel to allChannels if not found.
    // The channel should already be in the list loaded from the API.
    // If not found, currentChannelIndex will remain -1 until the correct list is loaded.
  }

  nextChannel(): void {
    // Allow navigation as long as there are channels loaded
    if (this.allChannels.length === 0) return;

    let currentIndex = this.allChannels.findIndex(c => c.id === this.currentChannel?.id);

    // If current channel is not yet in the list, start from 0
    if (currentIndex === -1) {
      currentIndex = 0;
    }

    const nextIndex = currentIndex >= this.allChannels.length - 1 ? 0 : currentIndex + 1;
    const nextChannel = this.allChannels[nextIndex];

    this.navigateToChannel(nextChannel);
  }

  previousChannel(): void {
    // Allow navigation as long as there are channels loaded
    if (this.allChannels.length === 0) return;

    let currentIndex = this.allChannels.findIndex(c => c.id === this.currentChannel?.id);

    if (currentIndex === -1) {
      currentIndex = this.allChannels.length - 1;
    }

    const prevIndex = currentIndex <= 0 ? this.allChannels.length - 1 : currentIndex - 1;
    const prevChannel = this.allChannels[prevIndex];

    this.navigateToChannel(prevChannel);
  }

  private navigateToChannel(channel: IptvChannel): void {
    if (!channel) return;

    this.currentChannel = channel;
    this.eventTitle = channel.nombre;
    this.currentChannelIndex = this.allChannels.findIndex(c => c.id === channel.id);
    this.playerState.setChannel(channel);

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
    return this.isChannelMode && this.allChannels.length > 1;
  }

  get hasNextChannel(): boolean {
    return this.isChannelMode && this.allChannels.length > 1;
  }

  private loadStreamFromChannel(): void {
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
    this.isPlaying = true;

    if (this.videoElement) {
      setTimeout(() => this.initializePlayer(true), 0);
    }
  }

  ngAfterViewInit() {
    if (this.shouldInitializePlayer) {
      setTimeout(() => this.initializePlayer(true), 0);
    }

    setTimeout(() => {
      const volumeSlider = document.querySelector('.volume-control input[type="range"]') as HTMLInputElement;
      if (volumeSlider) {
        const percentage = (this.volume * 100);
        volumeSlider.style.setProperty('--value', `${percentage}%`);
      }
    }, 100);

    // Ensure keyboard events are captured even when video has focus
    this.setupKeyboardListeners();
  }

  private setupKeyboardListeners(): void {
    // Create bound handler for proper cleanup
    this.boundKeyboardHandler = this.handleKeyboardEvent.bind(this);

    // Add keyboard listener to video element to ensure it works when focused
    const video = this.videoElement?.nativeElement;
    if (video) {
      video.setAttribute('tabindex', '0');
      video.style.outline = 'none';

      video.addEventListener('keydown', this.boundKeyboardHandler);

      // Focus the video element to ensure keyboard events work
      video.focus();
    }

    // Also listen on window to catch all keyboard events
    window.addEventListener('keydown', this.boundKeyboardHandler);
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

    // Cleanup keyboard listeners
    if (this.boundKeyboardHandler) {
      window.removeEventListener('keydown', this.boundKeyboardHandler);
      const video = this.videoElement?.nativeElement;
      if (video) {
        video.removeEventListener('keydown', this.boundKeyboardHandler);
      }
    }
  }

  private initializePlayer(autoplay: boolean = true) {
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

    const savedVolume = this.playerState.getVolume();
    const savedMuted = this.playerState.isMuted();
    const wasPlaying = autoplay;

    const urlLower = urlToUse.toLowerCase();
    const isHLS = urlLower.includes('.m3u8');
    const isMP4 = urlLower.includes('.mp4');
    const isMKV = urlLower.includes('.mkv');
    const isChannel = !isHLS && !isMP4 && !isMKV;

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
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve({ Hls: (window as any).Hls, mpegts: (window as any).mpegts });
        }, 5000);
      });
    };

    waitForLibs().then(({ Hls, mpegts }) => {
      let playerInitialized = false;

      if (isHLS && Hls && Hls.isSupported()) {
        playerInitialized = true;
        this.initHlsPlayer(video, urlToUse, wasPlaying, savedMuted, savedVolume);
      } else if (isChannel && mpegts && mpegts.isSupported()) {
        playerInitialized = true;
        this.initMpegtsPlayer(video, urlToUse, wasPlaying, savedMuted, savedVolume);
      } else if ((isMP4 || isMKV) && (video.canPlayType('video/mp4') || video.canPlayType('video/webm'))) {
        playerInitialized = true;
        video.src = urlToUse;
        video.muted = savedMuted;
        video.volume = savedVolume;
        video.load();
        this.playVideo(video, wasPlaying, savedMuted, savedVolume);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        playerInitialized = true;
        video.src = urlToUse;
        video.muted = savedMuted;
        video.volume = savedVolume;
        video.load();
        this.playVideo(video, wasPlaying, savedMuted, savedVolume);
      } else if (mpegts && mpegts.isSupported()) {
        playerInitialized = true;
        this.initMpegtsPlayer(video, urlToUse, wasPlaying, savedMuted, savedVolume);
      } else {
        playerInitialized = true;
        video.src = urlToUse;
        video.muted = savedMuted;
        video.volume = savedVolume;
        video.load();
        this.playVideo(video, wasPlaying, savedMuted, savedVolume);
      }

      if (!playerInitialized) {
        console.error('❌ No se pudo inicializar ningún player');
      }
    });

    this.setupVideoEventListeners(video);
  }

  private initHlsPlayer(video: HTMLVideoElement, url: string, wasPlaying: boolean, wasMuted: boolean, volume: number): void {
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
      video.volume = volume;
      video.muted = wasMuted;
      this.playVideo(video, wasPlaying, wasMuted, volume);
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

  private initMpegtsPlayer(video: HTMLVideoElement, url: string, wasPlaying: boolean, wasMuted: boolean, volume: number): void {
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
    video.volume = volume;
    video.muted = wasMuted;
    this.playVideo(video, wasPlaying, wasMuted, volume);
  }

  private playVideo(video: HTMLVideoElement, wasPlaying: boolean, savedMuted: boolean, savedVolume: number): void {
    video.muted = savedMuted;
    video.volume = savedVolume;

    const playPromise = video.play();

    if (playPromise !== undefined) {
      playPromise.then(() => {
      }).catch((error) => {
        console.log('🔇 Reproducción bloqueada');
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
    this.isMuted = !this.isMuted;
    this.playerState.setMuted(this.isMuted);
    this.videoElement.nativeElement.muted = this.isMuted;
  }

  setVolume(event: any): void {
    const newVolume = parseFloat(event.target.value);
    this.volume = newVolume;
    this.playerState.setVolume(newVolume);

    const percentage = (newVolume * 100);
    event.target.style.setProperty('--value', `${percentage}%`);

    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.volume = newVolume;
      this.isMuted = newVolume === 0;
      this.playerState.setMuted(this.isMuted);
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
