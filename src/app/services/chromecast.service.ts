// chromecast.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

declare const chrome: any;

export interface CastState {
  isAvailable: boolean;
  isConnected: boolean;
  isPlaying: boolean;
  deviceName: string | null;
  currentTime: number;
  duration: number;
}

@Injectable({
  providedIn: 'root'
})
export class ChromecastService {
  private session: any = null;
  private currentMedia: any = null;

  private castStateSubject = new BehaviorSubject<CastState>({
    isAvailable: false,
    isConnected: false,
    isPlaying: false,
    deviceName: null,
    currentTime: 0,
    duration: 0
  });

  public castState$: Observable<CastState> = this.castStateSubject.asObservable();

  constructor() {
    console.log('🏗️ ChromecastService constructor');
    this.initializeCast();
  }

  private initializeCast(): void {
    // Configurar callback global
    (window as any)['__onGCastApiAvailable'] = (isAvailable: boolean) => {
      console.log('🎯 Cast API Available:', isAvailable);
      if (isAvailable) {
        this.setupCastApi();
      }
    };

    // Si ya está disponible
    if ((window as any).chrome?.cast?.isAvailable) {
      console.log('✅ Cast ya disponible, inicializando...');
      this.setupCastApi();
    } else {
      console.log('⏳ Esperando Cast API...');
    }
  }

  private setupCastApi(): void {
    try {
      const sessionRequest = new chrome.cast.SessionRequest(
        chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID
      );

      const apiConfig = new chrome.cast.ApiConfig(
        sessionRequest,
        (session: any) => this.sessionListener(session),
        (availability: string) => this.receiverListener(availability)
      );

      chrome.cast.initialize(
        apiConfig,
        () => {
          console.log('✅ Cast API inicializada correctamente');
          this.updateCastState();
        },
        (error: any) => {
          console.error('❌ Error inicializando Cast:', error);
        }
      );
    } catch (error) {
      console.error('❌ Error en setupCastApi:', error);
    }
  }

  private sessionListener(session: any): void {
    console.log('📡 Nueva sesión de Cast:', session);
    this.session = session;

    if (session.media && session.media.length > 0) {
      this.currentMedia = session.media[0];
      this.attachMediaListeners();
    }

    session.addUpdateListener((isAlive: boolean) => {
      console.log('📊 Sesión actualizada, isAlive:', isAlive);
      if (!isAlive) {
        this.session = null;
        this.currentMedia = null;
      }
      this.updateCastState();
    });

    this.updateCastState();
  }

  private receiverListener(availability: string): void {
    console.log('📡 Disponibilidad de receptores:', availability);
    const isAvailable = availability === chrome.cast.ReceiverAvailability.AVAILABLE;

    const currentState = this.castStateSubject.value;
    this.castStateSubject.next({
      ...currentState,
      isAvailable
    });
  }

  private attachMediaListeners(): void {
    if (!this.currentMedia) return;

    this.currentMedia.addUpdateListener((isAlive: boolean) => {
      console.log('🎬 Media actualizada, isAlive:', isAlive);
      this.updateCastState();
    });
  }

  private updateCastState(): void {
    const state: CastState = {
      isAvailable: this.castStateSubject.value.isAvailable,
      isConnected: !!this.session,
      isPlaying: this.currentMedia?.playerState === chrome.cast.media.PlayerState.PLAYING,
      deviceName: this.session?.receiver?.friendlyName || null,
      currentTime: this.currentMedia?.getEstimatedTime() || 0,
      duration: this.currentMedia?.media?.duration || 0
    };

    console.log('📊 Estado actualizado:', state);
    this.castStateSubject.next(state);
  }

  public requestSession(): void {
    console.log('📡 Solicitando sesión de Cast...');

    chrome.cast.requestSession(
      (session: any) => {
        console.log('✅ Sesión obtenida:', session);
        this.sessionListener(session);
      },
      (error: any) => {
        console.error('❌ Error obteniendo sesión:', error);
        if (error.code === 'cancel') {
          console.log('ℹ️ Usuario canceló la selección');
        } else {
          alert('Error de Chromecast: ' + error.description);
        }
      }
    );
  }

  public loadMedia(streamUrl: string, title: string, posterUrl?: string): void {
    if (!this.session) {
      console.error('❌ No hay sesión activa');
      alert('Primero selecciona un dispositivo Chromecast');
      return;
    }

    console.log('📺 Cargando media en Chromecast:', streamUrl);

    const mediaInfo = new chrome.cast.media.MediaInfo(streamUrl, 'application/x-mpegURL');

    const metadata = new chrome.cast.media.GenericMediaMetadata();
    metadata.metadataType = chrome.cast.media.MetadataType.GENERIC;
    metadata.title = title;

    if (posterUrl) {
      metadata.images = [new chrome.cast.Image(posterUrl)];
    }

    mediaInfo.metadata = metadata;
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;

    const request = new chrome.cast.media.LoadRequest(mediaInfo);

    this.session.loadMedia(
      request,
      (media: any) => {
        console.log('✅ Media cargada correctamente');
        this.currentMedia = media;
        this.attachMediaListeners();
        this.updateCastState();
      },
      (error: any) => {
        console.error('❌ Error cargando media:', error);
        alert('Error cargando video: ' + error.description);
      }
    );
  }

  public togglePlayPause(): void {
    if (!this.currentMedia) {
      console.warn('⚠️ No hay media activa');
      return;
    }

    if (this.currentMedia.playerState === chrome.cast.media.PlayerState.PLAYING) {
      this.currentMedia.pause(
        new chrome.cast.media.PauseRequest(),
        () => console.log('✅ Pausado'),
        (error: any) => console.error('❌ Error pausando:', error)
      );
    } else {
      this.currentMedia.play(
        new chrome.cast.media.PlayRequest(),
        () => console.log('✅ Reproduciendo'),
        (error: any) => console.error('❌ Error reproduciendo:', error)
      );
    }
  }

  public endSession(): void {
    if (this.session) {
      this.session.stop(
        () => {
          console.log('✅ Sesión detenida');
          this.session = null;
          this.currentMedia = null;
          this.updateCastState();
        },
        (error: any) => console.error('❌ Error deteniendo sesión:', error)
      );
    }
  }

  public getCurrentState(): CastState {
    return this.castStateSubject.value;
  }
}
