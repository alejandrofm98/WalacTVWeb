import { Component, OnInit, inject } from '@angular/core';
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

  onChannelClick(channel: ChannelResolved, groupChannels?: ChannelResolved[], eventTitle?: string): void {
    const channelsToUse = groupChannels || [channel];
    const priorityZeroChannel = this.getFirstPriorityZeroChannel(channelsToUse);
    const targetChannel = priorityZeroChannel || channel;
    const eventSlug = eventTitle ? slugify(eventTitle) : '';
    
    this.dataService.getChannel(targetChannel.channel_id).subscribe({
      next: (iptvChannel) => {
        if (iptvChannel) {
          this.playerState.setChannel(iptvChannel);
          this.playerState.setEventChannels(channelsToUse);
          this.playerState.setEventTitle(eventTitle || '');
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
  }

  toggleCategory(): void {
    this.isCategoryOpen = !this.isCategoryOpen;
    if (!this.isCategoryOpen) {
      this.categorySearch = '';
    }
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
    this.isCategoryOpen = false;
    this.categorySearch = '';
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
    
    // Fútbol - Pelota clásica blanca/negra
    if (cat.includes('fútbol') || cat.includes('futbol') || cat.includes('soccer')) {
      return `<svg viewBox="0 0 512 512" fill="none"><circle cx="256" cy="256" r="256" fill="#F0F0F0"/><path d="M374.3 189.8L256 103.4L137.7 189.8L183.1 328.6H328.9L374.3 189.8Z" fill="#263238"/><path d="M137.7 189.8L256 103.4V26.2C147.2 38.9 57.6 117.2 28.5 221.7L137.7 189.8Z" fill="#37474F"/><path d="M374.3 189.8L483.5 221.7C454.4 117.2 364.8 38.9 256 26.2V103.4L374.3 189.8Z" fill="#37474F"/><path d="M328.9 328.6L374.3 189.8L483.5 221.7C491.5 249.2 491.5 278.4 483.5 305.8L377.9 398.6L328.9 328.6Z" fill="#37474F"/><path d="M183.1 328.6L134.1 398.6L28.5 305.8C20.5 278.4 20.5 249.2 28.5 221.7L137.7 189.8L183.1 328.6Z" fill="#37474F"/><path d="M328.9 328.6H183.1L134.1 398.6L256 485.8L377.9 398.6L328.9 328.6Z" fill="#37474F"/></svg>`;
    }
    // Baloncesto - Pelota naranja
    if (cat.includes('baloncesto') || cat.includes('basket') || cat.includes('nba')) {
      return `<svg viewBox="0 0 512 512" fill="none"><circle cx="256" cy="256" r="256" fill="#FF9800"/><path d="M256 512C397.385 512 512 397.385 512 256C512 114.615 397.385 0 256 0V512Z" fill="#F57C00"/><path d="M256 0V512" stroke="#3E2723" stroke-width="16"/><path d="M0 256H512" stroke="#3E2723" stroke-width="16"/><circle cx="256" cy="256" r="160" stroke="#3E2723" stroke-width="16" fill="none"/><path d="M490 146C420 180 340 180 270 146" stroke="#3E2723" stroke-width="16" fill="none"/><path d="M22 146C92 180 172 180 242 146" stroke="#3E2723" stroke-width="16" fill="none"/><path d="M490 366C420 332 340 332 270 366" stroke="#3E2723" stroke-width="16" fill="none"/><path d="M22 366C92 332 172 332 242 366" stroke="#3E2723" stroke-width="16" fill="none"/></svg>`;
    }
    // Tenis - Pelota verde flúor
    if (cat.includes('tenis')) {
      return `<svg viewBox="0 0 512 512" fill="none"><circle cx="256" cy="256" r="256" fill="#CCFF90"/><path d="M120 40C120 40 220 180 220 256C220 332 120 472 120 472" stroke="#F0F4C3" stroke-width="24" stroke-linecap="round"/><path d="M392 40C392 40 292 180 292 256C292 332 392 472 392 472" stroke="#F0F4C3" stroke-width="24" stroke-linecap="round"/></svg>`;
    }
    // F1/Motor
    if (cat.includes('motor') || cat.includes('f1') || cat.includes('formula') || cat.includes('rally') || cat.includes('automovilismo')) {
      return `<svg viewBox="0 0 512 512" fill="none"><path d="M96 256H48V416H96V256Z" fill="#37474F"/><path d="M464 256H416V416H464V256Z" fill="#37474F"/><path d="M48 304H464V368H48V304Z" fill="#FF5252"/><path d="M144 208L176 112H336L368 208H144Z" fill="#40C4FF"/><path d="M80 304H432L416 208H96L80 304Z" fill="#FF5252"/><circle cx="128" cy="416" r="48" fill="#212121"/><circle cx="384" cy="416" r="48" fill="#212121"/><circle cx="128" cy="416" r="24" fill="#9E9E9E"/><circle cx="384" cy="416" r="24" fill="#9E9E9E"/></svg>`;
    }
    // Ciclismo
    if (cat.includes('ciclismo')) {
      return `<svg viewBox="0 0 512 512" fill="none"><circle cx="128" cy="384" r="96" stroke="#424242" stroke-width="32"/><circle cx="384" cy="384" r="96" stroke="#424242" stroke-width="32"/><path d="M128 384L224 160H304L384 384" stroke="#03A9F4" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><path d="M224 160L176 112H112" stroke="#03A9F4" stroke-width="24" stroke-linecap="round"/></svg>`;
    }
    // Golf
    if (cat.includes('golf')) {
      return `<svg viewBox="0 0 512 512" fill="none"><circle cx="256" cy="120" r="80" fill="#F5F5F5"/><path d="M240 200h32v216h-32z" fill="#FFD54F"/><path d="M160 416c0-64 96-96 96-96s96 32 96 96" fill="#8D6E63"/></svg>`;
    }
    return this.getIconDefault();
  }

  getSportColor(categoria: string | null): string {
    if (!categoria) return '#6366f1';
    const cat = categoria.toLowerCase();
    if (cat.includes('fútbol') || cat.includes('futbol')) return '#cbd5e1';
    if (cat.includes('baloncesto') || cat.includes('basket')) return '#fb923c';
    if (cat.includes('tenis')) return '#a3e635';
    if (cat.includes('motor') || cat.includes('f1') || cat.includes('automovilismo')) return '#f87171';
    if (cat.includes('ciclismo')) return '#38bdf8';
    if (cat.includes('golf')) return '#4ade80';
    if (cat.includes('pádel') || cat.includes('padel')) return '#84cc16';
    return '#8b5cf6';
  }

  private getIconDefault(): string {
    return `<svg viewBox="0 0 512 512" fill="none"><circle cx="256" cy="256" r="256" fill="#CFD8DC"/><path d="M160 160L352 352" stroke="#607D8B" stroke-width="48" stroke-linecap="round"/><path d="M352 160L160 352" stroke="#607D8B" stroke-width="48" stroke-linecap="round"/></svg>`;
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
}
