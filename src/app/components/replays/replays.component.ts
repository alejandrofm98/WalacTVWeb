import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { NavbarComponent } from '../../shared/components/navbar-component/navbar.component';
import { NumberFormatPipe } from '../../pipes/number-format.pipe';
import { DataService, ContentStats, IptvReplay, PaginatedResponse } from '../../services/data.service';

type ReplayEventType = '' | 'numbered' | 'fight_night' | 'other';

interface EventTypeOption {
  value: ReplayEventType;
  label: string;
}

export interface IptvReplayViewModel extends IptvReplay {
  eventTypeLabel: string;
  sourceCount: number;
  groupNames: string;
  primaryDescription: string;
}

@Component({
  selector: 'app-replays',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, NumberFormatPipe],
  templateUrl: './replays.component.html',
  styleUrls: ['./replays.component.css'],
})
export class ReplaysComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('loadMoreTrigger') loadMoreTrigger!: ElementRef;
  @ViewChild('eventTypeSearchInput') eventTypeSearchInput!: ElementRef;
  @ViewChild('eventTypeOptionsList') eventTypeOptionsList!: ElementRef;

  replays: IptvReplayViewModel[] = [];
  skeletonItems = Array(6).fill(0);
  loading = false;
  error: string | null = null;

  replaysTotal = 0;
  replaysPage = 1;
  limit = 24;
  hasMoreReplays = true;

  selectedEventType: ReplayEventType = '';
  searchQuery = '';

  // Searchable select state
  isEventTypeOpen = false;
  eventTypeSearch = '';
  highlightedEventTypeIndex = -1;

  readonly eventTypeOptions: EventTypeOption[] = [
    { value: 'numbered', label: 'Numerados UFC' },
    { value: 'fight_night', label: 'Fight Night' },
    { value: 'other', label: 'Otros' },
  ];

  private readonly searchSubject = new Subject<string>();
  private readonly dataService = inject(DataService);
  private readonly router = inject(Router);
  private observer: IntersectionObserver | null = null;

  ngOnInit(): void {
    this.loadContentStats();
    this.loadContent();

    this.searchSubject.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => {
      this.replaysPage = 1;
      this.loadContent();
    });
  }

  ngAfterViewInit(): void {
    this.setupInfiniteScroll();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private loadContentStats(): void {
    this.dataService.getContentStats().subscribe({
      next: (stats: ContentStats) => {
        this.replaysTotal = stats.replays;
      },
    });
  }

  private setupInfiniteScroll(): void {
    const options = {
      root: null,
      rootMargin: '100px',
      threshold: 0.1,
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !this.loading && this.hasMoreReplays) {
          this.loadMoreReplays();
        }
      });
    }, options);

    if (this.loadMoreTrigger?.nativeElement) {
      this.observer.observe(this.loadMoreTrigger.nativeElement);
    }
  }

  loadContent(): void {
    this.loading = true;
    this.error = null;
    this.replaysPage = 1;
    this.loadMoreReplays(true);
  }

  loadMoreReplays(reset: boolean = false): void {
    if (reset) {
      this.replays = [];
    }

    this.dataService
      .getReplays(this.replaysPage, this.limit, this.selectedEventType || undefined, this.searchQuery)
      .subscribe({
        next: (response: PaginatedResponse<IptvReplay>) => {
          const mappedItems: IptvReplayViewModel[] = response.items.map((replay) => ({
            ...replay,
            eventTypeLabel: this.getEventTypeLabel(replay.event_type),
            sourceCount: this.getSourceCount(replay),
            groupNames: this.getGroupNames(replay),
            primaryDescription: this.getPrimaryDescription(replay),
          }));
          this.replays = [...this.replays, ...mappedItems];
          this.replaysTotal = response.total;
          this.replaysPage += 1;
          this.hasMoreReplays = response.has_next;
          this.loading = false;
        },
        error: (err: Error) => {
          this.error = err.message || 'Error al cargar replays';
          this.loading = false;
        },
      });
  }

  onSearchInput(query: string): void {
    this.searchQuery = query;
    this.searchSubject.next(query);
  }

  onEventTypeChange(): void {
    this.replaysPage = 1;
    this.loadContent();
  }

  clearFilters(): void {
    this.selectedEventType = '';
    this.searchQuery = '';
    this.eventTypeSearch = '';
    this.isEventTypeOpen = false;
    this.replaysPage = 1;
    this.loadContent();
  }

  openReplay(replay: IptvReplay): void {
    this.router.navigate(['/replays', replay.slug]);
  }

  trackByReplay(index: number, replay: IptvReplayViewModel): string | number {
    return replay.slug || index;
  }

  trackByIndex(index: number): number {
    return index;
  }

  getEventTypeLabel(eventType?: string | null): string {
    switch (eventType) {
      case 'numbered':
        return 'Numerado';
      case 'fight_night':
        return 'Fight Night';
      case 'other':
        return 'Otro';
      default:
        return 'Replay';
    }
  }

  getSourceCount(replay: IptvReplay): number {
    return (replay.video_sources || []).reduce((total, group) => total + group.sources.length, 0);
  }

  getGroupNames(replay: IptvReplay): string {
    return (replay.video_sources || [])
      .map((group) => group.group)
      .slice(0, 3)
      .join(' · ');
  }

  getPrimaryDescription(replay: IptvReplay): string {
    return replay.description || 'Replay UFC disponible';
  }

  get displayedItems(): number {
    return this.replays.length;
  }

  // --- Searchable select: event type ---

  get selectedEventTypeLabel(): string {
    if (!this.selectedEventType) {
      return 'Todos los tipos';
    }
    const found = this.eventTypeOptions.find((o) => o.value === this.selectedEventType);
    return found?.label || 'Todos los tipos';
  }

  get filteredEventTypes(): EventTypeOption[] {
    if (!this.eventTypeSearch) {
      return this.eventTypeOptions;
    }
    const search = this.eventTypeSearch.toLowerCase();
    return this.eventTypeOptions.filter((o) => o.label.toLowerCase().includes(search));
  }

  toggleEventType(): void {
    this.isEventTypeOpen = !this.isEventTypeOpen;
    if (this.isEventTypeOpen) {
      this.eventTypeSearch = '';
      this.highlightedEventTypeIndex = -1;
      setTimeout(() => {
        this.eventTypeSearchInput?.nativeElement?.focus();
      }, 50);
    }
  }

  selectEventType(value: ReplayEventType): void {
    this.selectedEventType = value;
    this.isEventTypeOpen = false;
    this.eventTypeSearch = '';
    this.onEventTypeChange();
  }

  onEventTypeKeydown(event: KeyboardEvent): void {
    const options = this.filteredEventTypes;
    const totalOptions = options.length + 1; // +1 for "Todos los tipos"

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedEventTypeIndex = Math.min(this.highlightedEventTypeIndex + 1, totalOptions - 1);
      this.scrollToEventTypeOption();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedEventTypeIndex = Math.max(this.highlightedEventTypeIndex - 1, 0);
      this.scrollToEventTypeOption();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.highlightedEventTypeIndex === 0) {
        this.selectEventType('');
      } else if (this.highlightedEventTypeIndex > 0 && options[this.highlightedEventTypeIndex - 1]) {
        this.selectEventType(options[this.highlightedEventTypeIndex - 1].value);
      } else if (options.length > 0) {
        this.selectEventType(options[0].value);
      }
    } else if (event.key === 'Escape') {
      this.isEventTypeOpen = false;
    }
  }

  private scrollToEventTypeOption(): void {
    if (!this.eventTypeOptionsList?.nativeElement) {
      return;
    }
    const opts = this.eventTypeOptionsList.nativeElement.querySelectorAll('.select-option');
    if (opts[this.highlightedEventTypeIndex]) {
      opts[this.highlightedEventTypeIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.searchable-select')) {
      this.isEventTypeOpen = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.isEventTypeOpen = false;
  }
}
