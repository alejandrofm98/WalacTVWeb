import { Component, OnInit, inject, ElementRef, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NavbarComponent } from '../../shared/components/navbar-component/navbar.component';
import { CalendarService } from '../../services/calendar.service';
import { PlayerStateService } from '../../services/player-state.service';
import { DataService, IptvChannel } from '../../services/data.service';
import { CalendarEvent, ChannelResolved } from '../../models/calendar.model';
import { slugify } from '../../utils/slugify';

import { SafeHtmlPipe } from '../../pipes/safe-html.pipe';

export interface ChannelGroup {
  displayName: string;
  channels: ChannelResolved[];
  priority: number;
}

@Component({
  selector: 'app-events-list',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, SafeHtmlPipe],
  templateUrl: './events-list.component.html',
  styleUrls: ['./events-list.component.css']
})
export class EventsListComponent implements OnInit {
  @ViewChild('categorySearchInput') categorySearchInput!: ElementRef;
  @ViewChild('categoryOptions') categoryOptions!: ElementRef;

  private calendarService = inject(CalendarService);
  private playerState = inject(PlayerStateService);
  private dataService = inject(DataService);
  private router = inject(Router);

  events: CalendarEvent[] = [];
  loading = false;
  error: string | null = null;
  selectedDate: string = '';
  totalEvents = 0;

  // Filtros
  searchQuery = '';
  selectedCategory: string = '';
  categories: string[] = [];
  categorySearch = '';
  isCategoryOpen = false;
  highlightedCategoryIndex = -1;

  ngOnInit(): void {
    // Establecer fecha de hoy por defecto
    this.selectedDate = new Date().toISOString().split('T')[0];
    this.loadEvents();
  }

  loadEvents(): void {
    this.loading = true;
    this.error = null;

    this.calendarService.getEventsByDate(this.selectedDate).subscribe({
      next: (response) => {
        this.events = response.eventos || [];
        this.totalEvents = response.total_eventos || 0;
        this.extractCategories();
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Error al cargar los eventos';
        this.loading = false;
        console.error('Error loading events:', err);
      }
    });
  }

  private extractCategories(): void {
    const catSet = new Set<string>();
    this.events.forEach(event => {
      if (event.categoria) {
        catSet.add(event.categoria);
      }
    });
    this.categories = Array.from(catSet).sort();
  }

  onDateChange(date: string): void {
    // Validar rango permitido
    const selected = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = selected.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    // Permitir solo -1 (ayer), 0 (hoy), +1 (mañana)
    if (diffDays < -1 || diffDays > 1) {
      // Si está fuera de rango, volver a hoy
      this.goToToday();
      return;
    }

    this.selectedDate = date;
    this.loadEvents();
  }

  goToToday(): void {
    this.selectedDate = new Date().toISOString().split('T')[0];
    this.loadEvents();
  }

  goToPreviousDay(): void {
    if (!this.canGoBack) return;
    const date = new Date(this.selectedDate);
    date.setDate(date.getDate() - 1);
    this.selectedDate = date.toISOString().split('T')[0];
    this.loadEvents();
  }

  goToNextDay(): void {
    if (!this.canGoForward) return;
    const date = new Date(this.selectedDate);
    date.setDate(date.getDate() + 1);
    this.selectedDate = date.toISOString().split('T')[0];
    this.loadEvents();
  }

  get canGoBack(): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(this.selectedDate);
    selected.setHours(0, 0, 0, 0);
    
    // Permitir ir atrás si la fecha seleccionada es >= hoy
    // Es decir, si estoy en Hoy puedo ir a Ayer. Si estoy en Mañana puedo ir a Hoy.
    // Si estoy en Ayer, NO puedo ir más atrás.
    return selected > new Date(today.setDate(today.getDate() - 1));
  }

  get canGoForward(): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(this.selectedDate);
    selected.setHours(0, 0, 0, 0);
    
    // Permitir ir adelante si la fecha seleccionada es <= hoy
    // Si estoy en Hoy puedo ir a Mañana. Si estoy en Ayer puedo ir a Hoy.
    // Si estoy en Mañana, NO puedo ir más adelante.
    return selected < new Date(today.setDate(today.getDate() + 1));
  }

  get filteredEvents(): CalendarEvent[] {
    let filtered = this.events;

    // Filtrar por búsqueda
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(event =>
        event.equipos.toLowerCase().includes(query) ||
        (event.competicion?.toLowerCase() || '').includes(query) ||
        (event.categoria?.toLowerCase() || '').includes(query)
      );
    }

    // Filtrar por categoría/deporte
    if (this.selectedCategory) {
      filtered = filtered.filter(event =>
        event.categoria === this.selectedCategory
      );
    }

    // Ordenar por hora
    return filtered.sort((a, b) => a.hora.localeCompare(b.hora));
  }

  get hasEvents(): boolean {
    return this.filteredEvents.length > 0;
  }

  get minDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  get maxDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  get formattedDate(): string {
    const date = new Date(this.selectedDate);
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    };
    return date.toLocaleDateString('es-ES', options);
  }

  isToday(): boolean {
    const today = new Date().toISOString().split('T')[0];
    return this.selectedDate === today;
  }

  isLive(event: CalendarEvent): boolean {
    if (!this.isToday()) return false;
    
    const now = new Date();
    const [hours, minutes] = event.hora.split(':').map(Number);
    const eventTime = new Date();
    eventTime.setHours(hours, minutes, 0, 0);
    
    return now >= eventTime;
  }

  getLiveStatus(event: CalendarEvent): 'live' | 'upcoming' | 'past' {
    if (!this.isToday()) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const selected = new Date(this.selectedDate);
      selected.setHours(0, 0, 0, 0);
      
      if (selected < today) return 'past';
      return 'upcoming';
    }
    
    const now = new Date();
    const [hours, minutes] = event.hora.split(':').map(Number);
    const eventTime = new Date();
    eventTime.setHours(hours, minutes, 0, 0);
    
    if (now >= eventTime) return 'live';
    return 'upcoming';
  }

  onChannelClick(channel: ChannelResolved, groupChannels?: ChannelResolved[], eventTitle?: string): void {
    const channelsToUse = groupChannels || [channel];
    // Ya no anulamos el canal seleccionado buscando el de prioridad 0 global.
    // Usamos el canal que el usuario haya seleccionado (que será el primero del grupo que haya clickado).
    const targetChannel = channel;
    const eventSlug = eventTitle ? slugify(eventTitle) : '';
    
    this.dataService.getChannel(targetChannel.channel_id).subscribe({
      next: (iptvChannel) => {
        if (iptvChannel) {
          this.playerState.setChannel(iptvChannel);
          this.playerState.setEventChannels(channelsToUse);
          this.playerState.setEventTitle(eventTitle || '');
          this.playerState.setSelectedChannelId(targetChannel.channel_id);
          const navigateSlug = eventSlug || slugify(iptvChannel.nombre);
          this.router.navigate(['/player', navigateSlug]);
        } else {
          console.error('Canal no encontrado:', targetChannel.channel_id);
        }
      },
      error: (err) => {
        console.error('Error al obtener canal:', err);
      }
    });
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.selectedCategory = '';
    this.categorySearch = '';
    this.highlightedCategoryIndex = -1;
  }

  toggleCategory(): void {
    this.isCategoryOpen = !this.isCategoryOpen;
    if (this.isCategoryOpen) {
      this.categorySearch = '';
      this.highlightedCategoryIndex = -1;
      setTimeout(() => {
        this.categorySearchInput?.nativeElement?.focus();
      }, 50);
    }
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
    this.isCategoryOpen = false;
    this.categorySearch = '';
    this.highlightedCategoryIndex = -1;
  }

  onCategoryKeydown(event: KeyboardEvent): void {
    const options = this.filteredCategories;
    const totalOptions = options.length + 1;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedCategoryIndex = Math.min(this.highlightedCategoryIndex + 1, totalOptions - 1);
      this.scrollToCategoryOption();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedCategoryIndex = Math.max(this.highlightedCategoryIndex - 1, 0);
      this.scrollToCategoryOption();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.highlightedCategoryIndex === 0) {
        this.selectCategory('');
      } else if (this.highlightedCategoryIndex > 0 && options[this.highlightedCategoryIndex - 1]) {
        this.selectCategory(options[this.highlightedCategoryIndex - 1]);
      } else if (options.length > 0) {
        this.selectCategory(options[0]);
      }
    } else if (event.key === 'Escape') {
      this.isCategoryOpen = false;
    }
  }

  private scrollToCategoryOption(): void {
    if (!this.categoryOptions?.nativeElement) return;
    const options = this.categoryOptions.nativeElement.querySelectorAll('.select-option');
    if (options[this.highlightedCategoryIndex]) {
      options[this.highlightedCategoryIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  get filteredCategories(): string[] {
    if (!this.categorySearch.trim()) {
      return this.categories;
    }
    const search = this.categorySearch.toLowerCase();
    return this.categories.filter(cat => cat.toLowerCase().includes(search));
  }

  getSportIcon(categoria: string | null): string {
    if (!categoria) return this.getIconDefault();
    
    const cat = categoria.toLowerCase();
    
    // Fútbol - Clean soccer ball
    if (cat.includes('fútbol') || cat.includes('futbol') || cat.includes('soccer')) {
      return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#cbd5e1" stroke-width="1.5"/><path d="M12 2a10 10 0 0 1 0 20" fill="none"/><polygon points="12,7 14.5,9 13.5,12 10.5,12 9.5,9" fill="#cbd5e1"/><line x1="12" y1="7" x2="12" y2="2" stroke="#cbd5e1" stroke-width="1.2"/><line x1="14.5" y1="9" x2="19" y2="5.5" stroke="#cbd5e1" stroke-width="1.2"/><line x1="13.5" y1="12" x2="18.5" y2="14" stroke="#cbd5e1" stroke-width="1.2"/><line x1="10.5" y1="12" x2="5.5" y2="14" stroke="#cbd5e1" stroke-width="1.2"/><line x1="9.5" y1="9" x2="5" y2="5.5" stroke="#cbd5e1" stroke-width="1.2"/></svg>`;
    }
    // Baloncesto
    if (cat.includes('baloncesto') || cat.includes('basket') || cat.includes('nba')) {
      return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#fb923c" stroke-width="1.5"/><path d="M12 2v20" stroke="#fb923c" stroke-width="1.2"/><path d="M2 12h20" stroke="#fb923c" stroke-width="1.2"/><path d="M4.5 4.5c4 3 4 7.5 0 15" stroke="#fb923c" stroke-width="1.2" fill="none"/><path d="M19.5 4.5c-4 3-4 7.5 0 15" stroke="#fb923c" stroke-width="1.2" fill="none"/></svg>`;
    }
    // Tenis
    if (cat.includes('tenis') && !cat.includes('mesa')) {
      return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#a3e635" stroke-width="1.5"/><path d="M6 3.5c3 4 3 13 0 17" stroke="#a3e635" stroke-width="1.3" fill="none"/><path d="M18 3.5c-3 4-3 13 0 17" stroke="#a3e635" stroke-width="1.3" fill="none"/></svg>`;
    }
    // F1/Motor - Steering wheel
    if (cat.includes('motor') || cat.includes('f1') || cat.includes('formula') || cat.includes('rally') || cat.includes('automovilismo')) {
      return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#f87171" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="#f87171" stroke-width="1.5"/><path d="M12 9V3" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/><path d="M9.4 13.5L4.2 16.5" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/><path d="M14.6 13.5L19.8 16.5" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
    // Ciclismo
    if (cat.includes('ciclismo')) {
      return `<svg viewBox="0 0 24 24" fill="none"><circle cx="7" cy="16" r="4" stroke="#38bdf8" stroke-width="1.5"/><circle cx="17" cy="16" r="4" stroke="#38bdf8" stroke-width="1.5"/><path d="M7 16l4-9h3l3 9" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M11 7L9 5H7" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
    // Golf
    if (cat.includes('golf')) {
      return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 18V4l7 4-7 3" stroke="#4ade80" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M8 21c0-2 4-3 4-3s4 1 4 3" stroke="#4ade80" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>`;
    }
    // Pádel
    if (cat.includes('pádel') || cat.includes('padel')) {
      return `<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="9" rx="5" ry="7" stroke="#84cc16" stroke-width="1.5" fill="none"/><circle cx="10" cy="7" r="0.8" fill="#84cc16"/><circle cx="14" cy="7" r="0.8" fill="#84cc16"/><circle cx="12" cy="10" r="0.8" fill="#84cc16"/><circle cx="10" cy="12" r="0.8" fill="#84cc16"/><circle cx="14" cy="12" r="0.8" fill="#84cc16"/><path d="M12 16v5" stroke="#84cc16" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
    // Balonmano
    if (cat.includes('balonmano') || cat.includes('handball')) {
      return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#c084fc" stroke-width="1.5"/><path d="M7 5c3 5 3 9 0 14" stroke="#c084fc" stroke-width="1.2" fill="none"/><path d="M12 3c1 5 1 11 0 18" stroke="#c084fc" stroke-width="1.2" fill="none"/><path d="M17 5c-3 5-3 9 0 14" stroke="#c084fc" stroke-width="1.2" fill="none"/></svg>`;
    }
    // Rugby
    if (cat.includes('rugby')) {
      return `<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="12" rx="9" ry="6" transform="rotate(-30 12 12)" stroke="#f59e0b" stroke-width="1.5" fill="none"/><path d="M7 17L17 7" stroke="#f59e0b" stroke-width="1.2"/><path d="M9.5 12l2-2m1 3l2-2" stroke="#f59e0b" stroke-width="1.2" stroke-linecap="round"/></svg>`;
    }
    // Boxeo / MMA
    if (cat.includes('boxeo') || cat.includes('mma') || cat.includes('ufc')) {
      return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 13V9a4 4 0 0 1 4-4h1a2 2 0 0 1 2 2v5a3 3 0 0 1-3 3H7a2 2 0 0 1-2-2z" stroke="#ef4444" stroke-width="1.5" fill="none"/><path d="M12 12h2a3 3 0 0 0 3-3V8" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M8 19v2m4-2v2" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
    // Natación
    if (cat.includes('natación') || cat.includes('natacion') || cat.includes('swimming')) {
      return `<svg viewBox="0 0 24 24" fill="none"><path d="M2 18c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M2 14c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round" fill="none"/><circle cx="8" cy="8" r="2" stroke="#06b6d4" stroke-width="1.5" fill="none"/><path d="M10 8l4 3" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
    // Hockey
    if (cat.includes('hockey')) {
      return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 20L14 4" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><path d="M14 4c2 0 4 1 5 3" stroke="#64748b" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="17" cy="18" r="2" stroke="#64748b" stroke-width="1.5" fill="none"/></svg>`;
    }
    return this.getIconDefault();
  }

  getSportColor(categoria: string | null): string {
    if (!categoria) return '#8b5cf6';
    const cat = categoria.toLowerCase();
    if (cat.includes('fútbol') || cat.includes('futbol')) return '#cbd5e1';
    if (cat.includes('baloncesto') || cat.includes('basket') || cat.includes('nba')) return '#fb923c';
    if (cat.includes('tenis') && !cat.includes('mesa')) return '#a3e635';
    if (cat.includes('motor') || cat.includes('f1') || cat.includes('automovilismo')) return '#f87171';
    if (cat.includes('ciclismo')) return '#38bdf8';
    if (cat.includes('golf')) return '#4ade80';
    if (cat.includes('pádel') || cat.includes('padel')) return '#84cc16';
    if (cat.includes('balonmano') || cat.includes('handball')) return '#c084fc';
    if (cat.includes('rugby')) return '#f59e0b';
    if (cat.includes('boxeo') || cat.includes('mma') || cat.includes('ufc')) return '#ef4444';
    if (cat.includes('natación') || cat.includes('natacion')) return '#06b6d4';
    if (cat.includes('hockey')) return '#64748b';
    return '#8b5cf6';
  }

  private getIconDefault(): string {
    return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#8b5cf6" stroke-width="1.5"/><path d="M12 8v4l3 2" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  getChannelGroups(channels: ChannelResolved[]): ChannelGroup[] {
    if (!channels || channels.length === 0) return [];

    const grouped = new Map<string, ChannelResolved[]>();
    
    channels.forEach(channel => {
      const key = channel.display_name;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(channel);
    });

    const groups: ChannelGroup[] = [];
    grouped.forEach((chs, displayName) => {
      const minPriority = Math.min(...chs.map(c => c.priority));
      groups.push({
        displayName,
        channels: chs.sort((a, b) => a.priority - b.priority),
        priority: minPriority
      });
    });

    return groups.sort((a, b) => a.priority - b.priority);
  }

  getFirstPriorityZeroChannel(channels: ChannelResolved[]): ChannelResolved | null {
    if (!channels || channels.length === 0) return null;
    
    const priorityZero = channels.filter(c => c.priority === 0);
    if (priorityZero.length > 0) {
      return priorityZero[0];
    }
    
    const sorted = [...channels].sort((a, b) => a.priority - b.priority);
    return sorted[0];
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.searchable-select')) {
      this.isCategoryOpen = false;
    }
  }
}
