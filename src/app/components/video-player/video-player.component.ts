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

  // === VOD Progress Bar State ===
  currentTime = 0;
  duration = 0;
  buffered = 0;
  isSeeking = false;
  seekTooltipTime = 0;
  seekTooltipVisible = false;
  seekTooltipX = 0;
  private progressListenersAttached = false;
  private boundTimeUpdateHandler?: () => void;
  private boundProgressHandler?: () => void;
  private boundLoadedMetadataHandler?: () => void;
  private boundSeekedHandler?: () => void;
  private boundSeekingHandler?: () => void;
  @ViewChild('seekBar') seekBarElement!: ElementRef<HTMLDivElement>;

  private readonly BATCH_SIZE = 100;
  private readonly PRELOAD_THRESHOLD = 20;
  private currentPage = 1;
  private totalItems = 0;
  private isLoadingMore = false;

  private retryCount = 0;
  private readonly MAX_RETRIES = 5;
  private retryTimeout?: number;

  constructor(private route: ActivatedRoute) {
    this.volume = this.playerState.getVolume();
    this.isMuted = this.playerState.isMuted();
  }

  @HostListener('document:keydown', ['$event'])
  async handleKeyboardEvent(event: KeyboardEvent): Promise<void> {
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    // VOD Seeking: ArrowLeft/ArrowRight seek in movie/series
    if (this.isVodContent) {
      switch (event.key) {
        case 'ArrowLeft':
        case 'Left':
          event.preventDefault();
          event.stopPropagation();
          this.skipBackward(5);
          return;
        case 'ArrowRight':
        case 'Right':
          event.preventDefault();
          event.stopPropagation();
          this.skipForward(5);
          return;
      }
    }

    // Channel Navigation: only for channels
    if (!this.isChannelMode || this.allItems.length < 2) return;

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
    if (!this.isChannelMode || this.allItems.length < 2 || this.isMovieContent) return;

    this.touchStartX = event.changedTouches[0].screenX;
    this.touchStartY = event.changedTouches[0].screenY;
  }

  async onTouchEnd(event: TouchEvent): Promise<void> {
    if (!this.isChannelMode || this.allItems.length < 2 || this.isMovieContent) return;

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
    if (this.allItems.length === 0 || !this.currentItem || this.isMovieContent) return;

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
    if (this.allItems.length === 0 || !this.currentItem || this.isMovieContent) return;

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
    return this.isChannelMode && this.allItems.length > 1 && !this.isMovieContent;
  }

  get hasNextItem(): boolean {
    return this.isChannelMode && this.allItems.length > 1 && !this.isMovieContent;
  }

  get isMovieContent(): boolean {
    return this.contentType === 'movies';
  }

  // === VOD Content Check ===
  get isVodContent(): boolean {
    return this.contentType === 'movies' || this.contentType === 'series';
  }

  // === Time Formatting Utility ===
  formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // === Seek Bar Interaction Methods ===
  onSeekBarClick(event: MouseEvent): void {
    if (!this.isVodContent || !this.videoElement?.nativeElement) return;
    
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const time = percent * this.duration;
    
    this.videoElement.nativeElement.currentTime = time;
    this.currentTime = time;
    this.cdr.markForCheck();
  }

  onSeekBarMouseDown(event: MouseEvent): void {
    if (!this.isVodContent) return;
    
    this.isSeeking = true;
    this.onSeekBarClick(event);
    
    const moveHandler = (e: MouseEvent) => {
      if (!this.seekBarElement?.nativeElement) return;
      const rect = this.seekBarElement.nativeElement.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = percent * this.duration;
      this.videoElement.nativeElement.currentTime = time;
      this.currentTime = time;
      this.cdr.markForCheck();
    };
    
    const upHandler = () => {
      this.isSeeking = false;
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };
    
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
    event.stopPropagation();
  }

  onSeekBarTouchStart(event: TouchEvent): void {
    if (!this.isVodContent) return;
    
    this.isSeeking = true;
    const touch = event.touches[0];
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const percent = (touch.clientX - rect.left) / rect.width;
    const time = Math.max(0, Math.min(this.duration, percent * this.duration));
    
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.currentTime = time;
      this.currentTime = time;
    }
    this.cdr.markForCheck();
    event.stopPropagation();
  }

  onSeekBarTouchMove(event: TouchEvent): void {
    if (!this.isVodContent || !this.isSeeking || !this.seekBarElement?.nativeElement) return;
    
    event.preventDefault();
    const touch = event.touches[0];
    const rect = this.seekBarElement.nativeElement.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const time = percent * this.duration;
    
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.currentTime = time;
      this.currentTime = time;
    }
    this.cdr.markForCheck();
  }

  onSeekBarTouchEnd(): void {
    this.isSeeking = false;
  }

  onSeekBarMouseMove(event: MouseEvent): void {
    if (!this.isVodContent) return;
    
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const clampedPercent = Math.max(0, Math.min(1, percent));
    
    this.seekTooltipTime = clampedPercent * this.duration;
    this.seekTooltipX = clampedPercent * 100;
    this.seekTooltipVisible = true;
    this.cdr.markForCheck();
  }

  onSeekBarMouseLeave(): void {
    this.seekTooltipVisible = false;
    this.cdr.markForCheck();
  }

  // === Skip Methods ===
  skipForward(seconds: number = 10): void {
    if (!this.isVodContent || !this.videoElement?.nativeElement) return;
    
    const newTime = Math.min(this.duration, this.currentTime + seconds);
    this.videoElement.nativeElement.currentTime = newTime;
    this.currentTime = newTime;
    this.cdr.markForCheck();
  }

  skipBackward(seconds: number = 10): void {
    if (!this.isVodContent || !this.videoElement?.nativeElement) return;
    
    const newTime = Math.max(0, this.currentTime - seconds);
    this.videoElement.nativeElement.currentTime = newTime;
    this.currentTime = newTime;
    this.cdr.markForCheck();
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

    // Extract the file extension from the original URL
    const extMatch = lastPart.match(/\.(ts|m3u8|mp4|mkv|avi)$/i);
    const extension = extMatch ? extMatch[0] : '';
    const streamId = lastPart.replace(/\.(ts|m3u8|mp4|mkv|avi)$/i, '');

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

    // For movies/series, preserve the original extension so the server
    // returns the correct format. Without it, the server may return raw
    // binary that HLS.js can't parse, crashing the browser.
    if (this.contentType !== 'channels' && extension) {
      return `${baseUrl}/${username}/${password}/${streamId}${extension}`;
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
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
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

    // Cleanup VOD progress listeners
    if (this.boundTimeUpdateHandler || this.boundProgressHandler || 
        this.boundLoadedMetadataHandler || this.boundSeekedHandler || this.boundSeekingHandler) {
      const video = this.videoElement?.nativeElement;
      if (video) {
        if (this.boundTimeUpdateHandler) {
          video.removeEventListener('timeupdate', this.boundTimeUpdateHandler);
        }
        if (this.boundProgressHandler) {
          video.removeEventListener('progress', this.boundProgressHandler);
        }
        if (this.boundLoadedMetadataHandler) {
          video.removeEventListener('loadedmetadata', this.boundLoadedMetadataHandler);
        }
        if (this.boundSeekedHandler) {
          video.removeEventListener('seeked', this.boundSeekedHandler);
        }
        if (this.boundSeekingHandler) {
          video.removeEventListener('seeking', this.boundSeekingHandler);
        }
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

    // 1. Canales sin extension explicita -> MPEG-TS (transport stream)
    if (isChannel && !isHLS && !isMP4 && !isMKV && libs.mpegts && libs.mpegts.isSupported()) {
      console.log('Usando MPEG-TS player para canal');
      this.initMpegtsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    // 2. URLs con .m3u8 (HLS) -> HLS.js
    else if (isHLS && libs.Hls && libs.Hls.isSupported()) {
      console.log('Usando HLS player para stream .m3u8');
      this.initHlsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    // 3. URLs con .m3u8 (HLS) -> HLS nativo del navegador (Safari)
    else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('Usando HLS nativo del navegador');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    }
    // 4. MP4/MKV o peliculas/series sin extension HLS -> HTML5 video nativo
    //    Esto es lo correcto: el navegador descarga progresivamente y reproduce
    //    sin cargar todo en memoria como hacia HLS.js con archivos no-HLS.
    else if (isMP4 || isMKV || !isChannel) {
      console.log('Usando HTML5 video nativo para', this.contentType);
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    }
    // 5. Fallback final
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
    const isLiveContent = this.contentType === 'channels';

    const hlsConfig: Record<string, unknown> = {
      enableWorker: true,
      // lowLatencyMode solo para contenido en vivo, no para VOD (peliculas/series)
      lowLatencyMode: isLiveContent,
      backBufferLength: isLiveContent ? 90 : 30,
      // Para VOD: permitir buffering mas agresivo para evitar stuttering
      maxBufferLength: isLiveContent ? 30 : 60,
      maxMaxBufferLength: isLiveContent ? 60 : 120,
      xhrSetup: (xhr: XMLHttpRequest, _url: string) => {
        if (this.retryCount > 0) {
          console.log(`Reintento ${this.retryCount} con timestamp para evitar caché`);
        }
      }
    };

    this.hlsPlayer = new Hls(hlsConfig);

    this.hlsPlayer.loadSource(url);
    this.hlsPlayer.attachMedia(video);

    this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('HLS Manifest parsed successfully');
      video.volume = volume;
      video.muted = wasMuted;
      this.playVideo(video, autoplay, wasMuted, volume);
      // Resetear contador si carga correctamente
      if (this.retryCount > 0) {
        console.log('✅ Stream HLS cargado correctamente, reseteando contador');
        this.retryCount = 0;
      }
    });

    this.hlsPlayer.on(Hls.Events.ERROR, (event: any, data: any) => {
      console.error('HLS Error completo:', {
        event,
        data,
        retryCount: this.retryCount,
        type: data?.type,
        details: data?.details,
        fatal: data?.fatal,
        response: data?.response,
        networkDetails: data?.networkDetails
      });

      // Detectar error 511 o errores de red que puedan ser 511
      const isAuthError = data?.response?.code === 511 ||
                          data?.networkDetails?.status === 511 ||
                          data?.response?.statusCode === 511 ||
                          (data?.type === 'networkError' && data?.response?.code >= 500);

      if (isAuthError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        console.warn(`⚠️ Error ${data?.response?.code || 511} detectado en HLS. Reintento ${this.retryCount}/${this.MAX_RETRIES}`);

        // Destruir player actual
        if (this.hlsPlayer) {
          this.hlsPlayer.destroy();
          this.hlsPlayer = null;
        }

        // Limpiar timeout anterior si existe
        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        // Reintentar después de 2 segundos
        this.retryTimeout = window.setTimeout(() => {
          console.log('🔄 Reintentando carga del stream HLS...');
          this.reloadStream();
        }, 2000);
      } else if (data.fatal) {
        console.error('Error fatal en HLS:', data.type);
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('Intentando recuperar de error de red...');
            if (this.hlsPlayer && this.retryCount < this.MAX_RETRIES) {
              this.retryCount++;
              setTimeout(() => {
                this.hlsPlayer?.startLoad();
              }, 1000);
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('Intentando recuperar de error de media...');
            this.hlsPlayer?.recoverMediaError();
            break;
          default:
            if (this.hlsPlayer) {
              this.hlsPlayer.destroy();
              this.hlsPlayer = null;
            }
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
      console.error('MPEG-TS Error completo:', {
        type,
        detail,
        retryCount: this.retryCount,
        code: detail?.code,
        msg: detail?.msg
      });

      // Detectar error 511 u otros errores HTTP
    const isAuthError = type === 'NetworkError' ||
                    type === 'HttpStatusCodeInvalid' ||
                    detail === 'HttpStatusCodeInvalid' ||
                    String(detail).includes('HttpStatusCodeInvalid') ||
                    String(type).includes('NetworkError');

      if (isAuthError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        console.warn(`⚠️ Error ${detail?.code || 511} detectado en MPEG-TS. Reintento ${this.retryCount}/${this.MAX_RETRIES}`);

        // Destruir player actual
        if (this.player) {
          this.player.destroy();
          this.player = null;
        }

        // Limpiar timeout anterior si existe
        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        // Reintentar después de 2 segundos
        this.retryTimeout = window.setTimeout(() => {
          console.log('🔄 Reintentando carga del stream MPEG-TS...');
          this.reloadStream();
        }, 2000);
      } else if (this.retryCount >= this.MAX_RETRIES) {
        console.error('❌ Máximo número de reintentos alcanzado');
      }
    });

    this.player.on(mpegts.Events.LOADING_COMPLETE, () => {
      console.log('MPEG-TS loading complete');
      if (this.retryCount > 0) {
        console.log('✅ Stream MPEG-TS cargado correctamente, reseteando contador');
        this.retryCount = 0;
      }
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
      console.log('Video en espera...');
    });

    video.addEventListener('canplay', () => {
      // Resetear contador de reintentos cuando el video carga correctamente
      if (this.retryCount > 0) {
        console.log('✅ Video canplay, reseteando contador de reintentos');
        this.retryCount = 0;
      }
    });

    video.addEventListener('loadeddata', () => {
      // También resetear en loadeddata
      if (this.retryCount > 0) {
        console.log('✅ Video loadeddata, reseteando contador de reintentos');
        this.retryCount = 0;
      }
    });

    // === VOD Progress Bar Event Listeners ===
    if (this.isVodContent && !this.progressListenersAttached) {
      this.boundTimeUpdateHandler = () => {
        if (!this.isSeeking) {
          this.currentTime = video.currentTime;
          this.cdr.markForCheck();
        }
      };
      
      this.boundProgressHandler = () => {
        if (video.buffered.length > 0) {
          this.buffered = video.buffered.end(video.buffered.length - 1);
          this.cdr.markForCheck();
        }
      };
      
      this.boundLoadedMetadataHandler = () => {
        this.duration = video.duration;
        this.cdr.markForCheck();
      };
      
      this.boundSeekedHandler = () => {
        this.currentTime = video.currentTime;
        this.isSeeking = false;
        this.cdr.markForCheck();
      };
      
      this.boundSeekingHandler = () => {
        this.isSeeking = true;
        this.currentTime = video.currentTime;
        this.cdr.markForCheck();
      };

      video.addEventListener('timeupdate', this.boundTimeUpdateHandler);
      video.addEventListener('progress', this.boundProgressHandler);
      video.addEventListener('loadedmetadata', this.boundLoadedMetadataHandler);
      video.addEventListener('seeked', this.boundSeekedHandler);
      video.addEventListener('seeking', this.boundSeekingHandler);
      
      this.progressListenersAttached = true;
      
      // Initialize values if already available
      if (video.duration) {
        this.duration = video.duration;
      }
      if (video.currentTime) {
        this.currentTime = video.currentTime;
      }
      if (video.buffered.length > 0) {
        this.buffered = video.buffered.end(video.buffered.length - 1);
      }
      this.cdr.markForCheck();
    }

    video.addEventListener('error', (e) => {
      const errorCode = (video.error as MediaError | null)?.code;
      const errorMessage = video.error?.message;
      const networkState = video.networkState;

      console.error('Error en video element:', {
        code: errorCode,
        message: errorMessage,
        networkState: networkState,
        retryCount: this.retryCount,
        MEDIA_ERR_ABORTED: MediaError.MEDIA_ERR_ABORTED,
        MEDIA_ERR_NETWORK: MediaError.MEDIA_ERR_NETWORK,
        MEDIA_ERR_DECODE: MediaError.MEDIA_ERR_DECODE,
        MEDIA_ERR_SRC_NOT_SUPPORTED: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      });

      // Detectar error 511 o errores de red
      const isAuthError = errorCode === MediaError.MEDIA_ERR_NETWORK ||
                          networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
                          errorMessage?.includes('511');

      if (isAuthError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        console.warn(`⚠️ Error de red detectado en video element. Reintento ${this.retryCount}/${this.MAX_RETRIES}`);

        // Limpiar timeout anterior si existe
        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        // Reintentar después de 2 segundos
        this.retryTimeout = window.setTimeout(() => {
          console.log('🔄 Reintentando carga del stream desde video error...');
          this.reloadStream();
        }, 2000);
      } else if (this.retryCount >= this.MAX_RETRIES) {
        console.error('❌ Máximo número de reintentos alcanzado');
      }
    });
  }

  private reloadStream(): void {
    console.log('🔄 Iniciando recarga de stream...');

    if (!this.currentItem) {
      console.error('❌ No hay item actual para recargar');
      return;
    }

    const username = localStorage.getItem('iptv_username') || '';
    const password = localStorage.getItem('iptv_password') || '';

    if (!username || !password) {
      console.error('❌ No hay credenciales para recargar');
      return;
    }

    const item = this.currentItem as any;
    const originalUrl = item.url || item.stream_url || '';

    if (!originalUrl) {
      console.error('❌ No hay URL para recargar');
      return;
    }

    // Destruir players existentes
    if (this.player) {
      console.log('Destruyendo player MPEG-TS existente');
      try {
        this.player.destroy();
      } catch (e) {
        console.warn('Error al destruir player MPEG-TS:', e);
      }
      this.player = null;
    }

    if (this.hlsPlayer) {
      console.log('Destruyendo player HLS existente');
      try {
        this.hlsPlayer.destroy();
      } catch (e) {
        console.warn('Error al destruir player HLS:', e);
      }
      this.hlsPlayer = null;
    }

    // Limpiar el video element
    const video = this.videoElement?.nativeElement;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    // Reconstruir URL del stream
    this.streamUrl = this.buildStreamUrl(originalUrl, username, password);

    console.log(`✨ URL reconstruida (intento ${this.retryCount}):`, this.streamUrl);

    // Pequeña pausa antes de reinicializar
    setTimeout(() => {
      console.log('🎬 Reinicializando player...');
      this.initializePlayer(true);
    }, 500);
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
