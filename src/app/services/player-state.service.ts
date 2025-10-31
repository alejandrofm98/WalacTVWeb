import { Injectable } from '@angular/core';
import { Events } from '../models';
import { Channel } from '../models/channel.model';

@Injectable({
  providedIn: 'root'
})
export class PlayerStateService {
  private currentEvent: Events | null = null;
  private currentChannel: Channel | null = null;

  setEvent(event: Events): void {
    this.currentEvent = event;
    this.currentChannel = null; // Limpiamos el canal cuando se establece un evento
  }

  getEvent(): Events | null {
    return this.currentEvent;
  }

  setChannel(channel: Channel): void {
    this.currentChannel = channel;
    this.currentEvent = null; // Limpiamos el evento cuando se establece un canal
  }

  getChannel(): Channel | null {
    return this.currentChannel;
  }

  clear(): void {
    this.currentEvent = null;
    this.currentChannel = null;
  }
}
