import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

declare const chrome: any;

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
  }
}

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
  private castContext: any = null;
  private remotePlayer: any = null;
  private remotePlayerController: any = null;

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
  this.initializeCastApi();

  // Verificar después de 3 segundos
  setTimeout(() => {
    console.log('🔍 Verificación de Cast después de 3s:');
    console.log('- window.chrome.cast:', window['chrome']?.cast);
    console.log('- CastContext:', this.castContext);
    console.log('- Estado actual:', this.castStateSubject.value);
  }, 3000);
}

  private initializeCastApi(): void {
    // Esperar a que el SDK de Cast esté disponible
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (isAvailable) {
        this.setupCastContext();
      } else {
        console.warn('Google Cast API no disponible');
      }
    };
  }

  private setupCastContext(): void {
    try {
      this.castContext = chrome.cast.framework.CastContext.getInstance();

      // Configurar opciones
      this.castContext.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });

      // Configurar Remote Player
      this.remotePlayer = new chrome.cast.framework.RemotePlayer();
      this.remotePlayerController = new chrome.cast.framework.RemotePlayerController(this.remotePlayer);

      // Escuchar cambios en la conexión
      this.castContext.addEventListener(
        chrome.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (event: any) => this.onSessionStateChanged(event)
      );

      // Escuchar cambios en el reproductor remoto
      this.remotePlayerController.addEventListener(
        chrome.cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        () => this.updateCastState()
      );

      this.remotePlayerController.addEventListener(
        chrome.cast.framework.RemotePlayerEventType.IS_PLAYING_CHANGED,
        () => this.updateCastState()
      );

      this.remotePlayerController.addEventListener(
        chrome.cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
        () => this.updateCastState()
      );

      this.remotePlayerController.addEventListener(
        chrome.cast.framework.RemotePlayerEventType.DURATION_CHANGED,
        () => this.updateCastState()
      );

      // Marcar como disponible
      this.updateCastState();
      console.log('✅ Chromecast API inicializada correctamente');

    } catch (error) {
      console.error('❌ Error configurando Cast Context:', error);
    }
  }

  private onSessionStateChanged(event: any): void {
    console.log('📡 Estado de sesión cambiado:', event.sessionState);
    this.updateCastState();
  }

  private updateCastState(): void {
    const session = this.castContext?.getCurrentSession();
    const state: CastState = {
      isAvailable: !!this.castContext,
      isConnected: this.remotePlayer?.isConnected || false,
      isPlaying: this.remotePlayer?.isPaused === false,
      deviceName: session?.getCastDevice()?.friendlyName || null,
      currentTime: this.remotePlayer?.currentTime || 0,
      duration: this.remotePlayer?.duration || 0
    };

    this.castStateSubject.next(state);
  }

  /**
   * Abre el diálogo para seleccionar dispositivo
   */
public requestSession(): void {
  console.log('📡 requestSession() llamado');
  console.log('Cast Context:', this.castContext);

  if (!this.castContext) {
    console.error('❌ Cast Context no disponible');
    alert('Cast Context no está inicializado. Recarga la página.');
    return;
  }

  console.log('✅ Solicitando sesión de Cast...');

  this.castContext.requestSession()
    .then(() => {
      console.log('✅ Sesión de Cast iniciada exitosamente');
      this.updateCastState();
    })
    .catch((error: any) => {
      console.error('❌ Error al iniciar sesión:', error);
      console.error('Código de error:', error.code);
      console.error('Descripción:', error.description);

      if (error.code === 'cancel') {
        console.log('ℹ️ Usuario canceló la selección');
      } else {
        alert(`Error de Chromecast: ${error.description || error.code}`);
      }
    });
}

  /**
   * Carga un video en el Chromecast
   */
  public loadMedia(streamUrl: string, title: string, posterUrl?: string): void {
    const session = this.castContext?.getCurrentSession();
    if (!session) {
      console.error('No hay sesión activa de Cast');
      return;
    }

    const mediaInfo = new chrome.cast.media.MediaInfo(streamUrl, 'application/x-mpegURL');

    // Metadatos
    const metadata = new chrome.cast.media.GenericMediaMetadata();
    metadata.title = title;
    if (posterUrl) {
      metadata.images = [new chrome.cast.Image(posterUrl)];
    }

    mediaInfo.metadata = metadata;
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;

    session.loadMedia(request)
      .then(() => {
        console.log('✅ Media cargada en Chromecast');
        this.updateCastState();
      })
      .catch((error: any) => {
        console.error('❌ Error cargando media:', error);
      });
  }

  /**
   * Reproduce el video
   */
  public play(): void {
    if (this.remotePlayer?.isPaused) {
      this.remotePlayerController?.playOrPause();
    }
  }

  /**
   * Pausa el video
   */
  public pause(): void {
    if (!this.remotePlayer?.isPaused) {
      this.remotePlayerController?.playOrPause();
    }
  }

  /**
   * Alterna play/pausa
   */
  public togglePlayPause(): void {
    this.remotePlayerController?.playOrPause();
  }

  /**
   * Cambia el volumen (0-1)
   */
  public setVolume(volume: number): void {
    if (this.remotePlayer) {
      this.remotePlayer.volumeLevel = Math.max(0, Math.min(1, volume));
      this.remotePlayerController?.setVolumeLevel();
    }
  }

  /**
   * Silencia o activa el audio
   */
  public toggleMute(): void {
    if (this.remotePlayer) {
      this.remotePlayer.isMuted = !this.remotePlayer.isMuted;
      this.remotePlayerController?.muteOrUnmute();
    }
  }

  /**
   * Busca a una posición específica (en segundos)
   */
  public seek(time: number): void {
    if (this.remotePlayer) {
      this.remotePlayer.currentTime = time;
      this.remotePlayerController?.seek();
    }
  }

  /**
   * Detiene la sesión de Cast
   */
  public endSession(): void {
    const session = this.castContext?.getCurrentSession();
    if (session) {
      session.endSession(true);
    }
  }

  /**
   * Obtiene el estado actual
   */
  public getCurrentState(): CastState {
    return this.castStateSubject.value;
  }
}
