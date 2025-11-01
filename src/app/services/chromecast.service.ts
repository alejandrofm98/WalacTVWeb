// chromecast.service.ts
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

    // Debug: comprobar estado pasado un tiempo
    setTimeout(() => {
      console.log('🔍 Verificación de Cast después de 3s:');
      console.log('- window.chrome.cast:', (window as any)['chrome']?.cast);
      console.log('- CastContext:', this.castContext);
      console.log('- Estado actual:', this.castStateSubject.value);
    }, 3000);
  }

  private initializeCastApi(): void {
    // Evitamos sobrescribir si ya hay handler
    if ((window as any).__onGCastApiAvailable) {
      // Si ya existe, aún así intentamos comprobar si framework ya está listo
      this.trySetupFramework();
      return;
    }

    (window as any).__onGCastApiAvailable = (isAvailable: boolean) => {
      console.log('🧩 __onGCastApiAvailable llamado:', isAvailable);

      if (isAvailable && (window as any).chrome?.cast?.framework) {
        this.setupCastContext();
      } else {
        console.warn('⚠️ Google Cast API no disponible aún, iniciando reintentos...');
        // Reintentar cada 1s hasta que chrome.cast.framework exista (timeout indefinido)
        const retry = setInterval(() => {
          if ((window as any).chrome?.cast?.framework) {
            clearInterval(retry);
            console.log('✅ Cast Framework listo (por retry)');
            this.setupCastContext();
          }
        }, 1000);
      }
    };

    // Por si el SDK ya se cargó antes de asignar el handler
    this.trySetupFramework();
  }

  private trySetupFramework() {
    if ((window as any).chrome?.cast?.framework && !this.castContext) {
      console.log('ℹ️ Cast framework ya presente, configurando ahora...');
      this.setupCastContext();
    }
  }

  private setupCastContext(): void {
    try {
      this.castContext = chrome.cast.framework.CastContext.getInstance();

      // Configurar opciones
      try {
        this.castContext.setOptions({
          receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });
      } catch (optErr) {
        console.warn('⚠️ No se pudieron establecer opciones de CastContext:', optErr);
      }

      // Configurar Remote Player
      this.remotePlayer = new chrome.cast.framework.RemotePlayer();
      this.remotePlayerController = new chrome.cast.framework.RemotePlayerController(this.remotePlayer);

      // Escuchar cambios en la conexión y reproduc.
      this.castContext.addEventListener(
        chrome.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (event: any) => this.onSessionStateChanged(event)
      );

      // Eventos del remote player controller
      const evts = chrome.cast.framework.RemotePlayerEventType;
      this.remotePlayerController.addEventListener(evts.IS_CONNECTED_CHANGED, () => this.updateCastState());
      this.remotePlayerController.addEventListener(evts.IS_PLAYING_CHANGED, () => this.updateCastState());
      this.remotePlayerController.addEventListener(evts.CURRENT_TIME_CHANGED, () => this.updateCastState());
      this.remotePlayerController.addEventListener(evts.DURATION_CHANGED, () => this.updateCastState());
      this.remotePlayerController.addEventListener(evts.IS_MUTED_CHANGED, () => this.updateCastState());
      this.remotePlayerController.addEventListener(evts.VOLUME_LEVEL_CHANGED, () => this.updateCastState());

      // Marcar como disponible y actualizar estado inicial
      this.updateCastState();
      console.log('✅ Chromecast API inicializada correctamente');
    } catch (error) {
      console.error('❌ Error configurando Cast Context:', error);
    }
  }

  private onSessionStateChanged(event: any): void {
    console.log('📡 Estado de sesión cambiado:', event?.sessionState);
    this.updateCastState();
  }

  private updateCastState(): void {
    const session = this.castContext?.getCurrentSession();
    const state: CastState = {
      isAvailable: !!this.castContext,
      isConnected: !!this.remotePlayer?.isConnected,
      isPlaying: this.remotePlayer?.isPaused === false,
      deviceName: session?.getCastDevice()?.friendlyName || null,
      currentTime: this.remotePlayer?.currentTime || 0,
      duration: this.remotePlayer?.duration || 0
    };

    this.castStateSubject.next(state);
  }

  // ========== API pública esperada por VideoPlayerComponent ==========

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
        // Algunos navegadores/SDK devuelven objetos con code/description
        try {
          console.error('Código de error:', error?.code);
          console.error('Descripción:', error?.description);
        } catch {}
        if (error?.code === 'cancel') {
          console.log('ℹ️ Usuario canceló la selección');
        } else {
          alert(`Error de Chromecast: ${error?.description || error?.message || error?.code || 'unknown'}`);
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
      alert('No hay una sesión de Chromecast activa. Selecciona un dispositivo primero.');
      return;
    }

    // MIME: para HLS la API de Cast suele aceptar 'application/x-mpegurl'
    const contentType = streamUrl?.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4';
    const mediaInfo = new chrome.cast.media.MediaInfo(streamUrl, contentType);

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
        alert('Error cargando media en Chromecast: ' + (error?.message || JSON.stringify(error)));
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
    } else {
      console.warn('No hay sesión para detener');
    }
  }

  /**
   * Obtiene el estado actual
   */
  public getCurrentState(): CastState {
    return this.castStateSubject.value;
  }
}
