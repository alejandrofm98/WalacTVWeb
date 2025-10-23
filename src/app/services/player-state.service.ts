import { Injectable } from '@angular/core';
import { Events } from '../models';

@Injectable({ providedIn: 'root' })
export class PlayerStateService {
  private currentEvent: Events | null = null;

  setEvent(event: Events) {
    this.currentEvent = event;
  }

  getEvent(): Events | null {
    return this.currentEvent;
  }

  clear() {
    this.currentEvent = null;
  }
}
