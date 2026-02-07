import { Injectable } from '@angular/core';
import { IptvChannel } from './data.service';

@Injectable({
  providedIn: 'root'
})
export class PlayerStateService {
  private currentChannel: IptvChannel | null = null;

  setChannel(channel: IptvChannel): void {
    this.currentChannel = channel;
  }

  getChannel(): IptvChannel | null {
    return this.currentChannel;
  }

  clear(): void {
    this.currentChannel = null;
  }
}
