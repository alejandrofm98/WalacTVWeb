import {Component, OnInit, inject, ElementRef, ViewChild, AfterViewInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Router} from '@angular/router';
import {DataService, IptvChannel, IptvMovie, IptvSeries, PaginatedResponse} from '../../services/data.service';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';
import {HttpsPipe} from '../../pipes/https.pipe';

type TabType = 'channels' | 'movies' | 'series';

@Component({
  selector: 'app-events-list',
  standalone: true,
  imports: [CommonModule, NavbarComponent, HttpsPipe],
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

  channelsSkip = 0;
  moviesSkip = 0;
  seriesSkip = 0;
  limit = 50;

  hasMoreChannels = true;
  hasMoreMovies = true;
  hasMoreSeries = true;

  private dataService = inject(DataService);
  private router = inject(Router);
  private observer: IntersectionObserver | null = null;

  ngOnInit() {
    this.loadCounts();
    this.loadContent();
  }

  ngAfterViewInit() {
    this.setupInfiniteScroll();
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private loadCounts() {
    this.dataService.getCounts().subscribe({
      next: (counts) => {
        this.channelsTotal = counts.channels;
        this.moviesTotal = counts.movies;
        this.seriesTotal = counts.series;
      },
      error: (err) => console.error('Error loading counts:', err)
    });
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
    this.setupInfiniteScroll();
  }

  loadContent() {
    this.loading = true;
    this.error = null;

    if (this.activeTab === 'channels') {
      this.channelsSkip = 0;
      this.loadMoreChannels(true);
    } else if (this.activeTab === 'movies') {
      this.moviesSkip = 0;
      this.loadMoreMovies(true);
    } else {
      this.seriesSkip = 0;
      this.loadMoreSeries(true);
    }
  }

  loadMoreChannels(reset: boolean = false) {
    if (reset) {
      this.channels = [];
    }

    this.dataService.getChannels(this.channelsSkip, this.limit).subscribe({
      next: (response: PaginatedResponse<IptvChannel>) => {
        this.channels = [...this.channels, ...response.items];
        this.channelsTotal = response.total;
        this.channelsSkip += response.items.length;
        this.hasMoreChannels = this.channelsSkip < this.channelsTotal;
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

    this.dataService.getMovies(this.moviesSkip, this.limit).subscribe({
      next: (response: PaginatedResponse<IptvMovie>) => {
        this.movies = [...this.movies, ...response.items];
        this.moviesTotal = response.total;
        this.moviesSkip += response.items.length;
        this.hasMoreMovies = this.moviesSkip < this.moviesTotal;
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

    this.dataService.getSeries(this.seriesSkip, this.limit).subscribe({
      next: (response: PaginatedResponse<IptvSeries>) => {
        this.series = [...this.series, ...response.items];
        this.seriesTotal = response.total;
        this.seriesSkip += response.items.length;
        this.hasMoreSeries = this.seriesSkip < this.seriesTotal;
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
    this.router.navigate(['/player', slugify(channel.nombre)]);
  }

  onMovieClick(movie: IptvMovie) {
    if (movie.stream_url) {
      window.open(movie.stream_url, '_blank');
    }
  }

  onSeriesClick(series: IptvSeries) {
    if (series.stream_url) {
      window.open(series.stream_url, '_blank');
    }
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
