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
    this.initializeCast();
  }

  private initializeCast(): void {
    (window as any)['__onGCastApiAvailable'] = (isAvailable: boolean) => {
      if (isAvailable) {
        this.setupCastApi();
      }
    };

    if ((window as any).chrome?.cast?.isAvailable) {
      this.setupCastApi();
    }
  }

  private setupCastApi(): void {
    try {
      const appId = chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
      const sessionRequest = new chrome.cast.SessionRequest(appId);
      const apiConfig = new chrome.cast.ApiConfig(
        sessionRequest,
        (session: any) => this.sessionListener(session),
        (availability: string) => this.receiverListener(availability)
      );

      chrome.cast.initialize(
        apiConfig,
        () => this.updateCastState(),
        (error: any) => console.error('Error inicializando Cast:', error)
      );
    } catch (error) {
      console.error('Error en setupCastApi:', error);
    }
  }

  private sessionListener(session: any): void {
    this.session = session;

    if (session.media && session.media.length > 0) {
      this.currentMedia = session.media[0];
      this.attachMediaListeners();
    }

    session.addUpdateListener((isAlive: boolean) => {
      if (!isAlive) {
        this.session = null;
        this.currentMedia = null;
      }
      this.updateCastState();
    });

    this.updateCastState();
  }

  private receiverListener(availability: string): void {
    const isAvailable = availability === chrome.cast.ReceiverAvailability.AVAILABLE;
    const currentState = this.castStateSubject.value;

    this.castStateSubject.next({
      ...currentState,
      isAvailable
    });
  }

  private attachMediaListeners(): void {
    if (!this.currentMedia) return;

    this.currentMedia.addUpdateListener(() => {
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

    this.castStateSubject.next(state);
  }

  public requestSession(): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.cast.requestSession(
        (session: any) => {
          this.sessionListener(session);
          resolve();
        },
        (error: any) => {
          console.error('Error obteniendo sesión:', error);
          reject(error);
        }
      );
    });
  }

  public async loadMedia(streamUrl: string, title: string, posterUrl?: string): Promise<void> {
    if (!this.session) {
      throw new Error('No hay sesión activa de Chromecast');
    }

    if (streamUrl.includes('localhost') || streamUrl.includes('127.0.0.1')) {
      throw new Error('No se pueden transmitir URLs locales a Chromecast');
    }

    try {
      let finalUrl = streamUrl;

      // Convertir getstream a manifest si es necesario
      if (streamUrl.includes('/getstream?')) {
        finalUrl = streamUrl.replace('/getstream?', '/manifest.m3u8?');
      }

      // Crear MediaInfo
      const mediaInfo = new chrome.cast.media.MediaInfo(finalUrl, 'application/x-mpegURL');

      const metadata = new chrome.cast.media.GenericMediaMetadata();
      metadata.metadataType = chrome.cast.media.MetadataType.GENERIC;
      metadata.title = title;

      if (posterUrl) {
        metadata.images = [new chrome.cast.Image(posterUrl)];
      }

      mediaInfo.metadata = metadata;
      mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
      mediaInfo.duration = null;

      const request = new chrome.cast.media.LoadRequest(mediaInfo);
      request.autoplay = true;
      request.currentTime = 0;

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (this.currentMedia) {
            const finalState = this.currentMedia.playerState;
            const finalReason = this.currentMedia.idleReason;

            if (finalState === chrome.cast.media.PlayerState.IDLE && finalReason === null) {
              reject(new Error(
                'El stream no inició la reproducción.\n\n' +
                'Verifica que el dispositivo tenga acceso a Internet y que la URL sea accesible.'
              ));
            } else {
              resolve();
            }
          } else {
            reject(new Error('Timeout sin respuesta del Chromecast'));
          }
        }, 45000);

        this.session.loadMedia(
          request,
          (media: any) => {
            this.currentMedia = media;
            this.attachMediaListeners();
            this.updateCastState();

            let checkCount = 0;
            const maxChecks = 30;

            const stateChecker = setInterval(() => {
              checkCount++;

              if (!this.currentMedia) {
                clearInterval(stateChecker);
                clearTimeout(timeout);
                reject(new Error('Se perdió la referencia al media'));
                return;
              }

              const state = this.currentMedia.playerState;
              const idleReason = this.currentMedia.idleReason;

              if (state === chrome.cast.media.PlayerState.PLAYING) {
                clearInterval(stateChecker);
                clearTimeout(timeout);
                resolve();
                return;
              }

              if (state === chrome.cast.media.PlayerState.IDLE &&
                  idleReason === chrome.cast.media.IdleReason.ERROR) {
                clearInterval(stateChecker);
                clearTimeout(timeout);
                reject(new Error(
                  'Error al reproducir el stream.\n\n' +
                  'Verifica que el dispositivo tenga acceso a Internet.'
                ));
                return;
              }

              if (checkCount >= maxChecks) {
                clearInterval(stateChecker);
                clearTimeout(timeout);
                resolve();
              }
            }, 1000);
          },
          (error: any) => {
            clearTimeout(timeout);

            let errorMsg = 'Error al cargar el stream en Chromecast.\n\n';

            if (error.code === 'LOAD_FAILED') {
              errorMsg += 'El dispositivo no pudo cargar el stream.\n' +
                        'Verifica la conexión y el formato del stream.';
            } else if (error.code === 'TIMEOUT') {
              errorMsg += 'El stream tardó demasiado en responder.';
            } else if (error.description) {
              errorMsg += error.description;
            } else {
              errorMsg += 'Código de error: ' + error.code;
            }

            reject(new Error(errorMsg));
          }
        );
      });

    } catch (error: any) {
      console.error('Error en loadMedia:', error);
      throw error;
    }
  }

  public togglePlayPause(): void {
    if (!this.currentMedia) return;

    const playerState = this.currentMedia.playerState;

    if (playerState === chrome.cast.media.PlayerState.PLAYING) {
      this.currentMedia.pause(
        new chrome.cast.media.PauseRequest(),
        () => this.updateCastState(),
        (error: any) => console.error('Error pausando:', error)
      );
    } else {
      this.currentMedia.play(
        new chrome.cast.media.PlayRequest(),
        () => this.updateCastState(),
        (error: any) => console.error('Error reproduciendo:', error)
      );
    }
  }

  public endSession(): void {
    if (this.session) {
      this.session.stop(
        () => {
          this.session = null;
          this.currentMedia = null;
          this.updateCastState();
        },
        (error: any) => console.error('Error deteniendo sesión:', error)
      );
    }
  }

  public getCurrentState(): CastState {
    return this.castStateSubject.value;
  }
}
