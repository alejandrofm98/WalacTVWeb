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
import {
  DataService,
  IptvChannel,
  IptvMovie,
  IptvSeries,
  PaginatedResponse
} from '../../services/data.service';
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
  isCastSupported = false;
  canCast = false;
  isCasting = false;
  isCastConnecting = false;
  castError = '';
  private castTestUrlOverride = '';

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
  private previousGCastApiAvailableHandler?: (isAvailable: boolean) => void;
  private castStateChangedHandler?: (event: cast.framework.CastStateEventData) => void;

  // === VOD Progress Bar State ===
  currentTime = 0;
  duration = 0;
  buffered = 0;
  isSeeking = false;
  seekTooltipTime = 0;
  seekTooltipVisible = false;
  seekTooltipX = 0;
  private progressListenersAttached = false;
  private coreVideoListenersAttached = false;
  private boundTimeUpdateHandler?: () => void;
  private boundProgressHandler?: () => void;
  private boundLoadedMetadataHandler?: () => void;
  private boundSeekedHandler?: () => void;
  private boundSeekingHandler?: () => void;
  private boundPlayHandler?: () => void;
  private boundPlayingHandler?: () => void;
  private boundPauseHandler?: () => void;
  private boundVolumeChangeHandler?: () => void;
  private boundWaitingHandler?: () => void;
  private boundCanPlayHandler?: () => void;
  private boundCoreLoadedDataHandler?: () => void;
  private boundVideoErrorHandler?: (event: Event) => void;
  @ViewChild('seekBar') seekBarElement!: ElementRef<HTMLDivElement>;

  private readonly BATCH_SIZE = 100;
  private readonly PRELOAD_THRESHOLD = 20;
  private readonly DEFAULT_CAST_TEST_URL = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8';
  private currentPage = 1;
  private totalItems = 0;
  private isLoadingMore = false;

  private retryCount = 0;
  readonly MAX_RETRIES = 5;
  private retryTimeout?: number;
  private startupWatchdogTimeout?: number;
  private playbackWatchdogInterval?: number;
  private lastObservedPlaybackTime = 0;
  private noPlaybackProgressSince = 0;
  private recentFragmentIds: string[] = [];
  private lastSoftRecoveryAt = 0;
  private softRecoveryCount = 0;
  private hasManifestParsed = false;
  private hasLevelDetails = false;
  private hasBufferedFragment = false;
  private hasRenderedFirstFrame = false;
  readonly MAX_SOFT_RECOVERIES = 3;

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
    this.initializeCastApi();
    this.initializeCastTestOverride();
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

            const canReuseSavedItem = !!savedItem &&
              !!savedItem.id &&
              String(savedItem.id) === String(initialChannel.channel_id);

            if (canReuseSavedItem) {
              this.currentItem = savedItem;
              this.isChannelMode = true;
              this.eventTitle = savedEventTitle;
              this.loadStreamFromItem();
              return;
            }

            this.loadChannelById(initialChannel.channel_id, savedEventTitle);
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
    this.router.navigate(['/player', slug], {replaceUrl: true});

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
      const qualityOrder = {'FHD': 0, 'HD': 1, 'SD': 2};
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
          const qualityOrder: Record<string, number> = {'FHD': 0, 'HD': 1, 'SD': 2};
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
    return `${channel.channel_id}-${channel.source_name}-${channel.quality}-${index}`;
  }

  isSelectedQuality(channel: ChannelResolved): boolean {
    return this.selectedEventChannel === channel;
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
    const credentials = this.getStoredCredentials();
    if (!credentials) {
      console.error('No hay credenciales guardadas');
      return;
    }

    this.playerState.setSelectedChannelId(channel.channel_id);

    this.loadChannelById(channel.channel_id, this.eventTitle, credentials.username, credentials.password);
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

    const credentials = this.getStoredCredentials();
    if (!credentials) {
      console.error('No hay credenciales guardadas');
      return;
    }

    if (this.selectedEventChannel) {
      const selectedChannelId = String(this.selectedEventChannel.channel_id);
      const currentItemId = String(this.currentItem.id);

      if (currentItemId !== selectedChannelId) {
        this.loadChannelById(selectedChannelId, this.eventTitle, credentials.username, credentials.password);
        return;
      }
    }

    this.prepareStreamForItem(this.currentItem, credentials.username, credentials.password);
  }

  private getStoredCredentials(): { username: string; password: string } | null {
    const username = localStorage.getItem('iptv_username') || '';
    const password = localStorage.getItem('iptv_password') || '';

    if (!username || !password) {
      return null;
    }

    return { username, password };
  }

  private loadChannelById(
    channelId: string,
    eventTitle?: string,
    username?: string,
    password?: string
  ): void {
    const credentials = username && password
      ? { username, password }
      : this.getStoredCredentials();

    if (!credentials) {
      console.error('No hay credenciales guardadas');
      return;
    }

    this.dataService.getChannel(channelId).subscribe({
      next: (iptvChannel) => {
        if (!iptvChannel) {
          console.error('Canal no encontrado:', channelId);
          return;
        }

        this.currentItem = iptvChannel;
        this.isChannelMode = true;

        if (eventTitle) {
          this.eventTitle = eventTitle;
        }

        this.prepareStreamForItem(iptvChannel, credentials.username, credentials.password);
      },
      error: (err) => {
        console.error('Error al obtener canal:', err);
      }
    });
  }

  private prepareStreamForItem(item: ContentItem, username: string, password: string): void {
    const originalUrl = (item as any).stream_url || (item as any).url || '';

    if (!originalUrl) {
      console.error('No hay URL original para el item:', item);
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
      name: item.nombre,
      url: this.streamUrl,
      logo: item.logo,
      group: (item as any).grupo
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
    this.clearHlsWatchdogs();

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

    this.teardownCastApi();

    this.removeVideoEventListeners();
  }

  private removeVideoEventListeners(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }

    if (this.boundPlayHandler) {
      video.removeEventListener('play', this.boundPlayHandler);
    }
    if (this.boundPlayingHandler) {
      video.removeEventListener('playing', this.boundPlayingHandler);
    }
    if (this.boundPauseHandler) {
      video.removeEventListener('pause', this.boundPauseHandler);
    }
    if (this.boundVolumeChangeHandler) {
      video.removeEventListener('volumechange', this.boundVolumeChangeHandler);
    }
    if (this.boundWaitingHandler) {
      video.removeEventListener('waiting', this.boundWaitingHandler);
    }
    if (this.boundCanPlayHandler) {
      video.removeEventListener('canplay', this.boundCanPlayHandler);
    }
    if (this.boundCoreLoadedDataHandler) {
      video.removeEventListener('loadeddata', this.boundCoreLoadedDataHandler);
    }
    if (this.boundVideoErrorHandler) {
      video.removeEventListener('error', this.boundVideoErrorHandler);
    }

    if (this.boundTimeUpdateHandler || this.boundProgressHandler ||
      this.boundLoadedMetadataHandler || this.boundSeekedHandler || this.boundSeekingHandler) {
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

    this.progressListenersAttached = false;
    this.coreVideoListenersAttached = false;
  }

  private clearHlsWatchdogs(): void {
    if (this.startupWatchdogTimeout) {
      clearTimeout(this.startupWatchdogTimeout);
      this.startupWatchdogTimeout = undefined;
    }

    if (this.playbackWatchdogInterval) {
      clearInterval(this.playbackWatchdogInterval);
      this.playbackWatchdogInterval = undefined;
    }

    this.lastObservedPlaybackTime = 0;
    this.noPlaybackProgressSince = 0;
    this.recentFragmentIds = [];
    this.softRecoveryCount = 0;
    this.lastSoftRecoveryAt = 0;
    this.hasManifestParsed = false;
    this.hasLevelDetails = false;
    this.hasBufferedFragment = false;
    this.hasRenderedFirstFrame = false;
  }

  private canRunStartupRecovery(video: HTMLVideoElement): boolean {
    if (!this.hlsPlayer || this.contentType !== 'channels') {
      return false;
    }

    const hasLevels = Array.isArray(this.hlsPlayer.levels) && this.hlsPlayer.levels.length > 0;
    const hasStartupContext = this.hasManifestParsed || this.hasLevelDetails || this.hasBufferedFragment;
    const hasLiveSyncPosition = typeof this.hlsPlayer.liveSyncPosition === 'number' &&
      Number.isFinite(this.hlsPlayer.liveSyncPosition);

    return hasLevels || hasStartupContext || hasLiveSyncPosition || video.currentTime > 0;
  }

  private startStartupWatchdog(video: HTMLVideoElement): void {
    if (this.contentType !== 'channels' || this.startupWatchdogTimeout || this.hasRenderedFirstFrame) {
      return;
    }

    this.startupWatchdogTimeout = window.setTimeout(() => {
      if (!this.canRunStartupRecovery(video)) {
        console.warn('⏱️ Startup watchdog omitido: HLS aun no esta listo para recovery');
        return;
      }

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
        console.warn('⏱️ Startup watchdog: sin frame tras manifest/level, saltando al live edge');
        const pos = this.hlsPlayer?.liveSyncPosition;
        if (typeof pos === 'number' && Number.isFinite(pos)) {
          try {
            video.currentTime = pos;
          } catch (_) {
          }
        }
        this.triggerSoftLiveRecovery('startup watchdog sin primer frame', video);
      }
    }, 8000);
  }

  private logHlsStartupTrace(event: string, data: Record<string, unknown> = {}): void {
    console.log(`🎯 HLS startup ${event}`, {
      streamUrl: this.streamUrl,
      retryCount: this.retryCount,
      softRecoveryCount: this.softRecoveryCount,
      ...data
    });
  }

  private triggerSoftLiveRecovery(reason: string, video: HTMLVideoElement): void {
    if (this.contentType !== 'channels' || !this.hlsPlayer) return;

    if (!this.canRunStartupRecovery(video)) {
      console.warn(`⚠️ Recuperacion suave omitida (${reason}): HLS aun no esta listo`);
      return;
    }

    // Si ya agotamos soft recoveries, hacer reload completo
    if (this.softRecoveryCount >= this.MAX_SOFT_RECOVERIES) {
      console.warn(`⚠️ Soft recoveries agotados (${reason}). Forzando reload completo.`);
      this.softRecoveryCount = 0;
      this.retryCount = 0;
      this.reloadStream();
      return;
    }

    const now = Date.now();
    if (now - this.lastSoftRecoveryAt < 3000) return;

    this.softRecoveryCount++;
    this.lastSoftRecoveryAt = now;

    console.warn(`⚠️ Recuperacion suave live (${this.softRecoveryCount}/${this.MAX_SOFT_RECOVERIES}): ${reason}`);

    const liveSyncPosition = this.hlsPlayer.liveSyncPosition;
    if (typeof liveSyncPosition === 'number' && Number.isFinite(liveSyncPosition)) {
      try {
        const drift = Math.abs(video.currentTime - liveSyncPosition);
        if (!Number.isFinite(video.currentTime) || drift > 1.5) {
          video.currentTime = liveSyncPosition;
        }
      } catch (error) {
        console.warn('No se pudo mover al live edge:', error);
      }
    }

    try {
      if (this.hasManifestParsed || this.hasLevelDetails || this.hasBufferedFragment) {
        this.hlsPlayer.stopLoad?.();
        this.hlsPlayer.startLoad(-1);
      }
    } catch (error) {
      console.warn('Error durante recuperacion suave HLS:', error);
    }
  }

  private startPlaybackWatchdog(video: HTMLVideoElement): void {
    if (this.contentType !== 'channels') return;

    this.lastObservedPlaybackTime = video.currentTime;
    this.noPlaybackProgressSince = Date.now();

    this.playbackWatchdogInterval = window.setInterval(() => {
      if (!this.hlsPlayer) return;

      // Solo actuar si el video debería estar reproduciéndose pero no avanza
      if (video.paused || video.ended) return;

      const hasProgress = video.currentTime > this.lastObservedPlaybackTime + 0.1;
      if (hasProgress) {
        this.lastObservedPlaybackTime = video.currentTime;
        this.noPlaybackProgressSince = Date.now();
        return;
      }

      const stuckForMs = Date.now() - this.noPlaybackProgressSince;
      if (stuckForMs >= 6000) {
        console.warn(`🐕 Watchdog: sin progreso por ${stuckForMs}ms, recuperando...`);
        this.triggerSoftLiveRecovery('sin progreso de reproduccion por 6s', video);
        this.noPlaybackProgressSince = Date.now();
        this.lastObservedPlaybackTime = video.currentTime;
      }
    }, 1000);
  }

  private trackLiveFragmentLoop(data: any, video: HTMLVideoElement): void {
    if (this.contentType !== 'channels') return;
    if (!this.hasRenderedFirstFrame || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (Date.now() - this.lastSoftRecoveryAt < 8000) return;

    const frag = data?.frag;
    if (!frag || frag.sn === 'initSegment') return;

    const fragId = `${frag.level ?? 'na'}:${frag.sn ?? 'na'}`;
    this.recentFragmentIds.push(fragId);

    // Ventana más grande para detectar el patrón de segment8.ts repetido
    if (this.recentFragmentIds.length > 12) {
      this.recentFragmentIds.shift();
    }

    if (this.recentFragmentIds.length < 5) return;

    const uniqueFragments = new Set(this.recentFragmentIds);

    // ← CLAVE: si el mismo segmento aparece 4+ veces seguidas, es el bug del servidor
    const lastFrag = this.recentFragmentIds[this.recentFragmentIds.length - 1];
    const consecutiveRepeats = [...this.recentFragmentIds]
    .reverse()
    .findIndex(f => f !== lastFrag);

    const realConsecutive = consecutiveRepeats === -1
      ? this.recentFragmentIds.length
      : consecutiveRepeats;

    if (realConsecutive >= 4) {
      console.warn(`🔁 Servidor atascado: segmento "${lastFrag}" repetido ${realConsecutive}x. Forzando reconexión completa.`);
      this.recentFragmentIds = [];

      // Reconexión completa, no soft recovery — el servidor necesita una nueva sesión
      this.retryCount = 0;
      this.reloadStream();
      return;
    }

    // Detección original: pocos fragmentos únicos en ventana grande
    if (uniqueFragments.size <= 2 && !video.paused) {
      this.triggerSoftLiveRecovery('bucle de segmentos repetidos detectado', video);
      this.recentFragmentIds = [];
    }
  }

  private initializePlayer(autoplay: boolean): void {
    if (this.isCasting) {
      console.log('⏸️ Inicializacion local omitida porque Chromecast esta activo');
      return;
    }

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

    this.clearHlsWatchdogs();
    this.removeVideoEventListeners();

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
      return {Hls};
    };

    const libs = checkLibs();

    // HLS.js is now the primary player for everything
    if (libs.Hls && libs.Hls.isSupported()) {
      console.log('✅ Usando HLS.js');
      this.initHlsPlayer(video, this.streamUrl, autoplay, savedMuted, savedVolume);
    } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('🍎 HLS nativo del navegador');
      video.src = this.streamUrl;
      video.muted = savedMuted;
      video.volume = savedVolume;
      video.load();
      this.playVideo(video, autoplay, savedMuted, savedVolume);
    } else {
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
          if (error.name === 'AbortError') {
            console.warn('Reproduccion interrumpida por una nueva carga de stream');
            return;
          }

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
      autoStartLoad: true,
      startPosition: -1,

      // ── ARRANQUE INMEDIATO ──────────────────────────────────────────
      // No esperar nada, reproducir con el primer segmento disponible
      lowLatencyMode: false,          // true causa más overhead con IPTV estándar
      initialLiveManifestSize: 1,     // parsear manifest con 1 entrada, no esperar más
      liveSyncDurationCount: 2,       // síncrono con el live edge tras 2 segmentos
      liveMaxLatencyDurationCount: isLiveContent ? 5 : 10,

      // ── BUFFER MÍN DE REPRODUCCIÓN ─────────────────────────────────
      // El clave: maxBufferLength bajo = empieza a reproducir antes
      // IPTV típico tiene segmentos de 2-4s, con 4s de buffer ya puede arrancar
      maxBufferLength: isLiveContent ? 4 : 30,         // era 6, bajamos más
      maxMaxBufferLength: isLiveContent ? 8 : 60,      // techo bajo para live
      backBufferLength: isLiveContent ? 0 : 30,        // 0 = no guardar nada atrás en live
      maxBufferSize: isLiveContent ? 20 * 1000 * 1000 : 60 * 1000 * 1000,
      maxBufferHole: 1.0,             // más tolerante a huecos → menos cortes

      // ── LIVE SYNC ──────────────────────────────────────────────────
      liveSyncMode: 'buffered',
      liveSyncOnStallIncrease: 1,
      maxLiveSyncPlaybackRate: 1.1,   // no acelerar mucho, causa audio raro

      // ── STALL RECOVERY ─────────────────────────────────────────────
      nudgeOffset: 0.5,               // salto más grande para superar huecos
      nudgeMaxRetry: 8,               // más reintentos de nudge antes de error
      nudgeOnVideoHole: true,
      highBufferWatchdogPeriod: 1,
      maxStarvationDelay: isLiveContent ? 2 : 4,
      maxLoadingDelay: isLiveContent ? 2 : 4,

      // ── ABR / CALIDAD ──────────────────────────────────────────────
      startLevel: 0,                  // ← CLAVE: empezar en calidad más baja siempre
      capLevelToPlayerSize: false,    // no limitar por tamaño, usar el mejor nivel disponible
      abrEwmaDefaultEstimate: 500000, // estimación conservadora inicial → elige calidad baja al inicio
      abrBandWidthFactor: 0.85,
      abrBandWidthUpFactor: 0.6,      // sube de calidad más despacio → menos rebuffering
      abrEwmaFastLive: 3,
      abrEwmaSlowLive: 9,
      abrEwmaFastVoD: 3,
      abrEwmaSlowVoD: 9,

      // ── CARGA DE FRAGMENTOS ────────────────────────────────────────
      startFragPrefetch: true,        // ← prefetch del siguiente frag mientras parsea manifest
      testBandwidth: false,           // no medir bandwidth al inicio, ahorra tiempo
      liveDurationInfinity: isLiveContent,

      // ── REINTENTOS ─────────────────────────────────────────────────
      manifestLoadingMaxRetry: 3,
      levelLoadingMaxRetry: 3,
      fragLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 500,
      levelLoadingRetryDelay: 500,
      fragLoadingRetryDelay: 500,
      fragLoadingMaxRetryTimeout: 10000,
    };

    this.hasManifestParsed = false;
    this.hasLevelDetails = false;
    this.hasBufferedFragment = false;
    this.hasRenderedFirstFrame = false;

    this.hlsPlayer = new Hls(hlsConfig);
    this.hlsPlayer.loadSource(url);
    this.hlsPlayer.attachMedia(video);
    this.logHlsStartupTrace('init', { url });

    if (isLiveContent) {
      this.startPlaybackWatchdog(video);
    }

    this.hlsPlayer.on(Hls.Events.MANIFEST_LOADED, (_event: any, data: any) => {
      this.logHlsStartupTrace('manifest-loaded', {
        levels: data?.levels?.length ?? 0,
        url: data?.url,
      });
    });

    this.hlsPlayer.on(Hls.Events.FRAG_LOADING, (_event: any, data: any) => {
      this.logHlsStartupTrace('frag-loading', {
        sn: data?.frag?.sn,
        level: data?.frag?.level,
        url: data?.frag?.url,
      });
    });

    this.hlsPlayer.on(Hls.Events.FRAG_LOADED, (event: any, data: any) => {
      this.logHlsStartupTrace('frag-loaded', {
        sn: data?.frag?.sn,
        level: data?.frag?.level,
        url: data?.frag?.url,
      });
      this.trackLiveFragmentLoop(data, video);
    });

    // ── CLAVE: reproducir en cuanto tengamos el nivel, no esperar más buffer ──
    this.hlsPlayer.on(Hls.Events.LEVEL_LOADED, (_event: any, data: any) => {
      this.hasLevelDetails = true;
      this.logHlsStartupTrace('level-loaded', {
        live: data?.details?.live,
        totalDuration: data?.details?.totalduration,
        fragments: data?.details?.fragments?.length,
      });
      this.startStartupWatchdog(video);

      if (!isLiveContent) return;

      // Si el video lleva más de 3s sin arrancar tras cargar el nivel, forzar play
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && video.paused) {
        console.log('▶️ LEVEL_LOADED: forzando play tras nivel cargado');
        video.play().catch(() => {
        });
      }
    });

    this.hlsPlayer.on(Hls.Events.FRAG_BUFFERED, (_event: any, _data: any) => {
      this.hasBufferedFragment = true;
      this.logHlsStartupTrace('frag-buffered', {
        readyState: video.readyState,
        currentTime: video.currentTime,
      });

      if (!isLiveContent) return;

      this.startStartupWatchdog(video);

      // En cuanto el primer fragmento está en buffer, intentar arrancar
      if (video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        console.log('▶️ FRAG_BUFFERED: primer fragmento listo, arrancando');
        video.play().catch(() => {
        });
      }
    });

    this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      this.hasManifestParsed = true;
      console.log('✅ HLS Manifest cargado');
      this.logHlsStartupTrace('manifest-parsed', {
        levels: this.hlsPlayer?.levels?.length ?? 0,
      });
      video.volume = volume;
      video.muted = wasMuted;
      this.startStartupWatchdog(video);
      this.playVideo(video, autoplay, wasMuted, volume);

      if (this.retryCount > 0 || this.hasError) {
        this.retryCount = 0;
        this.hasError = false;
        this.errorMessage = '';
        this.cdr.markForCheck();
      }
    });

    this.hlsPlayer.on(Hls.Events.ERROR, (event: any, data: any) => {
      this.logHlsStartupTrace('error', {
        type: data?.type,
        details: data?.details,
        fatal: data?.fatal,
        statusCode: data?.response?.code || data?.networkDetails?.status || data?.response?.statusCode,
      });
      const statusCode = data?.response?.code || data?.networkDetails?.status || data?.response?.statusCode;

      const isNonFatalGapError = !data?.fatal && [
        'bufferStalledError',
        'bufferSeekOverHole',
        'bufferNudgeOnStall',        // ← añadido: nudge no es fatal
      ].includes(data?.details);

      if (isNonFatalGapError) {
        console.warn('⚠️ HLS gap no fatal:', data?.details);
        this.isStreamLoading = false;
        this.cdr.markForCheck();
        return;
      }

      if (!data?.fatal && data?.type === Hls.ErrorTypes.MEDIA_ERROR) {
        console.warn('⚠️ HLS media error no fatal:', data?.details);
        this.isStreamLoading = false;
        this.cdr.markForCheck();
        return;
      }

      const shouldSoftRecoverLive = isLiveContent && !data?.fatal && [
        'fragLoadError',
        'fragLoadTimeout',
        'fragLoopLoadingError',
        'levelLoadError',
        'levelLoadTimeOut',
      ].includes(data?.details);

      if (shouldSoftRecoverLive) {
        this.triggerSoftLiveRecovery(`error HLS ${data?.details}`, video);
        return;
      }

      console.error('❌ HLS Error:', {
        type: data?.type,
        details: data?.details,
        fatal: data?.fatal,
        statusCode,
        retryCount: this.retryCount
      });

      const isRecoverableError = data?.type === Hls.ErrorTypes.NETWORK_ERROR ||
        data?.type === Hls.ErrorTypes.MEDIA_ERROR ||
        (statusCode && statusCode >= 400 && statusCode < 600);

      if (isRecoverableError && this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        const delay = 1500 * Math.pow(1.5, this.retryCount - 1);

        console.warn(`⚠️ Reintento ${this.retryCount}/${this.MAX_RETRIES} en ${delay}ms`);
        this.hasError = true;
        this.errorMessage = `Reconectando... (${this.retryCount}/${this.MAX_RETRIES})`;
        this.cdr.markForCheck();

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          this.hlsPlayer?.recoverMediaError();
          return;
        }

        if (this.retryTimeout) clearTimeout(this.retryTimeout);
        this.retryTimeout = window.setTimeout(() => {
          console.log(`🔄 Recargando stream (intento ${this.retryCount})...`);
          this.reloadStream();
        }, delay);

      } else if (this.retryCount >= this.MAX_RETRIES) {
        console.error('❌ Máximos reintentos alcanzados');
        this.hasError = true;
        this.errorMessage = 'Error de reproducción. Por favor, intenta de nuevo más tarde.';
        this.cdr.markForCheck();

        if (this.hlsPlayer) {
          try {
            this.hlsPlayer.destroy();
          } catch (e) {
          }
          this.hlsPlayer = null;
        }
      }
    });
  }

  private setupVideoEventListeners(video: HTMLVideoElement): void {
    if (!this.boundPlayHandler) {
      this.boundPlayHandler = () => {
        this.isPlaying = true;
        this.isStreamLoading = false;
        this.softRecoveryCount = 0;
        this.recentFragmentIds = [];
        if (video.videoWidth > 0) {
          this.hasRenderedFirstFrame = true;
        }
        if (this.startupWatchdogTimeout) {
          clearTimeout(this.startupWatchdogTimeout);
          this.startupWatchdogTimeout = undefined;
        }
        this.cdr.markForCheck();
      };
    }

    if (!this.boundPlayingHandler) {
      this.boundPlayingHandler = () => {
        this.isPlaying = true;
        this.isStreamLoading = false;
        this.softRecoveryCount = 0;
        this.recentFragmentIds = [];
        this.hasRenderedFirstFrame = true;
        if (this.startupWatchdogTimeout) {
          clearTimeout(this.startupWatchdogTimeout);
          this.startupWatchdogTimeout = undefined;
        }
        this.cdr.markForCheck();
      };
    }

    if (!this.boundPauseHandler) {
      this.boundPauseHandler = () => {
        this.isPlaying = false;
        this.cdr.markForCheck();
      };
    }

    if (!this.boundVolumeChangeHandler) {
      this.boundVolumeChangeHandler = () => {
        this.volume = video.volume;
        this.isMuted = video.muted;
        this.cdr.markForCheck();
      };
    }

    if (!this.boundWaitingHandler) {
      this.boundWaitingHandler = () => {
        console.log('Video en espera...');
        this.isStreamLoading = true;
        this.cdr.markForCheck();
      };
    }

    if (!this.boundCanPlayHandler) {
      this.boundCanPlayHandler = () => {
        this.isStreamLoading = false;
        if (this.retryCount > 0 || this.hasError) {
          console.log('✅ Video canplay, reseteando estado');
          this.retryCount = 0;
          this.hasError = false;
          this.errorMessage = '';
          this.cdr.markForCheck();
        }
      };
    }

    if (!this.boundCoreLoadedDataHandler) {
      this.boundCoreLoadedDataHandler = () => {
        this.isStreamLoading = false;
        if (video.videoWidth > 0 || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          this.hasRenderedFirstFrame = true;
        }
        if (this.startupWatchdogTimeout) {
          clearTimeout(this.startupWatchdogTimeout);
          this.startupWatchdogTimeout = undefined;
        }
        if (this.retryCount > 0 || this.hasError) {
          console.log('✅ Video loadeddata, reseteando estado');
          this.retryCount = 0;
          this.hasError = false;
          this.errorMessage = '';
          this.cdr.markForCheck();
        }
      };
    }

    if (!this.boundVideoErrorHandler) {
      this.boundVideoErrorHandler = () => {
        const errorCode = (video.error as MediaError | null)?.code;
        const videoErrorMessage = video.error?.message;
        const networkState = video.networkState;

        console.error('Error en video element:', {
          code: errorCode,
          message: videoErrorMessage,
          networkState: networkState,
          retryCount: this.retryCount
        });

        if (errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
          errorCode === MediaError.MEDIA_ERR_DECODE) {

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
          this.errorMessage = `Error: ${videoErrorMessage || 'Error desconocido'}`;
          this.cdr.markForCheck();
        }
      };
    }

    if (!this.coreVideoListenersAttached) {
      video.addEventListener('play', this.boundPlayHandler);
      video.addEventListener('playing', this.boundPlayingHandler);
      video.addEventListener('pause', this.boundPauseHandler);
      video.addEventListener('volumechange', this.boundVolumeChangeHandler);
      video.addEventListener('waiting', this.boundWaitingHandler);
      video.addEventListener('canplay', this.boundCanPlayHandler);
      video.addEventListener('loadeddata', this.boundCoreLoadedDataHandler);
      video.addEventListener('error', this.boundVideoErrorHandler);
      this.coreVideoListenersAttached = true;
    }

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
    if (this.isCasting) {
      console.log('⏸️ Recarga local omitida porque Chromecast esta activo');
      return;
    }

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

  private initializeCastApi(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (this.isCastFrameworkReady()) {
      this.setupCastContext();
      return;
    }

    this.previousGCastApiAvailableHandler = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      this.previousGCastApiAvailableHandler?.(isAvailable);

      if (isAvailable && this.isCastFrameworkReady()) {
        this.setupCastContext();
        return;
      }

      if (isAvailable) {
        window.setTimeout(() => {
          if (this.isCastFrameworkReady()) {
            this.setupCastContext();
            return;
          }

          this.isCastSupported = false;
          this.canCast = false;
          this.isCasting = false;
          this.isCastConnecting = false;
          this.cdr.markForCheck();
        }, 0);
        return;
      }

      this.isCastSupported = false;
      this.canCast = false;
      this.isCasting = false;
      this.isCastConnecting = false;
      this.cdr.markForCheck();
    };
  }

  private setupCastContext(): void {
    try {
      const castFramework = this.getCastFramework();
      const chromeCast = this.getChromeCast();

      if (!castFramework || !chromeCast) {
        return;
      }

      this.isCastSupported = true;

      const castContext = castFramework.CastContext.getInstance();
      castContext.setOptions({
        receiverApplicationId: chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED
      });

      if (this.castStateChangedHandler) {
        castContext.removeEventListener(
          castFramework.CastContextEventType.CAST_STATE_CHANGED,
          this.castStateChangedHandler
        );
      }

      this.castStateChangedHandler = (event: cast.framework.CastStateEventData) => {
        this.updateCastState(event.castState);
      };

      castContext.addEventListener(
        castFramework.CastContextEventType.CAST_STATE_CHANGED,
        this.castStateChangedHandler
      );

      const hasActiveSession = !!castContext.getCurrentSession();
      this.updateCastState(
        hasActiveSession ? castFramework.CastState.CONNECTED : castFramework.CastState.NOT_CONNECTED
      );
    } catch (error) {
      console.error('Error inicializando Chromecast:', error);
      this.isCastSupported = false;
      this.canCast = false;
      this.isCasting = false;
      this.isCastConnecting = false;
      this.cdr.markForCheck();
    }
  }

  private teardownCastApi(): void {
    if (typeof window !== 'undefined' && window.__onGCastApiAvailable === this.previousGCastApiAvailableHandler) {
      return;
    }

    if (typeof window !== 'undefined') {
      window.__onGCastApiAvailable = this.previousGCastApiAvailableHandler;
    }

    const castFramework = this.getCastFramework();

    if (this.castStateChangedHandler && castFramework) {
      castFramework.CastContext.getInstance().removeEventListener(
        castFramework.CastContextEventType.CAST_STATE_CHANGED,
        this.castStateChangedHandler
      );
    }
  }

  private updateCastState(castState: cast.framework.CastState): void {
    this.isCastSupported = true;
    this.canCast = castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE;
    this.isCastConnecting = castState === cast.framework.CastState.CONNECTING;
    const wasCasting = this.isCasting;
    this.isCasting = castState === cast.framework.CastState.CONNECTED;

    if (this.isCasting && !wasCasting) {
      this.stopLocalPlaybackForCast();
    } else if (!this.isCasting && wasCasting) {
      this.resumeLocalPlaybackAfterCast();
    }

    if (castState !== cast.framework.CastState.CONNECTED) {
      this.castError = '';
    }

    this.cdr.markForCheck();
  }

  async castCurrentStream(): Promise<void> {
    const castFramework = this.getCastFramework();
    if (!this.streamUrl) {
      return;
    }

    if (!castFramework || !this.getChromeCast()) {
      this.castError = 'Chromecast no esta disponible en este navegador';
      this.cdr.markForCheck();
      return;
    }

    if (this.isCasting) {
      this.disconnectCastSession();
      return;
    }

    this.castError = '';
    this.isCastConnecting = true;
    this.cdr.markForCheck();

    try {
      const castUrl = this.getCastStreamUrl();
      console.log('Chromecast load request:', {
        castUrl,
        contentType: this.getCastContentType(castUrl),
        title: this.eventTitle || this.currentItem?.nombre || 'WalacTV'
      });

      const castContext = castFramework.CastContext.getInstance();

      if (!castContext.getCurrentSession()) {
        await castContext.requestSession();
      }

      const session = castContext.getCurrentSession();
      if (!session) {
        throw new Error('No se pudo conectar con el dispositivo');
      }

      await session.loadMedia(this.buildCastLoadRequest());

      this.isCasting = true;
      this.stopLocalPlaybackForCast();
    } catch (error) {
      const castError = error as {
        code?: string;
        description?: string;
        details?: unknown
      } | undefined;
      const serializedDetails = (() => {
        try {
          return JSON.stringify(castError?.details ?? null);
        } catch {
          return String(castError?.details ?? '');
        }
      })();

      console.error('Error enviando a Chromecast:', {
        raw: error,
        code: castError?.code,
        description: castError?.description,
        details: castError?.details
      });
      this.castError = castError?.code
        ? `Chromecast: ${castError.code}${castError?.description ? ` - ${castError.description}` : ''}${serializedDetails && serializedDetails !== 'null' ? ` (${serializedDetails})` : ''}`
        : 'No se pudo iniciar Chromecast';
    } finally {
      this.isCastConnecting = false;
      this.cdr.markForCheck();
    }
  }

  private disconnectCastSession(): void {
    const castFramework = this.getCastFramework();
    if (!castFramework) {
      return;
    }

    try {
      castFramework.CastContext.getInstance().endCurrentSession(true);
      this.isCasting = false;
      this.isCastConnecting = false;
      this.castError = '';
      this.resumeLocalPlaybackAfterCast();
    } catch (error) {
      console.error('Error desconectando Chromecast:', error);
      this.castError = 'No se pudo desconectar Chromecast';
    } finally {
      this.cdr.markForCheck();
    }
  }

  private buildCastLoadRequest(): chrome.cast.media.LoadRequest {
    const castUrl = this.getCastStreamUrl();
    const mediaInfo = new chrome.cast.media.MediaInfo(castUrl, 'application/x-mpegURL');

    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;

    const metadata = new chrome.cast.media.GenericMediaMetadata();
    metadata.title = this.eventTitle || this.currentItem?.nombre || 'WalacTV';
    mediaInfo.metadata = metadata;

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    return request;
  }

  private stopLocalPlaybackForCast(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = undefined;
    }

    this.clearHlsWatchdogs();

    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.stopLoad?.();
        this.hlsPlayer.detachMedia?.();
        this.hlsPlayer.destroy();
      } catch (error) {
        console.warn('Error deteniendo HLS local para Chromecast:', error);
      }
      this.hlsPlayer = null;
    }

    const video = this.videoElement?.nativeElement;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    this.isPlaying = false;
    this.isStreamLoading = false;
    this.hasError = false;
    this.errorMessage = '';
  }

  private resumeLocalPlaybackAfterCast(): void {
    if (!this.streamUrl || !this.videoElement) {
      return;
    }

    if (this.hlsPlayer) {
      return;
    }

    this.retryCount = 0;
    this.hasError = false;
    this.errorMessage = '';
    this.isStreamLoading = true;

    window.setTimeout(() => {
      if (!this.isCasting) {
        this.initializePlayer(true);
      }
    }, 0);
  }

  private getCastStreamUrl(): string {
    if (this.castTestUrlOverride) {
      return this.castTestUrlOverride;
    }

    if (this.contentType !== 'channels') {
      return this.streamUrl;
    }

    const username = localStorage.getItem('iptv_username') || '';
    const password = localStorage.getItem('iptv_password') || '';
    const streamId = this.extractStreamIdFromUrl(this.streamUrl);

    if (!username || !password || !streamId) {
      return this.streamUrl;
    }

    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    const encodedStreamId = encodeURIComponent(streamId);

    return `https://iptv.walerike.com/cast/${encodedUsername}/${encodedPassword}/${encodedStreamId}/playlist.m3u8`;
  }

  private extractStreamIdFromUrl(url: string): string {
    const cleanUrl = url.split('?')[0];
    const segments = cleanUrl.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';

    return lastSegment.replace(/\.(ts|m3u8|mp4|mkv|avi)$/i, '');
  }

  private getCastContentType(url: string): string {
    const normalizedUrl = url.toLowerCase();
    const extension = this.currentExtension.toLowerCase();

    if (normalizedUrl.includes('.m3u8') || extension === '.m3u8' || (this.contentType === 'channels' && !extension)) {
      return 'application/x-mpegURL';
    }

    if (normalizedUrl.includes('.ts') || extension === '.ts') {
      return 'video/mp2t';
    }

    if (normalizedUrl.includes('.mkv') || extension === '.mkv') {
      return 'video/x-matroska';
    }

    if (normalizedUrl.includes('.avi') || extension === '.avi') {
      return 'video/x-msvideo';
    }

    return 'video/mp4';
  }

  private initializeCastTestOverride(): void {
    const castTestUrl = this.route.snapshot.queryParamMap.get('castTestUrl');
    if (castTestUrl) {
      this.castTestUrlOverride = castTestUrl;
      return;
    }

    const castTestEnabled = this.route.snapshot.queryParamMap.get('castTest') === '1';
    if (castTestEnabled) {
      this.castTestUrlOverride = this.DEFAULT_CAST_TEST_URL;
    }
  }

  private isCastFrameworkReady(): boolean {
    return !!this.getCastFramework() && !!this.getChromeCast();
  }

  private getCastFramework(): typeof cast.framework | null {
    return (window as any).cast?.framework ?? null;
  }

  private getChromeCast(): typeof chrome.cast | null {
    return (window as any).chrome?.cast ?? null;
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
