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
import {ChannelResolved} from '../../models/calendar.model';


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
  private videoJsPlayer: any;
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

  // Quality switching for events
  eventChannels: ChannelResolved[] = [];
  selectedEventChannel: ChannelResolved | null = null;
  showQualitySelector = false;

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
  readonly MAX_RETRIES = 5;
  private retryTimeout?: number;

  // Estado de error - NUNCA oculta el video, solo muestra overlay
  hasError = false;
  errorMessage = '';
  private currentExtension = '';

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
    this.contentType = this.playerState.getContentType();
    this.eventChannels = this.playerState.getEventChannels();
    this.eventTitle = this.playerState.getEventTitle() || 'Reproducción en vivo';
    
    if (this.eventChannels.length > 0) {
      const priorityZero = this.eventChannels.find(c => c.priority === 0);
      this.selectedEventChannel = priorityZero || this.eventChannels[0];
      this.showQualitySelector = true;
    }

    this.route.paramMap.subscribe(async params => {
      const slug = params.get('title');
      if (!slug) return;

      const savedItem = this.playerState.getCurrentItem();
      const savedEventTitle = this.playerState.getEventTitle();

      if (savedItem && slugify(savedItem.nombre) === slug) {
        await this.setCurrentItem(savedItem);
        return;
      }

      if (savedEventTitle && slugify(savedEventTitle) === slug) {
        if (this.eventChannels.length > 0 && this.selectedEventChannel) {
          this.dataService.getChannel(this.selectedEventChannel.channel_id).subscribe({
            next: (iptvChannel) => {
              if (iptvChannel) {
                this.currentItem = iptvChannel;
                this.isChannelMode = true;
                this.eventTitle = savedEventTitle;
                this.playerState.setChannel(iptvChannel);
                this.loadStreamFromItem();
              }
            }
          });
          return;
        }
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
    
    const savedEventTitle = this.playerState.getEventTitle();
    if (!savedEventTitle) {
      this.eventTitle = item.nombre;
    }

    if (this.contentType === 'channels') {
      this.playerState.setChannel(item as IptvChannel);
    } else if (this.contentType === 'movies') {
      this.playerState.setMovie(item as IptvMovie);
    } else if (this.contentType === 'series') {
      this.playerState.setSeries(item as IptvSeries);
    }

    if (!this.itemsLoaded) {
      await this.loadInitialItems();
    }

    await this.ensureItemIsLoaded(item);

    this.loadStreamFromItem();

    if (this.itemsLoaded) {
      this.updateCurrentItemIndex();
    }
  }

  private async ensureItemIsLoaded(item: ContentItem): Promise<void> {
    const itemNum = item.num || 0;

    const isLoaded = this.allItems.some(i => i.id === item.id);

    if (isLoaded) {
      console.log('Item ya cargado:', itemNum);
      return;
    }

    const estimatedPage = Math.ceil(itemNum / this.BATCH_SIZE);

    console.log(`Item ${itemNum} no está cargado. Cargando página ${estimatedPage}...`);

    await this.loadSpecificPage(estimatedPage);

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

    let nextItem = this.allItems.find(i => i.num === targetNum);

    const maxLoadedNum = Math.max(...this.allItems.map(i => i.num || 0));
    const remainingItems = maxLoadedNum - currentNum;

    if (!nextItem && remainingItems < this.PRELOAD_THRESHOLD) {
      await this.loadMoreItemsIfNeeded('next');
      nextItem = this.allItems.find(i => i.num === targetNum);
    }

    if (!nextItem) {
      const candidates = this.allItems.filter(i => (i.num || 0) > currentNum);
      if (candidates.length > 0) {
        nextItem = candidates.sort((a, b) => (a.num || 0) - (b.num || 0))[0];
      }
    }

    if (nextItem) {
      this.navigateToItem(nextItem);
    } else if (this.allItems.length > 0) {
      const firstItem = this.allItems.sort((a, b) => (a.num || 0) - (b.num || 0))[0];
      this.navigateToItem(firstItem);
    }
  }

  async previousItem(): Promise<void> {
    if (this.allItems.length === 0 || !this.currentItem || this.isMovieContent) return;

    const currentNum = this.currentItem.num || 0;
    const targetNum = currentNum - 1;

    let prevItem = this.allItems.find(i => i.num === targetNum);

    const minLoadedNum = Math.min(...this.allItems.map(i => i.num || 0));
    const remainingItems = currentNum - minLoadedNum;

    if (!prevItem && remainingItems < this.PRELOAD_THRESHOLD) {
      await this.loadMoreItemsIfNeeded('prev');
      prevItem = this.allItems.find(i => i.num === targetNum);
    }

    if (!prevItem) {
      const candidates = this.allItems.filter(i => (i.num || 0) < currentNum);
      if (candidates.length > 0) {
        prevItem = candidates.sort((a, b) => (b.num || 0) - (a.num || 0))[0];
      }
    }

    if (prevItem) {
      this.navigateToItem(prevItem);
    } else if (this.allItems.length > 0) {
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

    this.hasError = false;
    this.errorMessage = '';
    this.retryCount = 0;

    this.currentItem = item;
    const savedEventTitle = this.playerState.getEventTitle();
    if (!savedEventTitle) {
      this.eventTitle = item.nombre;
    }
    this.currentItemIndex = this.allItems.findIndex(i => i.id === item.id);

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

  get isVodContent(): boolean {
    return this.contentType === 'movies' || this.contentType === 'series';
  }

  get qualityOptions(): { label: string; quality: string; channel: ChannelResolved }[] {
    return this.eventChannels.map(ch => ({
      label: ch.quality || 'SD',
      quality: ch.quality || 'SD',
      channel: ch
    })).sort((a, b) => {
      const qualityOrder = { 'FHD': 0, 'HD': 1, 'SD': 2 };
      const orderA = qualityOrder[a.quality as keyof typeof qualityOrder] ?? 3;
      const orderB = qualityOrder[b.quality as keyof typeof qualityOrder] ?? 3;
      return orderA - orderB;
    });
  }

  get eventChannelGroups(): { displayName: string; channels: ChannelResolved[] }[] {
    if (!this.eventChannels || this.eventChannels.length === 0) return [];

    const grouped = new Map<string, ChannelResolved[]>();
    
    this.eventChannels.forEach(channel => {
      const key = channel.display_name;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(channel);
    });

    const groups: { displayName: string; channels: ChannelResolved[] }[] = [];
    grouped.forEach((chs, displayName) => {
      groups.push({
        displayName,
        channels: chs.sort((a, b) => {
          const qualityOrder: Record<string, number> = { 'FHD': 0, 'HD': 1, 'SD': 2 };
          const orderA = qualityOrder[a.quality || 'SD'];
          const orderB = qualityOrder[b.quality || 'SD'];
          return orderA - orderB;
        })
      });
    });

    return groups;
  }

  selectQuality(channel: ChannelResolved): void {
    this.selectedEventChannel = channel;
    this.showQualitySelector = true;
    
    if (this.currentItem && this.videoElement) {
      this.reloadStreamWithChannel(channel);
    }
    
    this.cdr.markForCheck();
  }

  private reloadStreamWithChannel(channel: ChannelResolved): void {
    const username = localStorage.getItem('iptv_username') || '';
    const password = localStorage.getItem('iptv_password') || '';

    if (!username || !password) {
      console.error('No hay credenciales guardadas');
      return;
    }

    this.dataService.getChannel(channel.channel_id).subscribe({
      next: (iptvChannel) => {
        if (iptvChannel) {
          this.currentItem = iptvChannel;
          
          const originalUrl = (iptvChannel as any).stream_url || (iptvChannel as any).url || '';
          if (!originalUrl) {
            console.error('No hay URL original para el canal:', iptvChannel);
            return;
          }

          const parts = originalUrl.split('/');
          const lastPart = parts[parts.length - 1];
          const extMatch = lastPart.match(/\.(ts|m3u8|mp4|mkv|avi)$/i);
          this.currentExtension = extMatch ? extMatch[0] : '';

          this.streamUrl = this.buildStreamUrl(originalUrl, username, password);
          console.log('Stream URL generado para calidad:', this.streamUrl);

          this.currentOriginalUrl = this.streamUrl;
          this.availableStreams = [{
            name: iptvChannel.nombre,
            url: this.streamUrl,
            logo: iptvChannel.logo,
            group: (iptvChannel as any).grupo
          }];

          this.shouldInitializePlayer = true;
          this.isPlaying = true;

          if (this.videoElement) {
            setTimeout(() => this.initializePlayer(true), 0);
          }
        }
      },
      error: (err) => {
        console.error('Error al obtener canal:', err);
      }
    });
  }

  toggleQualitySelector(): void {
    this.showQualitySelector = !this.showQualitySelector;
    this.cdr.markForCheck();
  }

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

    const loadChannelStream = (channelId: string): void => {
      this.dataService.getChannel(channelId).subscribe({
        next: (iptvChannel) => {
          if (iptvChannel) {
            const originalUrl = (iptvChannel as any).stream_url || (iptvChannel as any).url || '';
            if (!originalUrl) {
              console.error('No hay URL original para el canal:', iptvChannel);
              return;
            }

            const parts = originalUrl.split('/');
            const lastPart = parts[parts.length - 1];
            const extMatch = lastPart.match(/\.(ts|m3u8|mp4|mkv|avi)$/i);
            this.currentExtension = extMatch ? extMatch[0] : '';

            this.streamUrl = this.buildStreamUrl(originalUrl, username, password);
            console.log('Stream URL generado:', this.streamUrl);

            this.currentOriginalUrl = this.streamUrl;
            this.availableStreams = [{
              name: iptvChannel.nombre,
              url: this.streamUrl,
              logo: iptvChannel.logo,
              group: (iptvChannel as any).grupo
            }];

            this.shouldInitializePlayer = true;
            this.isPlaying = true;

            if (this.videoElement) {
              setTimeout(() => this.initializePlayer(true), 0);
            }
          }
        },
        error: (err) => {
          console.error('Error al obtener canal:', err);
        }
      });
    };

    if (this.selectedEventChannel) {
      loadChannelStream(this.selectedEventChannel.channel_id);
      return;
    }

    const item = this.currentItem as any;
    const originalUrl = item.stream_url || item.url || '';

    if (!originalUrl) {
      console.error('No hay URL original para el item:', this.currentItem);
      return;
    }

    console.log('Item raw:', this.currentItem);
    console.log('URL original:', originalUrl);

    const parts = originalUrl.split('/');
    const lastPart = parts[parts.length - 1];
    const extMatch = lastPart.match(/\.(ts|m3u8|mp4|mkv|avi)$/i);
    this.currentExtension = extMatch ? extMatch[0] : '';

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

    const baseUrl = 'https://iptv.walerike.com';
    if (originalUrl.startsWith(baseUrl)) {
      console.log('📌 URL ya está proxiada:', originalUrl);
      return originalUrl;
    }

    const parts = originalUrl.split('/');
    const lastPart = parts[parts.length - 1];

    // ✅ Usar currentExtension si está definida, o extraer de URL
    let extension = this.currentExtension;
    if (!extension) {
      const extMatch = lastPart.match(/\.(ts|m3u8|mp4|mkv|avi)$/i);
      extension = extMatch ? extMatch[0] : '';
    }
    
    const streamId = lastPart.replace(/\.(ts|m3u8|mp4|mkv|avi)$/i, '');

    let proxyBaseUrl = baseUrl;

    switch (this.contentType) {
      case 'movies':
        proxyBaseUrl += '/movie';
        break;
      case 'series':
        proxyBaseUrl += '/series';
        break;
      case 'channels':
      default:
        break;
    }

    const finalUrl = `${proxyBaseUrl}/${username}/${password}/${streamId}${extension}`;
    console.log('🔗 URL construida:', {
      contentType: this.contentType,
      extension: extension,
      streamId: streamId,
      finalUrl: finalUrl
    });
    return finalUrl;
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
    if (this.videoJsPlayer) {
      this.videoJsPlayer.dispose();
      this.videoJsPlayer = null;
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

    console.log('🎬 Inicializando player:', {
      url: this.streamUrl,
      contentType: this.contentType,
      retryCount: this.retryCount
    });

    if (this.player) {
      try {
        this.player.destroy();
      } catch (e) {
        console.warn('Error destruyendo player MPEG-TS:', e);
      }
      this.player = null;
    }
    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.destroy();
      } catch (e) {
        console.warn('Error destruyendo player HLS:', e);
      }
      this.hlsPlayer = null;
    }
    if (this.videoJsPlayer) {
      try {
        this.videoJsPlayer.dispose();
      } catch (e) {
        console.warn('Error destruyendo player Video.js:', e);
      }
      this.videoJsPlayer = null;
    }

    const savedVolume = this.playerState.getVolume();
    const savedMuted = this.playerState.isMuted();

    const urlLower = this.streamUrl.toLowerCase();
    const isHLS = urlLower.includes('.m3u8');
    const isMP4 = urlLower.includes('.mp4');
    const isMKV = urlLower.includes('.mkv');
    const isAVI = urlLower.includes('.avi');
    const isChannel = this.contentType === 'channels';
    const isVOD = this.contentType === 'movies' || this.contentType === 'series';
    const hasNoExtension = !isHLS && !isMP4 && !isMKV && !isAVI;

    console.log('Tipo de stream:', {
      isHLS, isMP4, isMKV, isAVI, isChannel, isVOD, hasNoExtension,
      contentType: this.contentType
    });

    const checkLibs = () => {
      const Hls = (window as any).Hls;
      const mpegtsLib = (window as any).mpegts;
      const videojsLib = (window as any).videojs;
      return { Hls, mpegts: mpegtsLib, videojs: videojsLib };
    };

    const libs = checkLibs();

    // ✅ SOLUCIÓN: Para .mp4 en VOD, intentar primero con HTML5 nativo
    // Solo usar mpegts.js si el video falla (indica que es MPEG-TS real)
    
    if (isVOD && isMP4 && libs.videojs) {
      console.log('✅ Usando Video.js para VOD .mp4 (soporta tanto MP4 nativo como MPEG-TS)');
      this.initVideoJsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    else if (isVOD && isHLS && libs.Hls && libs.Hls.isSupported()) {
      console.log('✅ Usando HLS.js para VOD .m3u8');
      this.initHlsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    else if (isVOD && hasNoExtension && libs.videojs) {
      console.log('⚠️ Video.js para VOD sin extensión');
      this.initVideoJsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    else if (isVOD && (isMKV || isAVI) && libs.videojs) {
      console.log('📹 Video.js para VOD:', isMKV ? 'MKV' : 'AVI');
      this.initVideoJsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    else if (isChannel && !isHLS && !isMP4 && !isMKV && !isAVI && libs.mpegts && libs.mpegts.isSupported()) {
      console.log('📡 MPEG-TS player para canal');
      this.initMpegtsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    else if (isChannel && isHLS && libs.Hls && libs.Hls.isSupported()) {
      console.log('📡 HLS.js para canal HLS');
      this.initHlsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    }
    else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('🍎 HLS nativo del navegador');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    }
    else if (isMP4 || isMKV || isAVI) {
      console.log('🔧 HTML5 video nativo');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    }
    else {
      console.log('🔧 HTML5 fallback nativo');
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
      lowLatencyMode: isLiveContent,
      backBufferLength: isLiveContent ? 90 : 30,
      maxBufferLength: isLiveContent ? 30 : 60,
      maxMaxBufferLength: isLiveContent ? 60 : 120,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 2,
      manifestLoadingRetryDelay: 1000,
      levelLoadingRetryDelay: 1000,
      fragLoadingRetryDelay: 1000,
      fragLoadingMaxRetryTimeout: 5000
    };

    this.hlsPlayer = new Hls(hlsConfig);

    this.hlsPlayer.loadSource(url);
    this.hlsPlayer.attachMedia(video);

    this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('✅ HLS Manifest cargado');
      video.volume = volume;
      video.muted = wasMuted;
      this.playVideo(video, autoplay, wasMuted, volume);

      if (this.retryCount > 0 || this.hasError) {
        console.log('✅ Stream HLS cargado correctamente, reseteando estado');
        this.retryCount = 0;
        this.hasError = false;
        this.errorMessage = '';
        this.cdr.markForCheck();
      }
    });

    this.hlsPlayer.on(Hls.Events.ERROR, (event: any, data: any) => {
      const statusCode = data?.response?.code || data?.networkDetails?.status || data?.response?.statusCode;

      console.error('❌ HLS Error:', {
        type: data?.type,
        details: data?.details,
        fatal: data?.fatal,
        statusCode: statusCode,
        retryCount: this.retryCount
      });

      if (statusCode === 404) {
        console.error('❌ Error 404: Archivo no encontrado');
        this.hasError = true;
        this.errorMessage = 'Contenido no disponible (404)';
        this.cdr.markForCheck();
        if (this.hlsPlayer) {
          this.hlsPlayer.stopLoad();
        }
        return;
      }

      const isAuthError = statusCode === 511 || (data?.type === 'networkError' && statusCode >= 500);

      if (isAuthError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        const delay = 2000 * Math.pow(2, this.retryCount - 1);
        console.warn(`⚠️ Error ${statusCode} detectado. Reintento ${this.retryCount}/${this.MAX_RETRIES} en ${delay}ms`);

        // ✅ Mostrar error PERO mantener video visible
        this.hasError = true;
        this.errorMessage = `Reconectando... (${this.retryCount}/${this.MAX_RETRIES})`;
        this.cdr.markForCheck();

        if (this.hlsPlayer) {
          try {
            this.hlsPlayer.destroy();
          } catch (e) {
            console.warn('Error al destruir HLS player:', e);
          }
          this.hlsPlayer = null;
        }

        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        this.retryTimeout = window.setTimeout(() => {
          console.log('🔄 Reintentando carga del stream HLS...');
          this.reloadStream();
        }, delay);
      } else if (data.fatal) {
        console.error('Error fatal en HLS:', data.type);
        this.hasError = true;
        this.errorMessage = `Error de reproducción: ${data.type}`;
        this.cdr.markForCheck();

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('Intentando recuperar de error de red...');
            if (this.hlsPlayer && this.retryCount < this.MAX_RETRIES) {
              this.retryCount++;
              const delay = 1000 * Math.pow(2, this.retryCount - 1);
              this.errorMessage = `Error de red, reintentando... (${this.retryCount}/${this.MAX_RETRIES})`;
              this.cdr.markForCheck();
              setTimeout(() => {
                this.hlsPlayer?.startLoad();
              }, delay);
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('Intentando recuperar de error de media...');
            this.hlsPlayer?.recoverMediaError();
            break;
          default:
            if (this.hlsPlayer) {
              try {
                this.hlsPlayer.destroy();
              } catch (e) {
                console.warn('Error al destruir HLS player:', e);
              }
              this.hlsPlayer = null;
            }
            break;
        }
      }
    });
  }

  private initVideoJsPlayer(video: HTMLVideoElement, url: string, autoplay: boolean, wasMuted: boolean, volume: number): void {
    const videojs = (window as any).videojs;

    video.classList.add('video-js', 'vjs-default-skin', 'vjs-big-play-centered');

    let mimeType: string | undefined = undefined;
    const urlLower = url.toLowerCase();

    if (urlLower.includes('.mp4')) {
      mimeType = 'video/mp4';
    } else if (urlLower.includes('.mkv')) {
      mimeType = 'video/x-matroska';
    } else if (urlLower.includes('.avi')) {
      mimeType = 'video/x-msvideo';
    } else if (urlLower.includes('.m3u8')) {
      mimeType = 'application/x-mpegURL';
    }

    console.log('Inicializando Video.js:', {
      url: url,
      mimeType: mimeType || 'auto-detect'
    });

    this.videoJsPlayer = videojs(video, {
      html5: {
        nativeAudioTracks: false,
        nativeVideoTracks: false,
        vhs: {
          overrideNative: true
        }
      },
      preload: 'auto',
      controls: false,
      autoplay: autoplay,
      muted: wasMuted,
      volume: volume,
      fluid: true,
      errorDisplay: false,
      notSupportedMessage: '',
      suppressNotSupportedError: true,
      playbackRates: [],
      inactivityTimeout: 0
    });

    if (mimeType) {
      this.videoJsPlayer.src({
        src: url,
        type: mimeType
      });
    } else {
      this.videoJsPlayer.src(url);
    }

    this.videoJsPlayer.on('loadedmetadata', () => {
      console.log('Video.js metadata loaded');
      if (this.hasError) {
        this.hasError = false;
        this.errorMessage = '';
        this.retryCount = 0;
        this.cdr.markForCheck();
      }
    });

    this.videoJsPlayer.on('canplay', () => {
      console.log('Video.js canplay event');
      if (this.hasError) {
        this.hasError = false;
        this.errorMessage = '';
        this.retryCount = 0;
        this.cdr.markForCheck();
      }
    });

    this.videoJsPlayer.on('error', () => {
      const error = this.videoJsPlayer.error();
      console.error('Video.js error:', {
        code: error?.code,
        message: error?.message
      });

      // ✅ Fallback: Si es error de formato no soportado, intentar con mpegts.js
      if (error?.code === 4 && this.streamUrl.toLowerCase().includes('.mp4')) {
        console.log('⚠️ Video.js no soporta el formato, intentando con mpegts.js...');
        const mpegtsLib = (window as any).mpegts;
        if (mpegtsLib && mpegtsLib.isSupported()) {
          try {
            this.videoJsPlayer.dispose();
            this.videoJsPlayer = null;
          } catch (e) {
            console.warn('Error disposing Video.js:', e);
          }
          this.initMpegtsVodPlayer(video, this.streamUrl, autoplay, wasMuted, volume);
          return;
        }
      }
      
      // ✅ Intento de recuperación con otra extensión si Video.js falla
      if ((error?.code === 4 || error?.code === 3) && this.tryNextExtension()) {
        console.warn(`🔄 Video.js Error ${error?.code}, intentando con extensión: ${this.currentExtension}`);
        this.reloadStream();
        return;
      }

      this.hasError = true;
      this.errorMessage = `Error de reproducción: ${error?.message || 'Error desconocido'}`;

      if (error?.code === 2 && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        this.errorMessage = `Error de red, reintentando... (${this.retryCount}/${this.MAX_RETRIES})`;
        this.cdr.markForCheck();

        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        this.retryTimeout = window.setTimeout(() => {
          console.log('🔄 Reintentando carga del stream Video.js...');
          this.reloadStream();
        }, 2000 * this.retryCount);
      } else {
        this.cdr.markForCheck();
      }
    });

    this.videoJsPlayer.load();

    if (autoplay) {
      this.videoJsPlayer.play().catch((err: any) => {
        console.log('Video.js autoplay blocked:', err);
      });
    }
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
      console.error('MPEG-TS Error:', {
        type,
        detail,
        retryCount: this.retryCount
      });

      this.hasError = true;
      this.errorMessage = `Error MPEG-TS: ${type}`;
      this.cdr.markForCheck();

      const isAuthError = type === 'NetworkError' || type === 'HttpStatusCodeInvalid';

      if (isAuthError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        console.warn(`⚠️ Error detectado en MPEG-TS. Reintento ${this.retryCount}/${this.MAX_RETRIES}`);

        this.errorMessage = `Reconectando... (${this.retryCount}/${this.MAX_RETRIES})`;
        this.cdr.markForCheck();

        if (this.player) {
          try {
            this.player.destroy();
          } catch (e) {
            console.warn('Error al destruir MPEG-TS player:', e);
          }
          this.player = null;
        }

        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        this.retryTimeout = window.setTimeout(() => {
          console.log('🔄 Reintentando carga del stream MPEG-TS...');
          this.reloadStream();
        }, 2000);
      } else if (this.retryCount >= this.MAX_RETRIES) {
        console.error('❌ Máximo número de reintentos alcanzado');
        this.errorMessage = 'No se pudo conectar al stream';
        this.cdr.markForCheck();
      }
    });

    this.player.on(mpegts.Events.LOADING_COMPLETE, () => {
      console.log('MPEG-TS loading complete');
      if (this.retryCount > 0 || this.hasError) {
        console.log('✅ Stream MPEG-TS cargado correctamente');
        this.retryCount = 0;
        this.hasError = false;
        this.errorMessage = '';
        this.cdr.markForCheck();
      }
    });

    this.player.attachMediaElement(video);
    this.player.load();
    video.volume = volume;
    video.muted = wasMuted;
    this.playVideo(video, autoplay, wasMuted, volume);
  }

  // ✅ Método específico para VOD con MPEG-TS (no es live)
  private initMpegtsVodPlayer(video: HTMLVideoElement, url: string, autoplay: boolean, wasMuted: boolean, volume: number): void {
    const mpegts = (window as any).mpegts;

    // Configuración para VOD - NO es live stream
    // ✅ Configuración optimizada para manejar PTS overlaps y errores de MSE
    this.player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: false, // ✅ CRÍTICO: false para VOD
      url: url,
      enableWorker: true,
      enableStashBuffer: true,
      stashInitialSize: 384,

      // ✅ CRÍTICO: Configuración para manejar errores de PTS
      fixAudioTimestampGap: true, // Corregir gaps en timestamps de audio
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 30,
      autoCleanupMinBackwardDuration: 15,

      // ✅ Configuración de headers para rango HTTP
      headers: {},
      withCredentials: false,

      // ✅ Control de buffer para evitar errores de MSE
      liveBufferLatencyChasing: false,
      liveBufferLatencyMaxLatency: 3,
      liveBufferLatencyMinRemain: 0.5
    });

    this.player.on(mpegts.Events.ERROR, (type: any, detail: any) => {
      console.error('MPEG-TS VOD Error:', {
        type,
        detail,
        retryCount: this.retryCount,
        code: detail?.code,
        msg: detail?.msg
      });

      // ✅ CRÍTICO: Ignorar errores de MediaMSEError que son recuperables
      // Estos errores son causados por PTS overlaps pero no impiden la reproducción
      if (type === 'MediaError' && detail === 'MediaMSEError') {
        console.warn('⚠️ MediaMSEError detectado (PTS overlap), ignorando - reproducción continúa');
        // NO marcar hasError ni detener reproducción
        // Estos errores son normales con archivos MPEG-TS mal formateados
        return;
      }

      this.hasError = true;
      this.errorMessage = `Error MPEG-TS: ${type}`;
      this.cdr.markForCheck();

      const isAuthError = type === 'NetworkError' ||
                          type === 'HttpStatusCodeInvalid' ||
                          detail === 'HttpStatusCodeInvalid' ||
                          String(detail).includes('HttpStatusCodeInvalid') ||
                          String(type).includes('NetworkError');

      // ✅ Manejo de error 404 o formato incorrecto (cambiar extensión)
      if (type === 'NetworkError' && (detail?.code === 404 || String(detail).includes('404'))) {
         if (this.tryNextExtension()) {
           console.warn(`🔄 Error 404 en MPEG-TS, probando extensión: ${this.currentExtension}`);
           this.reloadStream();
           return;
         }
      }

      if (isAuthError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        console.warn(`⚠️ Error ${detail?.code || 'de red'} detectado en MPEG-TS VOD. Reintento ${this.retryCount}/${this.MAX_RETRIES}`);

        this.errorMessage = `Reconectando... (${this.retryCount}/${this.MAX_RETRIES})`;
        this.cdr.markForCheck();

        if (this.player) {
          try {
            this.player.unload();
            this.player.detachMediaElement();
            this.player.destroy();
          } catch (e) {
            console.warn('Error al destruir MPEG-TS VOD player:', e);
          }
          this.player = null;
        }

        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        this.retryTimeout = window.setTimeout(() => {
          console.log('🔄 Reintentando carga del stream MPEG-TS VOD...');
          this.reloadStream();
        }, 2000);
      } else if (this.retryCount >= this.MAX_RETRIES) {
        console.error('❌ Máximo número de reintentos alcanzado');
        this.errorMessage = 'No se pudo cargar el contenido';
        this.cdr.markForCheck();
      }
    });

    this.player.on(mpegts.Events.LOADING_COMPLETE, () => {
      console.log('✅ MPEG-TS VOD loading complete');
      if (this.retryCount > 0 || this.hasError) {
        console.log('✅ Stream MPEG-TS VOD cargado correctamente');
        this.retryCount = 0;
        this.hasError = false;
        this.errorMessage = '';
        this.cdr.markForCheck();
      }
    });

    this.player.on(mpegts.Events.METADATA_ARRIVED, (metadata: any) => {
      console.log('📊 MPEG-TS metadata:', metadata);
    });

    this.player.on(mpegts.Events.MEDIA_INFO, (mediaInfo: any) => {
      console.log('📹 MPEG-TS media info:', {
        duration: mediaInfo.duration,
        hasAudio: mediaInfo.hasAudio,
        hasVideo: mediaInfo.hasVideo,
        audioCodec: mediaInfo.audioCodec,
        videoCodec: mediaInfo.videoCodec
      });
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
        if (this.hasError) {
          this.hasError = false;
          this.errorMessage = '';
          this.retryCount = 0;
          this.cdr.markForCheck();
        }
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
      if (this.retryCount > 0 || this.hasError) {
        console.log('✅ Video canplay, reseteando estado');
        this.retryCount = 0;
        this.hasError = false;
        this.errorMessage = '';
        this.cdr.markForCheck();
      }
    });

    video.addEventListener('loadeddata', () => {
      if (this.retryCount > 0 || this.hasError) {
        console.log('✅ Video loadeddata, reseteando estado');
        this.retryCount = 0;
        this.hasError = false;
        this.errorMessage = '';
        this.cdr.markForCheck();
      }
    });

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
        retryCount: this.retryCount
      });

      if (errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
          errorCode === MediaError.MEDIA_ERR_DECODE) {
        
        // ✅ Intento de recuperación con otra extensión
        if (this.tryNextExtension()) {
          console.warn(`🔄 Error de formato (${errorCode}), intentando con extensión: ${this.currentExtension}`);
          this.reloadStream();
          return;
        }

        console.error('❌ Error de formato no soportado o decode (sin más opciones)');
        this.hasError = true;
        this.errorMessage = errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'Formato de video no soportado'
          : 'Error al decodificar el video';
        this.cdr.markForCheck();
        return;
      }

      const isAuthError = errorCode === MediaError.MEDIA_ERR_NETWORK ||
                          networkState === HTMLMediaElement.NETWORK_NO_SOURCE;

      if (isAuthError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        console.warn(`⚠️ Error de red. Reintento ${this.retryCount}/${this.MAX_RETRIES}`);

        this.hasError = true;
        this.errorMessage = `Error de red, reintentando... (${this.retryCount}/${this.MAX_RETRIES})`;
        this.cdr.markForCheck();

        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        this.retryTimeout = window.setTimeout(() => {
          console.log('🔄 Reintentando carga del stream...');
          this.reloadStream();
        }, 2000);
      } else if (this.retryCount >= this.MAX_RETRIES) {
        console.error('❌ Máximo número de reintentos alcanzado');
        this.hasError = true;
        this.errorMessage = 'No se pudo cargar el contenido';
        this.cdr.markForCheck();
      } else {
        this.hasError = true;
        this.errorMessage = `Error: ${errorMessage || 'Error desconocido'}`;
        this.cdr.markForCheck();
      }
    });
  }

  private tryNextExtension(): boolean {
    if (!this.currentExtension) return false;

    const ext = this.currentExtension.toLowerCase();
    
    if (ext === '.mp4') {
      this.currentExtension = '.ts';
      return true;
    } else if (ext === '.ts') {
      this.currentExtension = '.mkv';
      return true;
    } else if (ext === '.mkv') {
      this.currentExtension = '.avi';
      return true;
    } else if (ext === '.avi') {
      this.currentExtension = '';
      return true;
    }

    return false;
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
    const originalUrl = item.stream_url || item.url || '';

    if (!originalUrl) {
      console.error('❌ No hay URL para recargar');
      return;
    }

    if (this.player) {
      try {
        this.player.destroy();
      } catch (e) {
        console.warn('Error al destruir MPEG-TS player:', e);
      }
      this.player = null;
    }

    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.destroy();
      } catch (e) {
        console.warn('Error al destruir HLS player:', e);
      }
      this.hlsPlayer = null;
    }

    if (this.videoJsPlayer) {
      try {
        this.videoJsPlayer.dispose();
      } catch (e) {
        console.warn('Error al destruir Video.js player:', e);
      }
      this.videoJsPlayer = null;
    }

    const video = this.videoElement?.nativeElement;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    this.streamUrl = this.buildStreamUrl(originalUrl, username, password);

    console.log(`✨ URL reconstruida (intento ${this.retryCount}):`, this.streamUrl);

    setTimeout(() => {
      console.log('🎬 Reinicializando player...');
      this.initializePlayer(true);
    }, 500);
  }

  togglePlayPause() {
    if (this.videoJsPlayer) {
      if (this.videoJsPlayer.paused()) {
        this.videoJsPlayer.play().catch((err: any) => console.error('Error al reproducir Video.js:', err));
      } else {
        this.videoJsPlayer.pause();
      }
    } else {
      const video = this.videoElement.nativeElement;
      video.paused ? video.play().catch(console.error) : video.pause();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.playerState.setMuted(this.isMuted);
    if (this.videoJsPlayer) {
      this.videoJsPlayer.muted(this.isMuted);
    } else {
      this.videoElement.nativeElement.muted = this.isMuted;
    }
  }

  setVolume(event: any): void {
    const newVolume = parseFloat(event.target.value);
    this.volume = newVolume;
    this.playerState.setVolume(newVolume);

    const percentage = (newVolume * 100);
    event.target.style.setProperty('--value', percentage + '%');

    if (this.videoJsPlayer) {
      this.videoJsPlayer.volume(newVolume);
      this.videoJsPlayer.muted(newVolume === 0);
      this.isMuted = newVolume === 0;
      this.playerState.setMuted(this.isMuted);
    } else if (this.videoElement?.nativeElement) {
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
    this.hasError = false;
    this.errorMessage = '';
    this.retryCount = 0;

    this.streamUrl = stream.url;
    this.currentOriginalUrl = stream.url;
    this.initializePlayer(true);
  }
}
