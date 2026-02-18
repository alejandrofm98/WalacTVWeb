import {Component, OnInit, inject, ElementRef, ViewChild, AfterViewInit, HostListener} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Router} from '@angular/router';
import {FormsModule} from '@angular/forms';
import {DataService, IptvChannel, PaginatedResponse, ContentStats} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';
import {HttpsPipe} from '../../pipes/https.pipe';
import {NumberFormatPipe} from '../../pipes/number-format.pipe';
import {Subject} from 'rxjs';
import {debounceTime, distinctUntilChanged} from 'rxjs/operators';

@Component({
  selector: 'app-channels',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, HttpsPipe, NumberFormatPipe],
  templateUrl: './channels.component.html',
  styleUrls: ['./channels.component.css']
})
export class ChannelsComponent implements OnInit, AfterViewInit {
  @ViewChild('loadMoreTrigger') loadMoreTrigger!: ElementRef;
  @ViewChild('countrySearchInput') countrySearchInput!: ElementRef;
  @ViewChild('groupSearchInput') groupSearchInput!: ElementRef;

  channels: IptvChannel[] = [];
  loading = false;
  error: string | null = null;

  channelsTotal = 0;

  channelsPage = 1;
  limit = 40; // Reducido de 80 a 40 para carga más rápida

  hasMoreChannels = true;

  selectedGroup = '';
  selectedCountry = '';
  groups: string[] = [];
  countries: {code: string, name: string}[] = [];

  searchQuery = '';
  private searchSubject = new Subject<string>();

  // Searchable select properties
  isCountryOpen = false;
  isGroupOpen = false;
  countrySearch = '';
  groupSearch = '';

  private dataService = inject(DataService);
  private router = inject(Router);
  private playerState = inject(PlayerStateService);
  private observer: IntersectionObserver | null = null;

  ngOnInit() {
    this.loadContentStats();
    this.loadFilters();
    this.loadContent();

    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(query => {
      this.performSearch(query);
    });
  }

  private loadContentStats(): void {
    this.dataService.getContentStats().subscribe({
      next: (stats: ContentStats) => {
        this.channelsTotal = stats.channels;
      },
      error: (error) => {
        console.error('Error loading content stats:', error);
      }
    });
  }

  ngAfterViewInit() {
    this.setupInfiniteScroll();
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private setupInfiniteScroll() {
    const options = {
      root: null,
      rootMargin: '100px',
      threshold: 0.1
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.loading) {
          if (this.hasMoreChannels) {
            this.loadMoreChannels();
          }
        }
      });
    }, options);

    if (this.loadMoreTrigger?.nativeElement) {
      this.observer.observe(this.loadMoreTrigger.nativeElement);
    }
  }

  loadFilters() {
    this.loadGroups();
    this.dataService.getCountries('channels').subscribe({
      next: (countries) => this.countries = countries.map(c => ({code: c.code, name: c.name}))
    });
  }

  onFilterChange() {
    this.channelsPage = 1;
    this.loadContent();
  }

  onCountryChange() {
    this.selectedGroup = '';
    this.channelsPage = 1;
    this.loadGroups();
    this.loadContent();
  }

  private loadGroups(): void {
    this.dataService.getGroups('channels', this.selectedCountry || undefined).subscribe({
      next: (groups) => this.groups = groups
    });
  }

  clearFilters() {
    this.selectedGroup = '';
    this.selectedCountry = '';
    this.countrySearch = '';
    this.groupSearch = '';
    this.isCountryOpen = false;
    this.isGroupOpen = false;
    this.channelsPage = 1;
    this.loadGroups();
    this.loadContent();
  }

  onSearchInput(query: string) {
    this.searchQuery = query;
    this.searchSubject.next(query);
  }

  performSearch(query: string) {
    this.channelsPage = 1;
    this.loadContent();
  }

  clearSearch() {
    this.searchQuery = '';
    this.channelsPage = 1;
    this.loadContent();
  }

  getSearchPlaceholder(): string {
    return 'Buscar canales por nombre o grupo...';
  }

  loadContent() {
    this.loading = true;
    this.error = null;
    this.channelsPage = 1;
    this.loadMoreChannels(true);
  }

  loadMoreChannels(reset: boolean = false) {
    if (reset) {
      this.channels = [];
    }

    this.dataService.getChannels(this.channelsPage, this.limit, this.selectedGroup, this.selectedCountry, this.searchQuery).subscribe({
      next: (response: PaginatedResponse<IptvChannel>) => {
        this.channels = [...this.channels, ...response.items];
        this.channelsTotal = response.total;
        this.channelsPage += 1;
        this.hasMoreChannels = response.has_next;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.message || 'Error al cargar canales';
        console.error('Error loading channels:', err);
        this.loading = false;
      }
    });
  }

  onChannelClick(channel: IptvChannel) {
    this.playerState.setChannel(channel);
    this.router.navigate(['/player', slugify(channel.nombre)]);
  }

  getPosterUrl(item: IptvChannel): string {
    return item.logo || '';
  }

  getCategories(item: IptvChannel): string {
    return item.grupo || '';
  }

  get totalItems(): number {
    return this.channelsTotal;
  }

  get displayedItems(): number {
    return this.channels.length;
  }

  // Searchable select getters
  get filteredCountries(): {code: string, name: string}[] {
    if (!this.countrySearch) return this.countries;
    const search = this.countrySearch.toLowerCase();
    return this.countries.filter(c => c.name.toLowerCase().includes(search));
  }

  get filteredGroups(): string[] {
    if (!this.groupSearch) return this.groups;
    const search = this.groupSearch.toLowerCase();
    return this.groups.filter(g => g.toLowerCase().includes(search));
  }

  getCountryName(code: string): string {
    const country = this.countries.find(c => c.code === code);
    return country?.name || code;
  }

  // Searchable select methods
  toggleCountry(): void {
    this.isCountryOpen = !this.isCountryOpen;
    if (this.isCountryOpen) {
      this.isGroupOpen = false;
      this.countrySearch = '';
      setTimeout(() => {
        this.countrySearchInput?.nativeElement?.focus();
      }, 50);
    }
  }

  toggleGroup(): void {
    this.isGroupOpen = !this.isGroupOpen;
    if (this.isGroupOpen) {
      this.isCountryOpen = false;
      this.groupSearch = '';
      setTimeout(() => {
        this.groupSearchInput?.nativeElement?.focus();
      }, 50);
    }
  }

  onCountryKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const firstCountry = this.filteredCountries[0];
      if (firstCountry) {
        this.selectCountry(firstCountry.code);
      }
    }
  }

  onGroupKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const firstGroup = this.filteredGroups[0];
      if (firstGroup) {
        this.selectGroup(firstGroup);
      }
    }
  }

  selectCountry(code: string): void {
    this.selectedCountry = code;
    this.isCountryOpen = false;
    this.countrySearch = '';
    this.onCountryChange();
  }

  selectGroup(group: string): void {
    this.selectedGroup = group;
    this.isGroupOpen = false;
    this.groupSearch = '';
    this.onFilterChange();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.searchable-select')) {
      this.isCountryOpen = false;
      this.isGroupOpen = false;
    }
  }
}
