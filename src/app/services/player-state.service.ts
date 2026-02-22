import { Injectable } from '@angular/core';
import { IptvChannel, IptvMovie, IptvSeries } from './data.service';
import { ChannelResolved } from '../models/calendar.model';

export type ContentType = 'channels' | 'movies' | 'series';
export type ContentItem = IptvChannel | IptvMovie | IptvSeries;

export interface PlayerState {
  channel: IptvChannel | null;
  movie: IptvMovie | null;
  series: IptvSeries | null;
  contentType: ContentType;
  volume: number;
  isMuted: boolean;
  eventChannels: ChannelResolved[];
  eventTitle: string;
  selectedChannelId: string;
}

const PLAYER_STATE_KEY = 'walactv_player_state';
const EVENT_STATE_KEY = 'walactv_event_state';

@Injectable({
  providedIn: 'root'
})
export class PlayerStateService {
  private state: PlayerState = {
    channel: null,
    movie: null,
    series: null,
    contentType: 'channels',
    volume: 1,
    isMuted: false,
    eventChannels: [],
    eventTitle: '',
    selectedChannelId: ''
  };

  setChannel(channel: IptvChannel): void {
    this.state.channel = channel;
    this.state.movie = null;
    this.state.series = null;
    this.state.contentType = 'channels';
    this.saveState();
  }

  setMovie(movie: IptvMovie): void {
    this.state.movie = movie;
    this.state.channel = null;
    this.state.series = null;
    this.state.contentType = 'movies';
    this.saveState();
  }

  setSeries(series: IptvSeries): void {
    this.state.series = series;
    this.state.channel = null;
    this.state.movie = null;
    this.state.contentType = 'series';
    this.saveState();
  }

  getChannel(): IptvChannel | null {
    this.loadState();
    return this.state.channel;
  }

  getMovie(): IptvMovie | null {
    this.loadState();
    return this.state.movie;
  }

  getSeries(): IptvSeries | null {
    this.loadState();
    return this.state.series;
  }

  getCurrentItem(): ContentItem | null {
    this.loadState();
    switch (this.state.contentType) {
      case 'channels': return this.state.channel;
      case 'movies': return this.state.movie;
      case 'series': return this.state.series;
      default: return null;
    }
  }

  getContentType(): ContentType {
    this.loadState();
    return this.state.contentType;
  }

  getVolume(): number {
    this.loadState();
    return this.state.volume;
  }

  isMuted(): boolean {
    this.loadState();
    return this.state.isMuted;
  }

  setVolume(volume: number): void {
    this.state.volume = Math.max(0, Math.min(1, volume));
    this.saveState();
  }

  setMuted(isMuted: boolean): void {
    this.state.isMuted = isMuted;
    this.saveState();
  }

  setEventChannels(channels: ChannelResolved[]): void {
    this.state.eventChannels = channels;
    this.saveEventState();
  }

  getEventChannels(): ChannelResolved[] {
    this.loadEventState();
    return this.state.eventChannels;
  }

  setEventTitle(title: string): void {
    this.state.eventTitle = title;
    this.saveEventState();
  }

  getEventTitle(): string {
    this.loadEventState();
    return this.state.eventTitle;
  }

  setSelectedChannelId(channelId: string): void {
    this.state.selectedChannelId = channelId;
    this.saveEventState();
  }

  getSelectedChannelId(): string {
    this.loadEventState();
    return this.state.selectedChannelId || '';
  }

  clearEvent(): void {
    this.state.eventTitle = '';
    this.state.eventChannels = [];
    this.state.selectedChannelId = '';
    this.removeEventState();
  }

  clear(): void {
    this.state = {
      channel: null,
      movie: null,
      series: null,
      contentType: 'channels',
      volume: 1,
      isMuted: false,
      eventChannels: [],
      eventTitle: '',
      selectedChannelId: ''
    };
    localStorage.removeItem(PLAYER_STATE_KEY);
    localStorage.removeItem(EVENT_STATE_KEY);
  }

  private saveState(): void {
    try {
      const stateToSave = {
        channel: this.state.channel,
        movie: this.state.movie,
        series: this.state.series,
        contentType: this.state.contentType,
        volume: this.state.volume,
        isMuted: this.state.isMuted
      };
      localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.error('Error saving player state:', e);
    }
  }

  private saveEventState(): void {
    try {
      const eventState = {
        eventChannels: this.state.eventChannels,
        eventTitle: this.state.eventTitle,
        selectedChannelId: this.state.selectedChannelId
      };
      localStorage.setItem(EVENT_STATE_KEY, JSON.stringify(eventState));
    } catch (e) {
      console.error('Error saving event state:', e);
    }
  }

  private loadState(): void {
    try {
      const stored = localStorage.getItem(PLAYER_STATE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.state.channel = parsed.channel || null;
        this.state.movie = parsed.movie || null;
        this.state.series = parsed.series || null;
        this.state.contentType = parsed.contentType || 'channels';
        this.state.volume = parsed.volume ?? 1;
        this.state.isMuted = parsed.isMuted ?? false;
      }
    } catch (e) {
      console.error('Error loading player state:', e);
    }
  }

  private loadEventState(): void {
    try {
      const stored = localStorage.getItem(EVENT_STATE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.state.eventChannels = parsed.eventChannels || [];
        this.state.eventTitle = parsed.eventTitle || '';
        this.state.selectedChannelId = parsed.selectedChannelId || '';
      }
    } catch (e) {
      console.error('Error loading event state:', e);
    }
  }

  private removeEventState(): void {
    localStorage.removeItem(EVENT_STATE_KEY);
  }
}
