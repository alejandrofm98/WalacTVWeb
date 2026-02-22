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

@Injectable({
  providedIn: 'root'
})
export class PlayerStateService {
  private readonly STORAGE_KEY = 'walactv_player_state';
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
    this.saveState();
  }

  getEventChannels(): ChannelResolved[] {
    this.loadState();
    return this.state.eventChannels;
  }

  setEventTitle(title: string): void {
    this.state.eventTitle = title;
    this.saveState();
  }

  getEventTitle(): string {
    this.loadState();
    return this.state.eventTitle;
  }

  setSelectedChannelId(channelId: string): void {
    this.state.selectedChannelId = channelId;
    this.saveState();
  }

  getSelectedChannelId(): string {
    this.loadState();
    return this.state.selectedChannelId || '';
  }

  clearEvent(): void {
    this.state.eventTitle = '';
    this.state.eventChannels = [];
    this.state.selectedChannelId = '';
    this.saveState();
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
    this.removeState();
  }

  private saveState(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Error saving player state:', e);
    }
  }

  private loadState(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.state = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error loading player state:', e);
    }
  }

  private removeState(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
