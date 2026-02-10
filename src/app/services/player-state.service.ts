import { Injectable } from '@angular/core';
import { IptvChannel } from './data.service';

export interface PlayerState {
  channel: IptvChannel | null;
  volume: number;
  isMuted: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PlayerStateService {
  private readonly STORAGE_KEY = 'walactv_player_state';
  private state: PlayerState = {
    channel: null,
    volume: 1,
    isMuted: false
  };

  setChannel(channel: IptvChannel): void {
    this.state.channel = channel;
    this.saveState();
  }

  getChannel(): IptvChannel | null {
    this.loadState();
    return this.state.channel;
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

  clear(): void {
    this.state = {
      channel: null,
      volume: 1,
      isMuted: false
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
