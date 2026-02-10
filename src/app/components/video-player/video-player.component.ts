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
import {DataService, IptvChannel, IptvMovie, IptvSeries, PaginatedResponse} from '../../services/data.service';
import {Observable} from 'rxjs';
import {PlayerStateService, ContentType} from '../../services/player-state.service';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';


declare const mpegts: any;

interface StreamSource {
  name: string;
  url: string;
  logo?: string;
  group?: string;
}

type ContentItem = IptvChannel | IptvMovie | IptvSeries;

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

  // Content type and items
  contentType: ContentType = 'channels';
  allItems: ContentItem[] = [];
  currentItem: ContentItem | null = null;
  currentItemIndex: number = -1;

  isFullscreen = false;

  showChannelOverlay = false;
  private hideChannelOverlayTimeout?: number;

  availableStreams: StreamSource[] = [];

  private touchStartX = 0;
  private touchStartY = 0;
  private touchEndX = 0;
  private touchEndY = 0;

  private itemsLoaded = false;
  private boundKeyboardHandler: ((event: KeyboardEvent) => void) | null = null;

  private readonly BATCH_SIZE = 100;
  private readonly PRELOAD_THRESHOLD = 20;
  private currentPage = 1;
  private totalItems = 0;
  private isLoadingMore = false;

  constructor(private route: ActivatedRoute) {
    this.volume = this.playerState.getVolume();
    this.isMuted = this.playerState.isMuted();
  }

  @HostListener('document:keydown', ['$event'])
  async handleKeyboardEvent(event: KeyboardEvent): Promise<void> {
    if (!this.isChannelMode || this.allItems.length < 2) return;

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
        await this.nextItem();
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'Left':
      case 'Down':
        event.preventDefault();
        event.stopPropagation();
        await this.previousItem();
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
    if (!this.isChannelMode || this.allItems.length < 2) return;

    this.touchStartX = event.changedTouches[0].screenX;
    this.touchStartY = event.changedTouches[0].screenY;
  }

  async onTouchEnd(event: TouchEvent): Promise<void> {
    if (!this.isChannelMode || this.allItems.length < 2) return;

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
        await this.previousItem();
      } else {
        await this.nextItem();
      }
    }
  }

  ngOnInit() {
    // Get content type from player state
    this.contentType = this.playerState.getContentType();

    this.route.paramMap.subscribe(async params => {
      const slug = params.get('title');
      if (!slug) return;

      // Check if there's a saved item in state
      const savedItem = this.playerState.getCurrentItem();

      if (savedItem && slugify(savedItem.nombre) === slug) {
        await this.setCurrentItem(savedItem);
        return;
      }

      await this.findItemBySlug(slug);
    });
  }

  private async findItemBySlug(slug: string): Promise<void> {
    if (!this.itemsLoaded) {
      setTimeout(() => this.findItemBySlug(slug), 200);
      return;
    }

    let foundItem = this.allItems.find(c => slugify(c.nombre) === slug);

    if (!foundItem) {
      foundItem = this.allItems.find(c =>
        slugify(c.nombre).includes(slug) || slug.includes(slugify(c.nombre))
      );
    }

    if (foundItem) {
      await this.setCurrentItem(foundItem);
    } else {
      console.warn('Item no encontrado:', slug);
    }
  }

  private async setCurrentItem(item: ContentItem): Promise<void> {
    this.currentItem = item;
    this.isChannelMode = true;
    this.eventTitle = item.nombre;

    // Update state based on content type
    if (this.contentType === 'channels') {
      this.playerState.setChannel(item as IptvChannel);
    } else if (this.contentType === 'movies') {
      this.playerState.setMovie(item as IptvMovie);
    } else if (this.contentType === 'series') {
      this.playerState.setSeries(item as IptvSeries);
    }

    // Load initial items if not loaded
    if (!this.itemsLoaded) {
      await this.loadInitialItems();
    }

    // Ensure item is loaded
    await this.ensureItemIsLoaded(item);

    this.loadStreamFromItem();

    if (this.itemsLoaded) {
      this.updateCurrentItemIndex();
    }
  }

  private async ensureItemIsLoaded(item: ContentItem): Promise<void> {
    const itemNum = item.num || 0;

    // Check if item is already loaded
    const isLoaded = this.allItems.some(i => i.id === item.id);

    if (isLoaded) {
      console.log('Item ya cargado:', itemNum);
      return;
    }

    // Calculate which page should contain this item
    const estimatedPage = Math.ceil(itemNum / this.BATCH_SIZE);

    console.log(`Item ${itemNum} no está cargado. Cargando página ${estimatedPage}...`);

    await this.loadSpecificPage(estimatedPage);

    // Verify again after loading
    const isNowLoaded = this.allItems.some(i => i.id === item.id);

    if (!isNowLoaded) {
      console.warn(`Item ${itemNum} no encontrado en página ${estimatedPage}. Buscando en páginas cercanas...`);
      for (let page = Math.max(1, estimatedPage - 2); page <= estimatedPage + 2; page++) {
        if (page === estimatedPage) continue;
        await this.loadSpecificPage(page);
        if (this.allItems.some(i => i.id === item.id)) {
          console.log(`Item ${itemNum} encontrado en página ${page}`);
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

      const loadObservable = this.getLoadObservable(page);

      loadObservable.subscribe({
        next: (response: any) => {
          const newItems = response.items.filter(
            (newItem: ContentItem) => !this.allItems.some(existing => existing.id === newItem.id)
          );
          newItems.sort((a: ContentItem, b: ContentItem) => (a.num || 0) - (b.num || 0));

          this.allItems = [...this.allItems, ...newItems];
          this.allItems.sort((a, b) => (a.num || 0) - (b.num || 0));

          this.currentPage = page;
          this.totalItems = response.total;
          this.isLoadingMore = false;
          this.itemsLoaded = true;

          console.log(`Página ${page} cargada. Total items en memoria: ${this.allItems.length}`);
          resolve();
        },
        error: (error: any) => {
          console.error(`Error cargando página ${page}:`, error);
          this.isLoadingMore = false;
          this.itemsLoaded = true;
          resolve();
        }
      });
    });
  }

  private getLoadObservable(page: number): Observable<PaginatedResponse<ContentItem>> {
    switch (this.contentType) {
      case 'movies':
        return this.dataService.getMovies(page, this.BATCH_SIZE) as Observable<PaginatedResponse<ContentItem>>;
      case 'series':
        return this.dataService.getSeries(page, this.BATCH_SIZE) as Observable<PaginatedResponse<ContentItem>>;
      case 'channels':
      default:
        return this.dataService.getChannels(page, this.BATCH_SIZE) as Observable<PaginatedResponse<ContentItem>>;
    }
  }

  private async loadInitialItems(): Promise<void> {
    return new Promise((resolve) => {
      const loadObservable = this.getLoadObservable(1);

      loadObservable.subscribe({
        next: (response: any) => {
          this.allItems = response.items;
          this.totalItems = response.total;
          this.currentPage = 1;
          this.itemsLoaded = true;
          this.allItems.sort((a, b) => (a.num || 0) - (b.num || 0));

          if (this.currentItem) {
            this.updateCurrentItemIndex();
          }
          resolve();
        },
        error: (error: any) => {
          console.error('Error cargando items:', error);
          this.itemsLoaded = true;
          resolve();
        }
      });
    });
  }

  private updateCurrentItemIndex(): void {
    if (!this.currentItem) return;
    this.allItems.sort((a, b) => (a.num || 0) - (b.num || 0));
    this.currentItemIndex = this.allItems.findIndex(
      i => i.id === this.currentItem!.id
    );
  }

  async nextItem(): Promise<void> {
    if (this.allItems.length === 0 || !this.currentItem) return;

    const currentNum = this.currentItem.num || 0;
    const targetNum = currentNum + 1;

    // Find if next item is already loaded
    let nextItem = this.allItems.find(i => i.num === targetNum);

    // If not loaded and few items remaining at the end, load more
    const maxLoadedNum = Math.max(...this.allItems.map(i => i.num || 0));
    const remainingItems = maxLoadedNum - currentNum;

    if (!nextItem && remainingItems < this.PRELOAD_THRESHOLD) {
      await this.loadMoreItemsIfNeeded('next');
      nextItem = this.allItems.find(i => i.num === targetNum);
    }

    // If still not found, find the closest higher number item
    if (!nextItem) {
      const candidates = this.allItems.filter(i => (i.num || 0) > currentNum);
      if (candidates.length > 0) {
        nextItem = candidates.sort((a, b) => (a.num || 0) - (b.num || 0))[0];
      }
    }

    if (nextItem) {
      this.navigateToItem(nextItem);
    } else if (this.allItems.length > 0) {
      // If no next, go to first (circular)
      const firstItem = this.allItems.sort((a, b) => (a.num || 0) - (b.num || 0))[0];
      this.navigateToItem(firstItem);
    }
  }

  async previousItem(): Promise<void> {
    if (this.allItems.length === 0 || !this.currentItem) return;

    const currentNum = this.currentItem.num || 0;
    const targetNum = currentNum - 1;

    // Find if previous item is already loaded
    let prevItem = this.allItems.find(i => i.num === targetNum);

    // If not loaded and few items remaining at the start, load more
    const minLoadedNum = Math.min(...this.allItems.map(i => i.num || 0));
    const remainingItems = currentNum - minLoadedNum;

    if (!prevItem && remainingItems < this.PRELOAD_THRESHOLD) {
      await this.loadMoreItemsIfNeeded('prev');
      prevItem = this.allItems.find(i => i.num === targetNum);
    }

    // If still not found, find the closest lower number item
    if (!prevItem) {
      const candidates = this.allItems.filter(i => (i.num || 0) < currentNum);
      if (candidates.length > 0) {
        prevItem = candidates.sort((a, b) => (b.num || 0) - (a.num || 0))[0];
      }
    }

    if (prevItem) {
      this.navigateToItem(prevItem);
    } else if (this.allItems.length > 0) {
      // If no previous, go to last (circular)
      const lastItem = this.allItems.sort((a, b) => (b.num || 0) - (a.num || 0))[0];
      this.navigateToItem(lastItem);
    }
  }

  private loadMoreItemsIfNeeded(direction: 'next' | 'prev'): Promise<void> {
    return new Promise((resolve) => {
      if (this.isLoadingMore) {
        resolve();
        return;
      }

      if (direction === 'next') {
        if (this.currentPage * this.BATCH_SIZE >= this.totalItems) {
          resolve();
          return;
        }

        this.isLoadingMore = true;
        const nextPage = this.currentPage + 1;

        const loadObservable = this.getLoadObservable(nextPage);

        loadObservable.subscribe({
          next: (response: any) => {
            const newItems = response.items.filter(
              (newItem: ContentItem) => !this.allItems.some(existing => existing.id === newItem.id)
            );
            newItems.sort((a: ContentItem, b: ContentItem) => (a.num || 0) - (b.num || 0));

            this.allItems = [...this.allItems, ...newItems];
            this.currentPage = nextPage;
            this.isLoadingMore = false;

            resolve();
          },
          error: (error: any) => {
            console.error('Error cargando más items:', error);
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

        const loadObservable = this.getLoadObservable(prevPage);

        loadObservable.subscribe({
          next: (response: any) => {
            const newItems = response.items.filter(
              (newItem: ContentItem) => !this.allItems.some(existing => existing.id === newItem.id)
            );
            newItems.sort((a: ContentItem, b: ContentItem) => (a.num || 0) - (b.num || 0));

            this.allItems = [...newItems, ...this.allItems];
            this.currentPage = prevPage;
            this.isLoadingMore = false;

            resolve();
          },
          error: (error: any) => {
            console.error('Error cargando items anteriores:', error);
            this.isLoadingMore = false;
            resolve();
          }
        });
      }
    });
  }

  private navigateToItem(item: ContentItem): void {
    if (!item) return;

    this.currentItem = item;
    this.eventTitle = item.nombre;
    this.currentItemIndex = this.allItems.findIndex(i => i.id === item.id);

    // Update state based on content type
    if (this.contentType === 'channels') {
      this.playerState.setChannel(item as IptvChannel);
    } else if (this.contentType === 'movies') {
      this.playerState.setMovie(item as IptvMovie);
    } else if (this.contentType === 'series') {
      this.playerState.setSeries(item as IptvSeries);
    }

    const slug = slugify(item.nombre);
    this.router.navigate(['/player', slug], { replaceUrl: true });

    this.showChannelOverlay = true;
    if (this.hideChannelOverlayTimeout) {
      clearTimeout(this.hideChannelOverlayTimeout);
    }
    this.hideChannelOverlayTimeout = window.setTimeout(() => {
      this.showChannelOverlay = false;
      this.cdr.markForCheck();
    }, 3000);

    this.loadStreamFromItem();
  }

  get hasPreviousItem(): boolean {
    return this.isChannelMode && this.allItems.length > 1;
  }

  get hasNextItem(): boolean {
    return this.isChannelMode && this.allItems.length > 1;
  }

  private loadStreamFromItem(): void {
    if (!this.currentItem?.id) {
      console.error('No hay item seleccionado');
      return;
    }

    const username = localStorage.getItem('iptv_username') || '';
    const password = localStorage.getItem('iptv_password') || '';

    if (!username || !password) {
      console.error('No hay credenciales guardadas');
      return;
    }

    const item = this.currentItem as any;
    const originalUrl = item.url || item.stream_url || '';

    if (!originalUrl) {
      console.error('No hay URL original para el item:', this.currentItem);
      return;
    }

    console.log('Item raw:', this.currentItem);
    console.log('URL original:', originalUrl);

    this.streamUrl = this.buildStreamUrl(originalUrl, username, password);
    console.log('Stream URL generado:', this.streamUrl);

    this.currentOriginalUrl = this.streamUrl;
    this.availableStreams = [{
      name: item.nombre,
      url: this.streamUrl,
      logo: item.logo,
      group: item.grupo
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

    let baseUrl = 'https://iptv.walerike.com';

    // Add path based on content type
    switch (this.contentType) {
      case 'movies':
        baseUrl += '/movie';
        break;
      case 'series':
        baseUrl += '/series';
        break;
      case 'channels':
      default:
        // Channels use base URL without additional path
        break;
    }

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
    console.log('Tipo de contenido:', this.contentType);

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
    const isChannel = this.contentType === 'channels';

    console.log('Tipo de stream:', { isHLS, isMP4, isMKV, isChannel, contentType: this.contentType });

    const checkLibs = () => {
      const Hls = (window as any).Hls;
      const mpegtsLib = (window as any).mpegts;
      return { Hls, mpegts: mpegtsLib };
    };

    const libs = checkLibs();

    // Canales usan MPEG-TS (transport stream)
    if (isChannel && !isHLS && !isMP4 && !isMKV && libs.mpegts && libs.mpegts.isSupported()) {
      console.log('Usando MPEG-TS player para canal');
      this.initMpegtsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    } 
    // Películas y series usan HLS siempre
    else if (!isChannel && libs.Hls && libs.Hls.isSupported()) {
      console.log('Usando HLS player para pelicula/serie');
      this.initHlsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    // Fallback para HLS
    else if (isHLS && libs.Hls && libs.Hls.isSupported()) {
      console.log('Usando HLS player');
      this.initHlsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    } 
    // Video nativo para MP4/MKV
    else if ((isMP4 || isMKV) && (video.canPlayType('video/mp4') || video.canPlayType('video/webm'))) {
      console.log('Usando HTML5 video nativo');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    } 
    // HLS nativo del navegador
    else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('Usando HLS nativo');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    } 
    // Fallback final
    else {
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
