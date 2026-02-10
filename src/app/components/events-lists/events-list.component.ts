import {Component, OnInit, inject, ElementRef, ViewChild, AfterViewInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Router} from '@angular/router';
import {FormsModule} from '@angular/forms';
import {DataService, IptvChannel, IptvMovie, IptvSeries, PaginatedResponse, ContentStats} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';
import {HttpsPipe} from '../../pipes/https.pipe';
import {NumberFormatPipe} from '../../pipes/number-format.pipe';
import {Subject} from 'rxjs';
import {debounceTime, distinctUntilChanged} from 'rxjs/operators';

type TabType = 'channels' | 'movies' | 'series';

@Component({
  selector: 'app-events-list',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, HttpsPipe, NumberFormatPipe],
  templateUrl: './events-list.component.html',
  styleUrls: ['./events-list.component.css']
})
export class EventsListComponent implements OnInit, AfterViewInit {
  @ViewChild('loadMoreTrigger') loadMoreTrigger!: ElementRef;

  channels: IptvChannel[] = [];
  movies: IptvMovie[] = [];
  series: IptvSeries[] = [];
  loading = false;
  error: string | null = null;
  activeTab: TabType = 'channels';

  channelsTotal = 0;
  moviesTotal = 0;
  seriesTotal = 0;

  channelsPage = 1;
  moviesPage = 1;
  seriesPage = 1;
  limit = 80;

  hasMoreChannels = true;
  hasMoreMovies = true;
  hasMoreSeries = true;

  selectedGroup = '';
  selectedCountry = '';
  groups: string[] = [];
  countries: string[] = [];

  searchQuery = '';
  private searchSubject = new Subject<string>();

  private dataService = inject(DataService);
  private router = inject(Router);
  private playerState = inject(PlayerStateService);
  private observer: IntersectionObserver | null = null;

  ngOnInit() {
    this.loadContentStats();
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
        this.moviesTotal = stats.movies;
        this.seriesTotal = stats.series;
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
          if (this.activeTab === 'channels' && this.hasMoreChannels) {
            this.loadMoreChannels();
          } else if (this.activeTab === 'movies' && this.hasMoreMovies) {
            this.loadMoreMovies();
          } else if (this.activeTab === 'series' && this.hasMoreSeries) {
            this.loadMoreSeries();
          }
        }
      });
    }, options);

    if (this.loadMoreTrigger?.nativeElement) {
      this.observer.observe(this.loadMoreTrigger.nativeElement);
    }
  }

  switchTab(tab: TabType) {
    this.activeTab = tab;
    this.channelsPage = 1;
    this.moviesPage = 1;
    this.seriesPage = 1;
    this.channels = [];
    this.movies = [];
    this.series = [];
    this.loadFilters();
    this.loadContent();
  }

  loadFilters() {
    this.dataService.getGroups(this.activeTab).subscribe({
      next: (groups) => this.groups = groups
    });
    this.dataService.getCountries(this.activeTab).subscribe({
      next: (countries) => this.countries = countries.map(c => c.name)
    });
  }

  onFilterChange() {
    this.channelsPage = 1;
    this.moviesPage = 1;
    this.seriesPage = 1;
    this.loadContent();
  }

  clearFilters() {
    this.selectedGroup = '';
    this.selectedCountry = '';
    this.channelsPage = 1;
    this.moviesPage = 1;
    this.seriesPage = 1;
    this.loadContent();
  }

  onSearchInput(query: string) {
    this.searchQuery = query;
    this.searchSubject.next(query);
  }

  performSearch(query: string) {
    this.channelsPage = 1;
    this.moviesPage = 1;
    this.seriesPage = 1;
    this.loadContent();
  }

  clearSearch() {
    this.searchQuery = '';
    this.channelsPage = 1;
    this.moviesPage = 1;
    this.seriesPage = 1;
    this.loadContent();
  }

  getSearchPlaceholder(): string {
    switch (this.activeTab) {
      case 'channels': return 'Buscar canales por nombre o grupo...';
      case 'movies': return 'Buscar películas por nombre o grupo...';
      case 'series': return 'Buscar series por nombre o grupo...';
      default: return 'Buscar...';
    }
  }

  loadContent() {
    this.loading = true;
    this.error = null;

    if (this.activeTab === 'channels') {
      this.channelsPage = 1;
      this.loadMoreChannels(true);
    } else if (this.activeTab === 'movies') {
      this.moviesPage = 1;
      this.loadMoreMovies(true);
    } else {
      this.seriesPage = 1;
      this.loadMoreSeries(true);
    }
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

  loadMoreMovies(reset: boolean = false) {
    if (reset) {
      this.movies = [];
    }

    this.dataService.getMovies(this.moviesPage, this.limit, this.selectedGroup, this.selectedCountry, this.searchQuery).subscribe({
      next: (response: PaginatedResponse<IptvMovie>) => {
        this.movies = [...this.movies, ...response.items];
        this.moviesTotal = response.total;
        this.moviesPage += 1;
        this.hasMoreMovies = response.has_next;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.message || 'Error al cargar películas';
        console.error('Error loading movies:', err);
        this.loading = false;
      }
    });
  }

  loadMoreSeries(reset: boolean = false) {
    if (reset) {
      this.series = [];
    }

    this.dataService.getSeries(this.seriesPage, this.limit, this.selectedGroup, this.selectedCountry, this.searchQuery).subscribe({
      next: (response: PaginatedResponse<IptvSeries>) => {
        this.series = [...this.series, ...response.items];
        this.seriesTotal = response.total;
        this.seriesPage += 1;
        this.hasMoreSeries = response.has_next;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.message || 'Error al cargar series';
        console.error('Error loading series:', err);
        this.loading = false;
      }
    });
  }

  onChannelClick(channel: IptvChannel) {
    this.playerState.setChannel(channel);
    this.router.navigate(['/player', slugify(channel.nombre)]);
  }

  onMovieClick(movie: IptvMovie) {
    this.playerState.setMovie(movie);
    this.router.navigate(['/player', slugify(movie.nombre)]);
  }

  onSeriesClick(series: IptvSeries) {
    this.playerState.setSeries(series);
    this.router.navigate(['/player', slugify(series.nombre)]);
  }

  getPosterUrl(item: IptvChannel | IptvMovie | IptvSeries): string {
    return item.logo || '';
  }

  getCategories(item: IptvChannel | IptvMovie | IptvSeries): string {
    return item.grupo || '';
  }

  get totalItems(): number {
    switch (this.activeTab) {
      case 'channels': return this.channelsTotal;
      case 'movies': return this.moviesTotal;
      case 'series': return this.seriesTotal;
      default: return 0;
    }
  }

  get displayedItems(): number {
    switch (this.activeTab) {
      case 'channels': return this.channels.length;
      case 'movies': return this.movies.length;
      case 'series': return this.series.length;
      default: return 0;
    }
  }
}
