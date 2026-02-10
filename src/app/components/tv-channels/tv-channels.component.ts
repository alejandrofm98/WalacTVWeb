import {Component, OnInit, inject, ElementRef, ViewChild, AfterViewInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Router} from '@angular/router';
import {DataService, IptvChannel, PaginatedResponse} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';
import {HttpsPipe} from '../../pipes/https.pipe';

interface ChannelGroup {
  name: string;
  channels: IptvChannel[];
  expanded: boolean;
}

@Component({
  selector: 'app-tv-channels',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, HttpsPipe],
  templateUrl: './tv-channels.component.html',
  styleUrls: ['./tv-channels.component.css']
})
export class TvChannelsComponent implements OnInit, AfterViewInit {
  @ViewChild('loadMoreTrigger') loadMoreTrigger!: ElementRef;

  channels: IptvChannel[] = [];
  groupedChannels: ChannelGroup[] = [];
  searchTerm: string = '';
  groups: string[] = [];
  selectedGroup: string = '';

  loading = false;
  page = 1;
  limit = 100;
  total = 0;
  hasMore = true;

  private dataService = inject(DataService);
  private playerState = inject(PlayerStateService);
  private router = inject(Router);
  private observer: IntersectionObserver | null = null;

  ngOnInit(): void {
    this.loadChannels();
    this.loadGroups();
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
        if (entry.isIntersecting && this.hasMore && !this.loading) {
          this.loadMoreChannels();
        }
      });
    }, options);

    if (this.loadMoreTrigger?.nativeElement) {
      this.observer.observe(this.loadMoreTrigger.nativeElement);
    }
  }

  loadGroups(): void {
    this.dataService.getGroups('channels').subscribe({
      next: (groups: string[]) => {
        this.groups = groups;
      }
    });
  }

  loadChannels(reset: boolean = false): void {
    if (reset) {
      this.page = 1;
      this.channels = [];
    }

    this.loading = true;

    this.dataService.getChannels(this.page, this.limit, this.selectedGroup).subscribe({
      next: (response: PaginatedResponse<IptvChannel>) => {
        this.channels = [...this.channels, ...response.items];
        this.total = response.total;
        this.page += 1;
        this.hasMore = response.has_next;
        this.groupChannels();
        this.loading = false;
      },
      error: (error) => {
        console.error('Error cargando canales:', error);
        this.loading = false;
      }
    });
  }

  loadMoreChannels(): void {
    if (!this.hasMore || this.loading) return;

    this.dataService.getChannels(this.page, this.limit, this.selectedGroup).subscribe({
      next: (response: PaginatedResponse<IptvChannel>) => {
        this.channels = [...this.channels, ...response.items];
        this.page += 1;
        this.hasMore = response.has_next;
        this.groupChannels();
      }
    });
  }

  onGroupFilterChange(): void {
    this.loadChannels(true);
  }

  private groupChannels(): void {
    const groups = new Map<string, IptvChannel[]>();

    this.channels.forEach(channel => {
      const groupName = channel.grupo || 'Sin grupo';
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName)!.push(channel);
    });

    this.groupedChannels = Array.from(groups.entries())
      .map(([name, channels]) => ({
        name,
        channels: channels.sort((a, b) => (a.num || 0) - (b.num || 0)),
        expanded: true
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  toggleGroup(group: ChannelGroup): void {
    group.expanded = !group.expanded;
  }

  onChannelClick(channel: IptvChannel): void {
    this.playerState.setChannel(channel);
    const slug = slugify(channel.nombre);
    this.router.navigate(['/player', slug]);
  }

  onSearch(): void {
    if (!this.searchTerm.trim()) {
      this.groupChannels();
      return;
    }

    const searchTermLower = this.searchTerm.toLowerCase();
    const searchTermNumber = parseInt(this.searchTerm);

    const filteredChannels = this.channels.filter(channel => {
      const matchesName = channel.nombre.toLowerCase().includes(searchTermLower);
      const matchesGroup = channel.grupo?.toLowerCase().includes(searchTermLower) || false;
      const matchesNumber = !isNaN(searchTermNumber) && channel.num === searchTermNumber;

      return matchesName || matchesGroup || matchesNumber;
    });

    const groups = new Map<string, IptvChannel[]>();
    filteredChannels.forEach(channel => {
      const groupName = channel.grupo || 'Sin grupo';
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName)!.push(channel);
    });

    this.groupedChannels = Array.from(groups.entries())
      .map(([name, channels]) => ({
        name,
        channels: channels.sort((a, b) => (a.num || 0) - (b.num || 0)),
        expanded: true
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get totalChannels(): number {
    return this.groupedChannels.reduce((sum, group) => sum + group.channels.length, 0);
  }
}
