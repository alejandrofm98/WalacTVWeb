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

  // Quality switching for events
  eventChannels: ChannelResolved[] = [];
  eventChannelGroupsList: { displayName: string; channels: ChannelResolved[] }[] = [];
  qualityOptionsList: { label: string; quality: string; channel: ChannelResolved }[] = [];
  selectedEventChannel: ChannelResolved | null = null;
  showQualitySelector = false;

  // Channel navigation state
  isLoadingChannel = false;
  previousChannelInfo = '';
  nextChannelInfo = '';

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
  isStreamLoading = false;
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

    this.route.paramMap.subscribe(async params => {
      const slug = params.get('title');
      if (!slug) return;

      const savedItem = this.playerState.getCurrentItem();
      const savedEventTitle = this.playerState.getEventTitle();
      const savedEventChannels = this.playerState.getEventChannels();
      const savedSelectedChannelId = this.playerState.getSelectedChannelId();

      console.log('Recuperando estado:', {
        slug,
        savedEventTitle,
        channelsCount: savedEventChannels.length,
        selectedChannelId: savedSelectedChannelId
      });

      if (savedEventTitle && savedEventChannels.length > 0) {
        const savedSlug = slugify(savedEventTitle);
        const isEventMatch = savedSlug === slug || slug.includes(savedSlug) || savedSlug.includes(slug);
        
        if (isEventMatch) {
          console.log('Recuperando evento guardado:', savedEventTitle);
          this.eventChannels = savedEventChannels;
          this.eventTitle = savedEventTitle;
          this.updateQualitySelectors();
          
          let initialChannel: ChannelResolved | undefined;
          
          if (savedSelectedChannelId) {
            initialChannel = this.eventChannels.find(
              c => String(c.channel_id) === String(savedSelectedChannelId)
            );
            console.log('Buscando canal por selectedChannelId:', savedSelectedChannelId, '-> encontrado:', !!initialChannel);
          }

          if (!initialChannel && savedItem && savedItem.id) {
            initialChannel = this.eventChannels.find(
              c => String(c.channel_id) === String(savedItem.id)
            );
          }

          if (!initialChannel) {
            const priorityZero = this.eventChannels.find(c => c.priority === 0);
            initialChannel = priorityZero || this.eventChannels[0];
          }

          if (initialChannel) {
            this.selectedEventChannel = initialChannel;
            this.showQualitySelector = true;

            this.dataService.getChannel(initialChannel.channel_id).subscribe({
              next: (iptvChannel) => {
                if (iptvChannel) {
                  this.currentItem = iptvChannel;
                  this.isChannelMode = true;
                  this.eventTitle = savedEventTitle;
                  this.loadStreamFromItem();
                }
              }
            });
            return;
          }
        }
      }

      this.eventChannels = [];
      this.eventTitle = '';
      this.selectedEventChannel = null;
      this.showQualitySelector = false;
      this.updateQualitySelectors();

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
      this.updateChannelInfo();
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

    this.isLoadingChannel = true;
    this.updateChannelInfo();

    try {
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
      } else {
        this.isLoadingChannel = false;
        this.cdr.markForCheck();
      }
    } catch (e) {
      console.error('Error navigating to next item:', e);
      this.isLoadingChannel = false;
      this.cdr.markForCheck();
    }
  }

  async previousItem(): Promise<void> {
    if (this.allItems.length === 0 || !this.currentItem || this.isMovieContent) return;

    this.isLoadingChannel = true;
    this.updateChannelInfo();

    try {
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
      } else {
        this.isLoadingChannel = false;
        this.cdr.markForCheck();
      }
    } catch (e) {
      console.error('Error navigating to previous item:', e);
      this.isLoadingChannel = false;
      this.cdr.markForCheck();
    }
  }

  private updateChannelInfo(): void {
    if (!this.currentItem || this.allItems.length === 0) {
      this.previousChannelInfo = '';
      this.nextChannelInfo = '';
      return;
    }

    const currentNum = this.currentItem.num || 0;
    const sortedItems = [...this.allItems].sort((a, b) => (a.num || 0) - (b.num || 0));

    const prevItem = [...sortedItems].reverse().find(i => (i.num || 0) < currentNum);
    const nextItem = sortedItems.find(i => (i.num || 0) > currentNum);

    this.previousChannelInfo = prevItem ? `${prevItem.num} - ${prevItem.nombre}` : '';
    this.nextChannelInfo = nextItem ? `${nextItem.num} - ${nextItem.nombre}` : '';
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
    if (!item) {
      this.isLoadingChannel = false;
      this.cdr.markForCheck();
      return;
    }

    this.hasError = false;
    this.errorMessage = '';
    this.retryCount = 0;

    // Clear event context when navigating via next/prev
    this.selectedEventChannel = null;
    this.eventChannels = [];
    this.updateQualitySelectors();
    this.showQualitySelector = false;
    this.playerState.clearEvent();

    this.currentItem = item;
    this.eventTitle = item.nombre;
    this.currentItemIndex = this.allItems.findIndex(i => i.id === item.id);

    this.updateChannelInfo();

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

    setTimeout(() => {
      this.isLoadingChannel = false;
      this.cdr.markForCheck();
    }, 500);
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

  updateQualitySelectors(): void {
    if (!this.eventChannels || this.eventChannels.length === 0) {
      this.qualityOptionsList = [];
      this.eventChannelGroupsList = [];
      return;
    }

    this.qualityOptionsList = this.eventChannels.map(ch => ({
      label: ch.quality || 'SD',
      quality: ch.quality || 'SD',
      channel: ch
    })).sort((a, b) => {
      const qualityOrder = { 'FHD': 0, 'HD': 1, 'SD': 2 };
      const orderA = qualityOrder[a.quality as keyof typeof qualityOrder] ?? 3;
      const orderB = qualityOrder[b.quality as keyof typeof qualityOrder] ?? 3;
      return orderA - orderB;
    });

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

    this.eventChannelGroupsList = groups;
  }

  trackByGroupName(index: number, group: { displayName: string }): string {
    return group.displayName;
  }

  trackByChannelId(index: number, channel: ChannelResolved): string {
    return channel.channel_id;
  }

  trackByStreamUrl(index: number, stream: StreamSource): string {
    return stream.url;
  }

  selectQuality(channel: ChannelResolved): void {
    this.selectedEventChannel = channel;
    this.playerState.setSelectedChannelId(channel.channel_id);
    this.showQualitySelector = true;
    
    this.retryCount = 0;
    this.hasError = false;
    this.errorMessage = '';
    this.isStreamLoading = true;
    
    if (this.videoElement) {
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

    this.playerState.setSelectedChannelId(channel.channel_id);

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
          this.isStreamLoading = true;

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
            this.isStreamLoading = true;

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
    this.isStreamLoading = true;

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

    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.destroy();
      } catch (e) {
        console.warn('Error destruyendo player HLS:', e);
      }
      this.hlsPlayer = null;
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
      return { Hls };
    };

    const libs = checkLibs();

    // HLS.js is now the primary player for everything
    if (libs.Hls && libs.Hls.isSupported()) {
      console.log('✅ Usando HLS.js');
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

  private playVideo(video: HTMLVideoElement, autoplay: boolean, wasMuted: boolean, volume: number): void {
    if (autoplay) {
      // Intentar reproducir con la preferencia del usuario (posiblemente desmuteado)
      video.muted = wasMuted;
      video.volume = volume;
      this.isMuted = wasMuted;
      this.volume = volume;

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          // El error NotAllowedError significa que el navegador bloqueó el autoplay con sonido
          if (error.name === 'NotAllowedError' && !wasMuted) {
            console.log('🔇 Autoplay con sonido bloqueado. Reintentando silenciado...');
            video.muted = true;
            this.isMuted = true;
            this.volume = 0;
            // Opcional: no guardamos esto en el playerState para recordar que el usuario 
            // realmente lo quería con sonido, solo que el navegador nos forzó.
            
            video.play().catch(e => {
              console.error('❌ Autoplay silenciado también bloqueado:', e);
              this.isPlaying = false;
              this.cdr.markForCheck();
            });
          } else {
            console.error('❌ Error al reproducir video:', error);
            this.isPlaying = false;
            this.cdr.markForCheck();
          }
        });
      }
    } else {
      this.isPlaying = false;
    }
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

      // Si es un error 400, 401, 403, 404, etc., o error de red (como manifestLoadError)
      const isRecoverableError = data?.type === Hls.ErrorTypes.NETWORK_ERROR ||
                                 data?.type === Hls.ErrorTypes.MEDIA_ERROR ||
                                 (statusCode && statusCode >= 400 && statusCode < 600);

      if (isRecoverableError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        const delay = 1500 * Math.pow(1.5, this.retryCount - 1); // Exponential backoff
        
        console.warn(`⚠️ Error de red o código ${statusCode || 'desconocido'}. Reintento ${this.retryCount}/${this.MAX_RETRIES} en ${delay}ms`);

        this.hasError = true;
        this.errorMessage = `Reconectando... (${this.retryCount}/${this.MAX_RETRIES})`;
        this.cdr.markForCheck();

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          console.log('Intentando recuperar error de media interno...');
          this.hlsPlayer?.recoverMediaError();
          return;
        }

        // Para errores de red, intentamos recargar completamente el stream
        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
        }

        this.retryTimeout = window.setTimeout(() => {
          console.log(`🔄 Reintentando carga del stream HLS (Intento ${this.retryCount})...`);
          
          // En lugar de usar startLoad() que a veces falla con streams IPTV,
          // forzamos la recarga completa del stream.
          this.reloadStream();
        }, delay);
        
      } else if (this.retryCount >= this.MAX_RETRIES) {
        console.error('❌ Error fatal definitivo en HLS tras máximos reintentos:', data.type);
        this.hasError = true;
        this.errorMessage = `Error de reproducción. Por favor, intenta de nuevo más tarde.`;
        this.cdr.markForCheck();
        
        if (this.hlsPlayer) {
          try {
            this.hlsPlayer.destroy();
          } catch (e) {
            console.warn('Error al destruir HLS player:', e);
          }
          this.hlsPlayer = null;
        }
      }
    });
  }

  private setupVideoEventListeners(video: HTMLVideoElement): void {
    video.addEventListener('play', () => {
      this.isPlaying = true;
      this.isStreamLoading = false;
      this.cdr.markForCheck();
    });

    video.addEventListener('playing', () => {
      this.isPlaying = true;
      this.isStreamLoading = false;
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
      this.isStreamLoading = true;
      this.cdr.markForCheck();
    });

    video.addEventListener('canplay', () => {
      this.isStreamLoading = false;
      if (this.retryCount > 0 || this.hasError) {
        console.log('✅ Video canplay, reseteando estado');
        this.retryCount = 0;
        this.hasError = false;
        this.errorMessage = '';
        this.cdr.markForCheck();
      }
    });

    video.addEventListener('loadeddata', () => {
      this.isStreamLoading = false;
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
    this.isStreamLoading = true;
    this.cdr.markForCheck();

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

    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.destroy();
      } catch (e) {
        console.warn('Error al destruir HLS player:', e);
      }
      this.hlsPlayer = null;
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
    this.hasError = false;
    this.errorMessage = '';
    this.retryCount = 0;
    this.isStreamLoading = true;

    this.streamUrl = stream.url;
    this.currentOriginalUrl = stream.url;
    this.initializePlayer(true);
  }
}
