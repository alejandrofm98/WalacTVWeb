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

  private channelsLoaded = false;
  private boundKeyboardHandler: ((event: KeyboardEvent) => void) | null = null;

  private readonly BATCH_SIZE = 100;
  private readonly PRELOAD_THRESHOLD = 20;
  private currentPage = 1;
  private totalChannels = 0;
  private isLoadingMore = false;

  constructor(private route: ActivatedRoute) {
    this.volume = this.playerState.getVolume();
    this.isMuted = this.playerState.isMuted();
  }

  @HostListener('document:keydown', ['$event'])
  async handleKeyboardEvent(event: KeyboardEvent): Promise<void> {
    if (!this.isChannelMode || this.allChannels.length < 2) return;

    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
      case 'Right':
      case 'Up':
        event.preventDefault();
        event.stopPropagation();
        await this.nextChannel();
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'Left':
      case 'Down':
        event.preventDefault();
        event.stopPropagation();
        await this.previousChannel();
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
  }

  onTouchStart(event: TouchEvent): void {
    if (!this.isChannelMode || this.allChannels.length < 2) return;

    this.touchStartX = event.changedTouches[0].screenX;
    this.touchStartY = event.changedTouches[0].screenY;
  }

  async onTouchEnd(event: TouchEvent): Promise<void> {
    if (!this.isChannelMode || this.allChannels.length < 2) return;

    this.touchEndX = event.changedTouches[0].screenX;
    this.touchEndY = event.changedTouches[0].screenY;
    await this.handleSwipeGesture();
  }

  private async handleSwipeGesture(): Promise<void> {
    const swipeThreshold = 50;
    const deltaX = this.touchEndX - this.touchStartX;
    const deltaY = Math.abs(this.touchEndY - this.touchStartY);

    if (Math.abs(deltaX) > swipeThreshold && deltaY < swipeThreshold) {
      if (deltaX > 0) {
        await this.previousChannel();
      } else {
        await this.nextChannel();
      }
    }
  }

  ngOnInit() {
    this.route.paramMap.subscribe(async params => {
      const slug = params.get('title');
      if (!slug) return;

      const savedChannel = this.playerState.getChannel() as IptvChannel | null;

      if (savedChannel && slugify(savedChannel.nombre) === slug) {
        await this.setChannel(savedChannel);
        return;
      }

      await this.findChannelBySlug(slug);
    });
  }

  private async findChannelBySlug(slug: string): Promise<void> {
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
      await this.setChannel(foundChannel);
    } else {
      console.warn('Canal no encontrado:', slug);
    }
  }

  private async setChannel(channel: IptvChannel): Promise<void> {
    this.currentChannel = channel;
    this.isChannelMode = true;
    this.eventTitle = channel.nombre;
    this.playerState.setChannel(channel);

    // Comprobar si el canal está en los canales cargados y cargar la página correspondiente si es necesario
    await this.ensureChannelIsLoaded(channel);

    this.loadStreamFromChannel();

    if (this.channelsLoaded) {
      this.updateCurrentChannelIndex();
    }
  }

  private async ensureChannelIsLoaded(channel: IptvChannel): Promise<void> {
    const channelNum = channel.num || 0;

    // Verificar si el canal ya está en allChannels
    const isLoaded = this.allChannels.some(c => c.id === channel.id);

    if (isLoaded) {
      console.log('Canal ya cargado:', channelNum);
      return;
    }

    // Calcular qué página debería contener este canal
    // La API ordena por num, así que podemos estimar la página
    const estimatedPage = Math.ceil(channelNum / this.BATCH_SIZE);

    console.log(`Canal ${channelNum} no está cargado. Cargando página ${estimatedPage}...`);

    await this.loadSpecificPage(estimatedPage);

    // Verificar nuevamente si el canal está cargado después de cargar la página
    const isNowLoaded = this.allChannels.some(c => c.id === channel.id);

    if (!isNowLoaded) {
      console.warn(`Canal ${channelNum} no encontrado en página ${estimatedPage}. Buscando en páginas cercanas...`);
      // Buscar en páginas cercanas
      for (let page = Math.max(1, estimatedPage - 2); page <= estimatedPage + 2; page++) {
        if (page === estimatedPage) continue;
        await this.loadSpecificPage(page);
        if (this.allChannels.some(c => c.id === channel.id)) {
          console.log(`Canal ${channelNum} encontrado en página ${page}`);
          break;
        }
      }
    }
  }

  private loadSpecificPage(page: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.isLoadingMore) {
        resolve();
        return;
      }

      this.isLoadingMore = true;

      this.dataService.getChannels(page, this.BATCH_SIZE).subscribe({
        next: (response) => {
          const newChannels = response.items.filter(
            newChannel => !this.allChannels.some(existing => existing.id === newChannel.id)
          );
          newChannels.sort((a, b) => (a.num || 0) - (b.num || 0));

          // Insertar los nuevos canales manteniendo el orden
          this.allChannels = [...this.allChannels, ...newChannels];
          this.allChannels.sort((a, b) => (a.num || 0) - (b.num || 0));

          this.currentPage = page;
          this.totalChannels = response.total;
          this.isLoadingMore = false;

          console.log(`Página ${page} cargada. Total canales en memoria: ${this.allChannels.length}`);
          resolve();
        },
        error: (error) => {
          console.error(`Error cargando página ${page}:`, error);
          this.isLoadingMore = false;
          resolve();
        }
      });
    });
  }

  private updateCurrentChannelIndex(): void {
    if (!this.currentChannel) return;
    this.allChannels.sort((a, b) => (a.num || 0) - (b.num || 0));
    this.currentChannelIndex = this.allChannels.findIndex(
      c => c.id === this.currentChannel!.id
    );
  }

  async nextChannel(): Promise<void> {
    if (this.allChannels.length === 0 || !this.currentChannel) return;

    const currentNum = this.currentChannel.num || 0;
    const targetNum = currentNum + 1;

    // Buscar si el siguiente canal ya está cargado
    let nextChannel = this.allChannels.find(c => c.num === targetNum);

    // Si no está y quedan pocos canales al final, cargar más
    const maxLoadedNum = Math.max(...this.allChannels.map(c => c.num || 0));
    const remainingChannels = maxLoadedNum - currentNum;

    if (!nextChannel && remainingChannels < this.PRELOAD_THRESHOLD) {
      await this.loadMoreChannelsIfNeeded('next');
      // Buscar de nuevo después de cargar
      nextChannel = this.allChannels.find(c => c.num === targetNum);
    }

    // Si aún no está, buscar el canal con el número más alto que sea mayor al actual
    if (!nextChannel) {
      const candidates = this.allChannels.filter(c => (c.num || 0) > currentNum);
      if (candidates.length > 0) {
        nextChannel = candidates.sort((a, b) => (a.num || 0) - (b.num || 0))[0];
      }
    }

    // Si hay siguiente canal, navegar a él
    if (nextChannel) {
      this.navigateToChannel(nextChannel);
    } else if (this.allChannels.length > 0) {
      // Si no hay siguiente, ir al primero (circular)
      const firstChannel = this.allChannels.sort((a, b) => (a.num || 0) - (b.num || 0))[0];
      this.navigateToChannel(firstChannel);
    }
  }

  async previousChannel(): Promise<void> {
    if (this.allChannels.length === 0 || !this.currentChannel) return;

    const currentNum = this.currentChannel.num || 0;
    const targetNum = currentNum - 1;

    // Buscar si el canal anterior ya está cargado
    let prevChannel = this.allChannels.find(c => c.num === targetNum);

    // Si no está y quedan pocos canales al inicio, cargar más
    const minLoadedNum = Math.min(...this.allChannels.map(c => c.num || 0));
    const remainingChannels = currentNum - minLoadedNum;

    if (remainingChannels < this.PRELOAD_THRESHOLD) {
      await this.loadMoreChannelsIfNeeded('prev');
      // Buscar de nuevo después de cargar
      prevChannel = this.allChannels.find(c => c.num === targetNum);
    }

    // Si aún no está, buscar el canal con el número más bajo que sea menor al actual
    if (!prevChannel) {
      const candidates = this.allChannels.filter(c => (c.num || 0) < currentNum);
      if (candidates.length > 0) {
        prevChannel = candidates.sort((a, b) => (b.num || 0) - (a.num || 0))[0];
      }
    }

    // Si hay canal anterior, navegar a él
    if (prevChannel) {
      this.navigateToChannel(prevChannel);
    } else if (this.allChannels.length > 0) {
      // Si no hay anterior, ir al último (circular)
      const lastChannel = this.allChannels.sort((a, b) => (b.num || 0) - (a.num || 0))[0];
      this.navigateToChannel(lastChannel);
    }
  }

  private loadMoreChannelsIfNeeded(direction: 'next' | 'prev'): Promise<void> {
    return new Promise((resolve) => {
      if (this.isLoadingMore) {
        resolve();
        return;
      }

      if (direction === 'next') {
        if (this.currentPage * this.BATCH_SIZE >= this.totalChannels) {
          resolve();
          return;
        }

        this.isLoadingMore = true;
        const nextPage = this.currentPage + 1;

        this.dataService.getChannels(nextPage, this.BATCH_SIZE).subscribe({
          next: (response) => {
            const newChannels = response.items.filter(
              newChannel => !this.allChannels.some(existing => existing.id === newChannel.id)
            );
            newChannels.sort((a, b) => (a.num || 0) - (b.num || 0));

            this.allChannels = [...this.allChannels, ...newChannels];
            this.currentPage = nextPage;
            this.isLoadingMore = false;

            resolve();
          },
          error: (error) => {
            console.error('Error cargando más canales:', error);
            this.isLoadingMore = false;
            resolve();
          }
        });
      } else {
        if (this.currentPage <= 1) {
          resolve();
          return;
        }

        this.isLoadingMore = true;
        const prevPage = this.currentPage - 1;

        this.dataService.getChannels(prevPage, this.BATCH_SIZE).subscribe({
          next: (response) => {
            const newChannels = response.items.filter(
              newChannel => !this.allChannels.some(existing => existing.id === newChannel.id)
            );
            newChannels.sort((a, b) => (a.num || 0) - (b.num || 0));

            this.allChannels = [...newChannels, ...this.allChannels];
            this.currentPage = prevPage;
            this.isLoadingMore = false;

            resolve();
          },
          error: (error) => {
            console.error('Error cargando canales anteriores:', error);
            this.isLoadingMore = false;
            resolve();
          }
        });
      }
    });
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
    if (!this.currentChannel?.id) {
      console.error('No hay canal seleccionado');
      return;
    }

    const username = localStorage.getItem('iptv_username') || '';
    const password = localStorage.getItem('iptv_password') || '';

    if (!username || !password) {
      console.error('No hay credenciales guardadas');
      return;
    }

    const originalUrl = this.currentChannel.url || this.currentChannel.stream_url || '';

    if (!originalUrl) {
      console.error('No hay URL original para el canal:', this.currentChannel);
      return;
    }

    console.log('Canal raw:', this.currentChannel);
    console.log('URL original:', originalUrl);

    this.streamUrl = this.buildStreamUrl(originalUrl, username, password);
    console.log('Stream URL generado:', this.streamUrl);

    this.currentOriginalUrl = this.streamUrl;
    this.availableStreams = [{
      name: this.currentChannel.nombre,
      url: this.streamUrl,
      logo: this.currentChannel.logo,
      group: this.currentChannel.grupo
    }];

    this.shouldInitializePlayer = true;
    this.isPlaying = true;

    if (this.videoElement) {
      setTimeout(() => this.initializePlayer(true), 0);
    }
  }

  private buildStreamUrl(originalUrl: string, username: string, password: string): string {
    if (!originalUrl) return '';

    const parts = originalUrl.split('/');
    const lastPart = parts[parts.length - 1];
    const streamId = lastPart.replace(/\.(ts|m3u8|mp4|mkv)$/i, '');

    const baseUrl = 'https://iptv.walerike.com/';
    return `${baseUrl}/${username}/${password}/${streamId}`;
  }

  ngAfterViewInit() {
    if (this.shouldInitializePlayer) {
      setTimeout(() => this.initializePlayer(true), 0);
    }

    setTimeout(() => {
      const volumeSlider = document.querySelector('.volume-control input[type="range"]') as HTMLInputElement;
      if (volumeSlider) {
        const percentage = (this.volume * 100);
        volumeSlider.style.setProperty('--value', percentage + '%');
      }
    }, 100);

    this.setupKeyboardListeners();
  }

  private setupKeyboardListeners(): void {
    this.boundKeyboardHandler = this.handleKeyboardEvent.bind(this);

    const video = this.videoElement?.nativeElement;
    if (video) {
      video.setAttribute('tabindex', '0');
      video.style.outline = 'none';
      video.addEventListener('keydown', this.boundKeyboardHandler);
      video.focus();
    }

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

    if (this.boundKeyboardHandler) {
      window.removeEventListener('keydown', this.boundKeyboardHandler);
      const video = this.videoElement?.nativeElement;
      if (video) {
        video.removeEventListener('keydown', this.boundKeyboardHandler);
      }
    }
  }

  private initializePlayer(autoplay: boolean) {
    const video = this.videoElement?.nativeElement;
    if (!video || !this.streamUrl) {
      console.error('Video element or stream URL not available');
      return;
    }

    console.log('Inicializando player con URL:', this.streamUrl);

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

    const urlLower = this.streamUrl.toLowerCase();
    const isHLS = urlLower.includes('.m3u8');
    const isMP4 = urlLower.includes('.mp4');
    const isMKV = urlLower.includes('.mkv');
    const isChannel = !isHLS && !isMP4 && !isMKV;

    console.log('Tipo de stream:', { isHLS, isMP4, isMKV, isChannel });

    const checkLibs = () => {
      const Hls = (window as any).Hls;
      const mpegtsLib = (window as any).mpegts;
      return { Hls, mpegts: mpegtsLib };
    };

    const libs = checkLibs();

    if (isHLS && libs.Hls && libs.Hls.isSupported()) {
      console.log('Usando HLS player');
      this.initHlsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    } else if (isChannel && libs.mpegts && libs.mpegts.isSupported()) {
      console.log('Usando MPEG-TS player');
      this.initMpegtsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    } else if ((isMP4 || isMKV) && (video.canPlayType('video/mp4') || video.canPlayType('video/webm'))) {
      console.log('Usando HTML5 video nativo');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('Usando HLS nativo');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    } else if (libs.mpegts && libs.mpegts.isSupported()) {
      console.log('Usando MPEG-TS fallback');
      this.initMpegtsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    } else {
      console.log('Usando HTML5 fallback');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    }

    this.setupVideoEventListeners(video);
  }

  private initHlsPlayer(video: HTMLVideoElement, url: string, autoplay: boolean, wasMuted: boolean, volume: number): void {
    const Hls = (window as any).Hls;

    this.hlsPlayer = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90
    });

    this.hlsPlayer.loadSource(url);
    this.hlsPlayer.attachMedia(video);

    this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      video.volume = volume;
      video.muted = wasMuted;
      this.playVideo(video, autoplay, wasMuted, volume);
    });

    this.hlsPlayer.on(Hls.Events.ERROR, (event: any, data: any) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            this.hlsPlayer?.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            this.hlsPlayer?.recoverMediaError();
            break;
          default:
            this.hlsPlayer?.destroy();
            this.hlsPlayer = null;
            break;
        }
      }
    });
  }

  private initMpegtsPlayer(video: HTMLVideoElement, url: string, autoplay: boolean, wasMuted: boolean, volume: number): void {
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
    });

    this.player.attachMediaElement(video);
    this.player.load();
    video.volume = volume;
    video.muted = wasMuted;
    this.playVideo(video, autoplay, wasMuted, volume);
  }

  private playVideo(video: HTMLVideoElement, autoplay: boolean, savedMuted: boolean, savedVolume: number): void {
    video.muted = savedMuted;
    video.volume = savedVolume;

    const playPromise = video.play();

    if (playPromise !== undefined) {
      playPromise.then(() => {
      }).catch((error) => {
        console.log('Reproducción bloqueada:', error);
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
    });

    video.addEventListener('canplay', () => {
    });

    video.addEventListener('error', (e) => {
      const mpegtsLib = (window as any).mpegts;

      if (!this.player && mpegtsLib?.isSupported()) {
        try {
          this.player = mpegtsLib.createPlayer({
            type: 'mpegts',
            isLive: true,
            url: this.streamUrl,
            enableWorker: true,
            liveBufferLatencyChasing: true,
            lazyLoad: false,
            enableStashBuffer: false,
            stashInitialSize: 128
          });
          this.player.on(mpegtsLib.Events.ERROR, (type: any, detail: any) => {
          });
          this.player.attachMediaElement(video);
          this.player.load();
        } catch (err) {
          console.error('Error iniciando mpegts.js:', err);
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
    event.target.style.setProperty('--value', percentage + '%');

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
        })
        .catch((error: any) => {
        });
    }
  }

  private unlockOrientation(): void {
    if (this.isOrientationLockSupported()) {
      (screen as any).orientation.unlock();
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
    this.initializePlayer(true);
  }
}
