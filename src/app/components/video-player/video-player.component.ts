import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  HostListener
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ActivatedRoute, Router} from '@angular/router';
import {DataService} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {Events} from '../../models';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';
import {Channel} from '../../models/channel.model';
import {Subscription} from 'rxjs';

import mpegts from 'mpegts.js/dist/mpegts.js';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule, NavbarComponent],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @Input() streamUrl: string = '';
  @Input() eventTitle: string = 'Reproducción en vivo';
  @Input() channel: Channel | null = null;

  private player: any;
  private shouldInitializePlayer = false;
  private dataService = inject(DataService);
  private playerState = inject(PlayerStateService);
  private cdr = inject(ChangeDetectorRef);
  private castSubscription?: Subscription;
  private router = inject(Router);

  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;

  eventData?: Events;
  currentOriginalUrl: string = '';
  isChannelMode = false;

  // Datos para navegación de canales
  allChannels: Channel[] = [];
  currentChannelIndex: number = -1;
  isFullscreen = false;

  // Overlay de cambio de canal
  showChannelOverlay = false;
  private hideChannelOverlayTimeout?: number;

  // Touch gestures para móvil
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

    // Si salimos de fullscreen, desbloqueamos la orientación y mostramos navbar
    if (!this.isFullscreen) {
      this.unlockOrientation();
      this.showNavbar();
      // Resetear estilos al salir de fullscreen
      const video = this.videoElement?.nativeElement;
      if(video) {
        video.style.width = '';
        video.style.height = '';
        video.style.objectFit = '';
      }
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

      const savedChannel = this.playerState.getChannel();
      const savedEvent = this.playerState.getEvent();

      if (savedChannel && slugify(savedChannel.nombre) === slug) {
        this.channel = savedChannel;
        this.isChannelMode = true;
        this.eventTitle = savedChannel.nombre;
        this.updateCurrentChannelIndex();
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

  private loadAllChannels(): void {
    this.dataService.getChannels().subscribe({
      next: (data: any) => {
        if (data?.items) {
          const channels = Object.values(data.items) as Channel[];
          this.allChannels = channels.sort((a, b) => a.numero - b.numero);
          this.updateCurrentChannelIndex();
          console.log('📺 Canales ordenados por número:', this.allChannels.length);
        }
      },
      error: (error) => console.error('Error cargando canales:', error)
    });
  }

  private updateCurrentChannelIndex(): void {
    if (this.channel && this.allChannels.length > 0) {
      this.currentChannelIndex = this.allChannels.findIndex(
        c => c.numero === this.channel!.numero
      );
    }
  }

  nextChannel(): void {
    if (!this.isChannelMode || this.allChannels.length === 0) return;
    const currentIndex = this.allChannels.findIndex(c => c.numero === this.channel!.numero);
    if (currentIndex === -1 || currentIndex >= this.allChannels.length - 1) return;
    const nextChannel = this.allChannels[currentIndex + 1];
    this.navigateToChannel(nextChannel);
  }

  previousChannel(): void {
    if (!this.isChannelMode || this.allChannels.length === 0) return;
    const currentIndex = this.allChannels.findIndex(c => c.numero === this.channel!.numero);
    if (currentIndex <= 0) return;
    const prevChannel = this.allChannels[currentIndex - 1];
    this.navigateToChannel(prevChannel);
  }

  private navigateToChannel(channel: Channel): void {
    this.channel = channel;
    this.eventTitle = channel.nombre;
    this.currentChannelIndex = this.allChannels.findIndex(c => c.numero === channel.numero);
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
    if (!this.isChannelMode || this.allChannels.length === 0 || !this.channel) return false;
    const currentIndex = this.allChannels.findIndex(c => c.numero === this.channel!.numero);
    return currentIndex > 0;
  }

  get hasNextChannel(): boolean {
    if (!this.isChannelMode || this.allChannels.length === 0 || !this.channel) return false;
    const currentIndex = this.allChannels.findIndex(c => c.numero === this.channel!.numero);
    return currentIndex !== -1 && currentIndex < this.allChannels.length - 1;
  }

  private loadFromBackend(slug: string) {
    this.dataService.getChannels().subscribe({
      next: (data) => {
        if (data?.items) {
          const channels = Object.values(data.items) as Channel[];
          const foundChannel = channels.find((c: Channel) =>
            slugify(c.nombre) === slug
          );

          if (foundChannel) {
            this.channel = foundChannel;
            this.isChannelMode = true;
            this.eventTitle = foundChannel.nombre;
            this.playerState.setChannel(foundChannel);
            this.updateCurrentChannelIndex();
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
    if (!this.channel?.url) return;

    const finalUrl = this.getProxiedUrl(this.channel.url, true);
    this.streamUrl = finalUrl;
    this.currentOriginalUrl = finalUrl;
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
    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout);
    }
    if (this.hideChannelOverlayTimeout) {
      clearTimeout(this.hideChannelOverlayTimeout);
    }
    if (this.castSubscription) {
      this.castSubscription.unsubscribe();
    }
    this.unlockOrientation();
    this.showNavbar();
  }

  // =========================
  // HELPERS
  // =========================

  private normalizeUrlForComparison(url: string): string {
    if (!url) return '';
    let clean = url.replace('iptv.walerike.com/stream-proxy/', '');
    clean = clean.replace(/^https?:\/\//, '');
    return clean;
  }

  private isAcestreamLink(url: string): boolean {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('ace') || lowerUrl.includes('line.ultra-8k.xyz');
  }

  private getProxiedUrl(url: string, forceProxy: boolean = false): string {
    if (!url) return '';
    if (forceProxy) return this.applyProxyTransform(url);
    if (this.isAcestreamLink(url)) return this.applyProxyTransform(url);
    return url;
  }

  private applyProxyTransform(url: string): string {
    const cleanUrl = url.replace(/^https?:\/\//, '');
    return `https://iptv.walerike.com/stream-proxy/${cleanUrl}`;
  }

  isStreamActive(url: string): boolean {
    return this.normalizeUrlForComparison(this.currentOriginalUrl) === this.normalizeUrlForComparison(url);
  }

  changeStream(url: string) {
    const finalUrl = this.getProxiedUrl(url, false);
    this.currentOriginalUrl = finalUrl;
    this.streamUrl = finalUrl;
    this.initializePlayer();
  }

  get availableStreams(): string[] {
    if (this.isChannelMode && this.channel?.url) {
      return [this.getProxiedUrl(this.channel.url, true)];
    }

    if (!this.isChannelMode && this.eventData?.enlaces) {
      const streams: string[] = [];

      this.eventData.enlaces.forEach(enlace => {
        if (enlace.calidades && Array.isArray(enlace.calidades)) {
          enlace.calidades.forEach(calidad => {
            if (calidad.m3u8) streams.push(this.getProxiedUrl(calidad.m3u8, false));
          });
        } else if ((enlace as any).m3u8) {
          const oldM3u8 = (enlace as any).m3u8;
          if (Array.isArray(oldM3u8)) {
            oldM3u8.forEach(u => streams.push(this.getProxiedUrl(u, false)));
          } else {
            streams.push(this.getProxiedUrl(oldM3u8, false));
          }
        }
      });

      return streams;
    }
    return [];
  }

  get streamSectionTitle(): string {
    if (this.isChannelMode && this.channel) {
      return this.channel.nombre;
    }

    if (!this.isChannelMode && this.eventData?.enlaces?.length) {
      const currentNormalized = this.normalizeUrlForComparison(this.currentOriginalUrl);

      for (const enlace of this.eventData.enlaces) {
        if (enlace.calidades) {
           const foundInCalidad = enlace.calidades.find(c => this.normalizeUrlForComparison(c.m3u8) === currentNormalized);
           if (foundInCalidad) return enlace.canal || 'Stream';
        }
        if ((enlace as any).m3u8) {
           const oldM3u8 = (enlace as any).m3u8;
           const oldLinks = Array.isArray(oldM3u8) ? oldM3u8 : [oldM3u8];
           if (oldLinks.some(l => this.normalizeUrlForComparison(l) === currentNormalized)) {
             return enlace.canal || 'Stream';
           }
        }
      }
      return this.eventData.enlaces[0].canal || 'Stream';
    }

    return 'Stream';
  }

  private loadStreamFromEvent() {
    if (!this.eventData?.enlaces || this.eventData.enlaces.length === 0) return;

    const firstLink = this.eventData.enlaces[0];

    if (firstLink.calidades && firstLink.calidades.length > 0) {
      const firstQualityUrl = firstLink.calidades[0].m3u8;
      if (firstQualityUrl) {
        const finalUrl = this.getProxiedUrl(firstQualityUrl, false);

        this.currentOriginalUrl = finalUrl;
        this.streamUrl = finalUrl;
        this.shouldInitializePlayer = true;
        this.cdr.detectChanges();

        if (this.videoElement) {
          this.initializePlayer();
        }
        return;
      }
    }

    const fallbackUrl = (firstLink as any).m3u8;
    if (fallbackUrl) {
        const urlToUse = Array.isArray(fallbackUrl) ? fallbackUrl[0] : fallbackUrl;
        const finalUrl = this.getProxiedUrl(urlToUse, false);

        this.currentOriginalUrl = finalUrl;
        this.streamUrl = finalUrl;
        this.shouldInitializePlayer = true;
        this.cdr.detectChanges();
        if (this.videoElement) {
          this.initializePlayer();
        }
    }
  }

  private initializePlayer() {
    const video = this.videoElement?.nativeElement;
    if (!video) return;

    const urlToUse = this.streamUrl;
    if (!urlToUse) return;

    if (this.player) {
      this.player.destroy();
      this.player = null;
    }

    if (mpegts.isSupported()) {
      this.player = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: urlToUse,
        enableWorker: true,
        liveBufferLatencyChasing: true,
        lazyLoad: false
      });

      this.player.attachMediaElement(video);
      this.player.load();

      video.muted = false;
      this.player.play().catch((error: any) => {
        console.log('Autoplay bloqueado, reintentando sin mutear:', error);
        setTimeout(() => {
          this.player!.play().catch(() => {
            console.log('Autoplay requiere interacción del usuario');
          });
        }, 100);
      });
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
    const video = this.videoElement.nativeElement;

    const isInFullscreen = doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement;

    if (!isInFullscreen) {
      this.hideNavbar();
      document.body.style.overflow = 'hidden';
      window.scrollTo(0, 0);

      if (elem.requestFullscreen) elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
      else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
      else if (elem.msRequestFullscreen) elem.msRequestFullscreen();

      // --- FORZAR ESTILOS YOUTUBE ---
      setTimeout(() => {
        video.style.width = 'auto';
        video.style.height = 'auto';
        video.style.objectFit = 'contain';
        video.style.maxWidth = '100%';
        video.style.maxHeight = '100%';
      }, 100);
      // ------------------------------

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
        .then(() => console.log('✅ Pantalla bloqueada en horizontal'))
        .catch((error: any) => console.log('⚠️ No se pudo bloquear orientación:', error));
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

  changeChannelStream(index: number) {
    if (!this.isChannelMode && this.eventData?.enlaces?.[index]) {
      const targetLink = this.eventData.enlaces[index];
      let newUrl = '';

      if (targetLink.calidades && targetLink.calidades.length > 0) {
        newUrl = targetLink.calidades[0].m3u8;
      } else if ((targetLink as any).m3u8) {
         const oldM3u8 = (targetLink as any).m3u8;
         newUrl = Array.isArray(oldM3u8) ? oldM3u8[0] : oldM3u8;
      }

      if (newUrl) {
        const finalUrl = this.getProxiedUrl(newUrl, false);
        this.streamUrl = finalUrl;
        this.currentOriginalUrl = finalUrl;
        this.initializePlayer();
      }
    }
  }
}
