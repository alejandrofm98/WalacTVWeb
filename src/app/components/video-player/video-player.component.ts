import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  HostListener
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ActivatedRoute, Router} from '@angular/router';
import {DataService} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {Events} from '../../models';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';
import {Channel} from '../../models/channel.model';
import {Subscription} from 'rxjs';

import mpegts from 'mpegts.js/dist/mpegts.js';
import Hls from 'hls.js';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule, NavbarComponent],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @Input() streamUrl: string = '';
  @Input() eventTitle: string = 'Reproducción en vivo';
  @Input() channel: Channel | null = null;

  private player: any; // mpegts.js player
  private hlsPlayer?: Hls; // hls.js player
  private shouldInitializePlayer = false;
  private dataService = inject(DataService);
  private playerState = inject(PlayerStateService);
  private cdr = inject(ChangeDetectorRef);
  private castSubscription?: Subscription;
  private router = inject(Router);

  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;

  eventData?: Events;
  currentOriginalUrl: string = '';
  isChannelMode = false;

  // Datos para navegación de canales
  allChannels: Channel[] = [];
  currentChannelIndex: number = -1;
  isFullscreen = false;

  // Overlay de cambio de canal
  showChannelOverlay = false;
  private hideChannelOverlayTimeout?: number;

  // Touch gestures para móvil
  private touchStartX = 0;
  private touchStartY = 0;
  private touchEndX = 0;
  private touchEndY = 0;

  constructor(private route: ActivatedRoute) {
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (!this.isChannelMode) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nextChannel();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previousChannel();
    }
  }

  @HostListener('document:fullscreenchange')
  @HostListener('document:webkitfullscreenchange')
  @HostListener('document:mozfullscreenchange')
  @HostListener('document:msfullscreenchange')
  onFullscreenChange() {
    const doc = document as any;
    this.isFullscreen = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    // Si salimos de fullscreen, desbloqueamos la orientación y mostramos navbar
    if (!this.isFullscreen) {
      this.unlockOrientation();
      this.showNavbar();
    }

    this.cdr.markForCheck();
  }

  @HostListener('window:orientationchange', ['$event'])
  onOrientationChange(event: any) {
    console.log('Orientación cambiada:', event.target.screen.orientation.type);
  }

  onTouchStart(event: TouchEvent): void {
    if (!this.isChannelMode) return;

    this.touchStartX = event.changedTouches[0].screenX;
    this.touchStartY = event.changedTouches[0].screenY;
  }

  onTouchEnd(event: TouchEvent): void {
    if (!this.isChannelMode) return;

    this.touchEndX = event.changedTouches[0].screenX;
    this.touchEndY = event.changedTouches[0].screenY;
    this.handleSwipeGesture();
  }

  private handleSwipeGesture(): void {
    const swipeThreshold = 50;
    const deltaX = this.touchEndX - this.touchStartX;
    const deltaY = Math.abs(this.touchEndY - this.touchStartY);

    if (Math.abs(deltaX) > swipeThreshold && deltaY < swipeThreshold) {
      if (deltaX > 0) {
        this.previousChannel();
      } else {
        this.nextChannel();
      }
    }
  }

  ngOnInit() {
    this.loadAllChannels();

    this.route.paramMap.subscribe(params => {
      const slug = params.get('title');
      if (!slug) return;

      const savedChannel = this.playerState.getChannel();
      const savedEvent = this.playerState.getEvent();

      if (savedChannel && slugify(savedChannel.nombre) === slug) {
        this.channel = savedChannel;
        this.isChannelMode = true;
        this.eventTitle = savedChannel.nombre;
        this.updateCurrentChannelIndex();
        this.loadStreamFromChannel();
        return;
      }

      if (savedEvent && slugify(savedEvent.titulo) === slug) {
        this.eventData = savedEvent;
        this.isChannelMode = false;
        this.eventTitle = savedEvent.titulo;
        this.loadStreamFromEvent();
        return;
      }

      this.loadFromBackend(slug);
    });
  }

  private loadAllChannels(): void {
    this.dataService.getChannels().subscribe({
      next: (data: any) => {
        if (data?.items) {
          const channels = Object.values(data.items) as Channel[];
          this.allChannels = channels.sort((a, b) => a.numero - b.numero);
          this.updateCurrentChannelIndex();
          console.log('📺 Canales ordenados por número:', this.allChannels.length);
        }
      },
      error: (error) => console.error('Error cargando canales:', error)
    });
  }

  private updateCurrentChannelIndex(): void {
    if (this.channel && this.allChannels.length > 0) {
      this.currentChannelIndex = this.allChannels.findIndex(
        c => c.numero === this.channel!.numero
      );
    }
  }

  nextChannel(): void {
    if (!this.isChannelMode || this.allChannels.length === 0) return;
    const currentIndex = this.allChannels.findIndex(c => c.numero === this.channel!.numero);
    if (currentIndex === -1 || currentIndex >= this.allChannels.length - 1) return;
    const nextChannel = this.allChannels[currentIndex + 1];
    this.navigateToChannel(nextChannel);
  }

  previousChannel(): void {
    if (!this.isChannelMode || this.allChannels.length === 0) return;
    const currentIndex = this.allChannels.findIndex(c => c.numero === this.channel!.numero);
    if (currentIndex <= 0) return;
    const prevChannel = this.allChannels[currentIndex - 1];
    this.navigateToChannel(prevChannel);
  }

  private navigateToChannel(channel: Channel): void {
    this.channel = channel;
    this.eventTitle = channel.nombre;
    this.currentChannelIndex = this.allChannels.findIndex(c => c.numero === channel.numero);
    this.playerState.setChannel(channel);

    const slug = slugify(channel.nombre);
    this.router.navigate(['/player', slug], { replaceUrl: true });

    this.showChannelOverlay = true;
    if (this.hideChannelOverlayTimeout) {
      clearTimeout(this.hideChannelOverlayTimeout);
    }
    this.hideChannelOverlayTimeout = window.setTimeout(() => {
      this.showChannelOverlay = false;
      this.cdr.markForCheck();
    }, 3000);

    this.loadStreamFromChannel();
  }

  get hasPreviousChannel(): boolean {
    if (!this.isChannelMode || this.allChannels.length === 0 || !this.channel) return false;
    const currentIndex = this.allChannels.findIndex(c => c.numero === this.channel!.numero);
    return currentIndex > 0;
  }

  get hasNextChannel(): boolean {
    if (!this.isChannelMode || this.allChannels.length === 0 || !this.channel) return false;
    const currentIndex = this.allChannels.findIndex(c => c.numero === this.channel!.numero);
    return currentIndex !== -1 && currentIndex < this.allChannels.length - 1;
  }

  private loadFromBackend(slug: string) {
    this.dataService.getChannels().subscribe({
      next: (data) => {
        if (data?.items) {
          const channels = Object.values(data.items) as Channel[];
          const foundChannel = channels.find((c: Channel) =>
            slugify(c.nombre) === slug
          );

          if (foundChannel) {
            this.channel = foundChannel;
            this.isChannelMode = true;
            this.eventTitle = foundChannel.nombre;
            this.playerState.setChannel(foundChannel);
            this.updateCurrentChannelIndex();
            this.loadStreamFromChannel();
            return;
          }
        }
        this.loadEventFromBackend(slug);
      },
      error: () => this.loadEventFromBackend(slug)
    });
  }

  private loadEventFromBackend(slug: string) {
    this.dataService.getItems().subscribe({
      next: (data) => {
        if (!data?.eventos) return;

        const foundEvent = data.eventos.find((e: Events) =>
          slugify(e.titulo) === slug
        );

        if (foundEvent) {
          this.eventData = foundEvent;
          this.isChannelMode = false;
          this.eventTitle = foundEvent.titulo;
          this.playerState.setEvent(foundEvent);
          this.loadStreamFromEvent();
        }
      }
    });
  }

  private loadStreamFromChannel() {
    if (!this.channel?.url) return;

    // Canales siempre aplican proxy
    const finalUrl = this.getProxiedUrl(this.channel.url, true);
    this.streamUrl = finalUrl;
    this.currentOriginalUrl = finalUrl;
    this.shouldInitializePlayer = true;

    if (this.videoElement) {
      setTimeout(() => this.initializePlayer(), 0);
    }
  }

  ngAfterViewInit() {
    if (this.shouldInitializePlayer) {
      setTimeout(() => this.initializePlayer(), 0);
    }

    setTimeout(() => {
      const volumeSlider = document.querySelector('.volume-control input[type="range"]') as HTMLInputElement;
      if (volumeSlider) {
        const percentage = (this.volume * 100);
        volumeSlider.style.setProperty('--value', `${percentage}%`);
      }
    }, 100);
  }

  ngOnDestroy() {
    // Destruir ambos reproductores
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    if (this.hlsPlayer) {
      this.hlsPlayer.destroy();
      this.hlsPlayer = undefined;
    }
    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout);
    }
    if (this.hideChannelOverlayTimeout) {
      clearTimeout(this.hideChannelOverlayTimeout);
    }
    if (this.castSubscription) {
      this.castSubscription.unsubscribe();
    }
    // Desbloquear orientación y mostrar navbar al destruir el componente
    this.unlockOrientation();
    this.showNavbar();
  }

  // =========================
  // MÉTODOS DE AYUDA (HELPERS)
  // =========================

  /**
   * Normaliza una URL quitando protocolos y prefijos de proxy para poder compararlas.
   */
  private normalizeUrlForComparison(url: string): string {
    if (!url) return '';

    let clean = url;

    // Remover formato antiguo de proxy
    clean = clean.replace('iptv.walerike.com/stream-proxy/', '');

    // Remover nuevo formato de proxy
    if (clean.includes('walactv.walerike.com/proxy?url=')) {
      try {
        const urlParam = new URL(clean).searchParams.get('url');
        if (urlParam) {
          clean = urlParam;
        } else {
          clean = clean.replace(/.*walactv\.walerike\.com\/proxy\?url=/gi, '');
        }
      } catch {
        clean = clean.replace(/.*walactv\.walerike\.com\/proxy\?url=/gi, '');
      }
    }

    // Quitamos protocolos (http/https)
    clean = clean.replace(/^https?:\/\//, '');

    return clean;
  }

  /**
   * Determina si un enlace necesita pasar por el proxy de iptv.walerike.com
   * Esto aplica para enlaces de Acestream/line.ultra-8k.xyz
   */
  private needsProxyTransform(url: string): boolean {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    // Solo aplicamos proxy para URLs de line.ultra-8k.xyz (acestream)
    return lowerUrl.includes('line.ultra-8k.xyz');
  }

  /**
   * Detecta si una URL ya tiene formato de proxy aplicado.
   */
  private isAlreadyProxied(url: string): boolean {
    if (!url) return false;
    return url.includes('walactv.walerike.com/proxy?url=') ||
           url.includes('iptv.walerike.com/stream-proxy/');
  }

  /**
   * Devuelve la URL transformada con el proxy si es necesario.
   * @param url - URL original
   * @param forceProxy - Forzar proxy (usado para canales)
   */
  private getProxiedUrl(url: string, forceProxy: boolean = false): string {
    if (!url) return '';

    // Si ya está proxificada (formato nuevo walactv o antiguo iptv), retornarla tal cual
    if (this.isAlreadyProxied(url)) {
      return url;
    }

    // Si forzamos proxy (canales), aplicar transformación
    if (forceProxy) {
      return this.applyProxyTransform(url);
    }

    // Si es una URL que necesita proxy (line.ultra-8k.xyz), aplicar transformación
    if (this.needsProxyTransform(url)) {
      return this.applyProxyTransform(url);
    }

    // En cualquier otro caso, devolver la URL sin modificar
    return url;
  }

  /**
   * Aplica la transformación de proxy a una URL.
   */
  private applyProxyTransform(url: string): string {
    const cleanUrl = url.replace(/^https?:\/\//, '');
    return `https://iptv.walerike.com/stream-proxy/${cleanUrl}`;
  }

  // =========================
  // MÉTODOS PÚBLICOS PARA EL HTML
  // =========================

  /**
   * Verifica si un valor es un array (usado en el template)
   */
  isArray(value: any): boolean {
    return Array.isArray(value);
  }

  /**
   * Convierte un valor a string[] para usar en *ngFor
   */
  asStringArray(value: any): string[] {
    return Array.isArray(value) ? value : [];
  }

  /**
   * Convierte un valor a string
   */
  asString(value: any): string {
    return typeof value === 'string' ? value : '';
  }

  /**
   * Se usa en el HTML para saber qué botón de calidad resaltar.
   * Compara la URL "cruda" del botón con la URL "transformada" que se está reproduciendo.
   */
  isStreamActive(url: string): boolean {
    return this.normalizeUrlForComparison(this.currentOriginalUrl) === this.normalizeUrlForComparison(url);
  }

  /**
   * Se ejecuta al hacer clic en un botón de calidad.
   * Recibe la URL cruda desde el HTML, la transforma y cambia el stream.
   */
  changeStream(url: string) {
    // Transformamos la URL cruda usando la lógica de proxy
    const finalUrl = this.getProxiedUrl(url, false);

    this.currentOriginalUrl = finalUrl;
    this.streamUrl = finalUrl;
    this.initializePlayer();
  }

  get availableStreams(): string[] {
    // Canales: Siempre proxy
    if (this.isChannelMode && this.channel?.url) {
      return [this.getProxiedUrl(this.channel.url, true)];
    }

    // Eventos: Proxy solo si es acestream
    if (!this.isChannelMode && this.eventData?.enlaces) {
      const streams: string[] = [];

      this.eventData.enlaces.forEach(enlace => {
        if (enlace.calidades && Array.isArray(enlace.calidades)) {
          enlace.calidades.forEach(calidad => {
            if (calidad.m3u8) {
              streams.push(this.getProxiedUrl(calidad.m3u8, false));
            }
          });
        } else if ((enlace as any).m3u8) {
          const oldM3u8 = (enlace as any).m3u8;
          if (Array.isArray(oldM3u8)) {
            oldM3u8.forEach(u => streams.push(this.getProxiedUrl(u, false)));
          } else {
            streams.push(this.getProxiedUrl(oldM3u8, false));
          }
        }
      });

      return streams;
    }
    return [];
  }

  get streamSectionTitle(): string {
    if (this.isChannelMode && this.channel) {
      return this.channel.nombre;
    }

    if (!this.isChannelMode && this.eventData?.enlaces?.length) {
      const currentNormalized = this.normalizeUrlForComparison(this.currentOriginalUrl);

      for (const enlace of this.eventData.enlaces) {
        if (enlace.calidades) {
           const foundInCalidad = enlace.calidades.find(c => this.normalizeUrlForComparison(c.m3u8) === currentNormalized);
           if (foundInCalidad) return enlace.canal || 'Stream';
        }
        // Fallback estructura antigua
        if ((enlace as any).m3u8) {
           const oldM3u8 = (enlace as any).m3u8;
           const oldLinks = Array.isArray(oldM3u8) ? oldM3u8 : [oldM3u8];
           if (oldLinks.some(l => this.normalizeUrlForComparison(l) === currentNormalized)) {
             return enlace.canal || 'Stream';
           }
        }
      }
      return this.eventData.enlaces[0].canal || 'Stream';
    }

    return 'Stream';
  }

  private loadStreamFromEvent() {
    if (!this.eventData?.enlaces || this.eventData.enlaces.length === 0) return;

    const firstLink = this.eventData.enlaces[0];

    if (firstLink.calidades && firstLink.calidades.length > 0) {
      const firstQualityUrl = firstLink.calidades[0].m3u8;
      if (firstQualityUrl) {
        const finalUrl = this.getProxiedUrl(firstQualityUrl, false);

        this.currentOriginalUrl = finalUrl;
        this.streamUrl = finalUrl;
        this.shouldInitializePlayer = true;
        this.cdr.detectChanges();

        if (this.videoElement) {
          this.initializePlayer();
        }
        return;
      }
    }

    // Fallback estructura antigua
    const fallbackUrl = (firstLink as any).m3u8;
    if (fallbackUrl) {
        const urlToUse = Array.isArray(fallbackUrl) ? fallbackUrl[0] : fallbackUrl;
        const finalUrl = this.getProxiedUrl(urlToUse, false);

        this.currentOriginalUrl = finalUrl;
        this.streamUrl = finalUrl;
        this.shouldInitializePlayer = true;
        this.cdr.detectChanges();
        if (this.videoElement) {
          this.initializePlayer();
        }
    }
  }

  // Reemplaza el método initializePlayer() con esta versión mejorada:

// Reemplaza el método initializePlayer() con esta versión mejorada:

private initializePlayer() {
  const video = this.videoElement?.nativeElement;
  if (!video) return;

  const urlToUse = this.streamUrl;
  if (!urlToUse) return;

  // GUARDAR el estado actual del audio ANTES de destruir el player
  const wasPlaying = !video.paused;
  const currentVolume = video.volume;
  const wasMuted = video.muted;

  // Destruir players anteriores
  if (this.player) {
    this.player.destroy();
    this.player = null;
  }
  if (this.hlsPlayer) {
    this.hlsPlayer.destroy();
    this.hlsPlayer = undefined;
  }

  // Determinar si la URL es HLS (.m3u8) o MPEG-TS
  const isHLS = urlToUse.toLowerCase().includes('.m3u8');

  if (isHLS) {
    console.log('🎬 Reproduciendo HLS');

    if (Hls.isSupported()) {
      console.log('✅ Usando HLS.js');

      this.hlsPlayer = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        debug: false
      });

      this.hlsPlayer.loadSource(urlToUse);
      this.hlsPlayer.attachMedia(video);

      this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('✅ Manifest HLS cargado correctamente');

        // RESTAURAR el estado del audio ANTES de reproducir
        video.volume = currentVolume;
        video.muted = wasMuted;

        // Si ya estaba reproduciendo (cambio de canal), reproducir directamente
        if (wasPlaying) {
          video.play().then(() => {
            console.log('✅ Reproducción iniciada manteniendo audio');
          }).catch((error) => {
            console.log('Error al reproducir:', error);
          });
        } else {
          // Primera carga: intentar autoplay
          video.play().catch((error) => {
            console.log('Autoplay bloqueado:', error);
            video.muted = true;
            video.play().catch(() => {
              console.log('Autoplay requiere interacción del usuario');
            });
          });
        }
      });

      this.hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS.js error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('❌ Error de red fatal, intentando recuperar...');
              this.hlsPlayer?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('❌ Error de medio fatal, intentando recuperar...');
              this.hlsPlayer?.recoverMediaError();
              break;
            default:
              console.error('❌ Error fatal no recuperable, destruyendo player');
              this.hlsPlayer?.destroy();
              this.hlsPlayer = undefined;
              break;
          }
        }
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('✅ Usando reproducción nativa de HLS (Safari)');

      // RESTAURAR el estado del audio ANTES de cargar
      video.volume = currentVolume;
      video.muted = wasMuted;

      video.src = urlToUse;
      video.load();

      // Si ya estaba reproduciendo (cambio de canal), reproducir directamente
      if (wasPlaying) {
        video.play().then(() => {
          console.log('✅ Reproducción iniciada manteniendo audio');
        }).catch((error) => {
          console.log('Error al reproducir:', error);
        });
      } else {
        // Primera carga: intentar autoplay
        video.play().catch((error) => {
          console.log('Autoplay bloqueado:', error);
          video.muted = true;
          video.play().catch(() => {
            console.log('Autoplay requiere interacción del usuario');
          });
        });
      }
    }

    this.setupVideoEventListeners(video);

  } else if (mpegts.isSupported()) {
    console.log('🎬 Reproduciendo MPEG-TS con mpegts.js');

    this.player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: urlToUse,
      enableWorker: true,
      liveBufferLatencyChasing: true,
      lazyLoad: false,
      enableStashBuffer: false,
      stashInitialSize: 128
    });

    this.player.on(mpegts.Events.ERROR, (type: any, detail: any) => {
      console.error('mpegts.js error:', type, detail);
      this.handlePlayerError(type, detail);
    });

    this.player.attachMediaElement(video);
    this.player.load();

    // RESTAURAR el estado del audio ANTES de reproducir
    video.volume = currentVolume;
    video.muted = wasMuted;

    // Si ya estaba reproduciendo (cambio de canal), reproducir directamente
    if (wasPlaying) {
      this.player.play().then(() => {
        console.log('✅ Reproducción iniciada manteniendo audio');
      }).catch((error: any) => {
        console.log('Error al reproducir:', error);
      });
    } else {
      // Primera carga: intentar autoplay
      this.player.play().catch((error: any) => {
        console.log('Autoplay bloqueado:', error);
        video.muted = true;
        this.player.play().catch(() => {
          console.log('Autoplay requiere interacción del usuario');
        });
      });
    }

    this.setupVideoEventListeners(video);
  }
}

  /**
   * Maneja errores del player de mpegts.js.
   */
  private handlePlayerError(type: any, detail: any): void {
    console.log('Player error handler:', type, detail);

    // Error de red o CORS
    if (type === 'networkError' || type === 'network') {
      console.log('Posible error de red o CORS, verificando URL...');
      // Aquí podrías implementar reintentos o cambiar de URL
    }

    // Error de medio
    if (type === 'mediaError' || type === 'media') {
      console.log('Error en el medio de reproducción');
    }
  }

  /**
   * Configura los event listeners del elemento de video.
   */
  private setupVideoEventListeners(video: HTMLVideoElement): void {
    video.addEventListener('play', () => {
      this.isPlaying = true;
      this.cdr.markForCheck();
    });

    video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.cdr.markForCheck();
    });

    video.addEventListener('volumechange', () => {
      this.volume = video.volume;
      this.isMuted = video.muted;
      this.cdr.markForCheck();
    });

    video.addEventListener('waiting', () => {
      console.log('Video esperando datos...');
    });

    video.addEventListener('canplay', () => {
      console.log('Video puede comenzar a reproducirse');
    });

    video.addEventListener('error', (e) => {
      console.error('Error en el elemento de video:', e);
    });
  }

  togglePlayPause() {
    const video = this.videoElement.nativeElement;
    video.paused ? video.play().catch(console.error) : video.pause();
  }

  toggleMute() {
    this.videoElement.nativeElement.muted = !this.videoElement.nativeElement.muted;
  }

  setVolume(event: any): void {
    const newVolume = parseFloat(event.target.value);
    this.volume = newVolume;

    const percentage = (newVolume * 100);
    event.target.style.setProperty('--value', `${percentage}%`);

    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.volume = newVolume;
      this.isMuted = newVolume === 0;
    }
  }

  // Método auxiliar para ocultar el navbar
  private hideNavbar(): void {
    const navbar = document.querySelector('app-navbar') as HTMLElement;
    if (navbar) {
      navbar.style.display = 'none';
    }
  }

  // Método auxiliar para mostrar el navbar
  private showNavbar(): void {
    const navbar = document.querySelector('app-navbar') as HTMLElement;
    if (navbar) {
      navbar.style.display = ''; // Restaura el estilo original del CSS
    }
  }

  toggleFullscreen() {
    const container = this.videoElement.nativeElement.parentElement;
    if (!container) return;

    const doc = document as any;
    const elem = container as any;

    const isInFullscreen = doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement;

    if (!isInFullscreen) {
      // Ocultar navbar antes de entrar en fullscreen
      this.hideNavbar();

      if (elem.requestFullscreen) elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
      else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
      else if (elem.msRequestFullscreen) elem.msRequestFullscreen();

      // Después intentamos bloquear la orientación a landscape
      this.lockToLandscape();
    } else {
      // Primero desbloqueamos la orientación
      this.unlockOrientation();

      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
      else if (doc.msExitFullscreen) doc.msExitFullscreen();
    }
  }

  /**
   * Bloquea la orientación de la pantalla en modo landscape (horizontal)
   * Requiere HTTPS y debe llamarse desde un gesto del usuario
   */
  private lockToLandscape(): void {
    // Verificar si la API de Screen Orientation está disponible
    if (this.isOrientationLockSupported()) {
      const screenOrientation = (screen as any).orientation;

      screenOrientation.lock('landscape')
        .then(() => {
          console.log('✅ Pantalla bloqueada en orientación horizontal');
        })
        .catch((error: any) => {
          console.log('⚠️ No se pudo bloquear la orientación:', error);
        });
    }
  }

  /**
   * Desbloquea la orientación de la pantalla
   */
  private unlockOrientation(): void {
    if (this.isOrientationLockSupported()) {
      (screen as any).orientation.unlock();
      console.log('✅ Orientación desbloqueada');
    }
  }

  /**
   * Verifica si la API de Screen Orientation está disponible
   */
  private isOrientationLockSupported(): boolean {
    return !!(
      typeof screen !== 'undefined' &&
      (screen as any).orientation &&
      typeof (screen as any).orientation.lock === 'function'
    );
  }

  onMouseMove() {
    this.showControls = true;
    if (this.hideControlsTimeout) clearTimeout(this.hideControlsTimeout);
    this.hideControlsTimeout = window.setTimeout(() => {
      if (this.isPlaying) {
        this.showControls = false;
        this.cdr.markForCheck();
      }
    }, 3000);
  }

  onMouseLeave() {
    if (this.isPlaying) {
      this.showControls = false;
      this.cdr.markForCheck();
    }
  }

  changeChannelStream(index: number) {
    if (!this.isChannelMode && this.eventData?.enlaces?.[index]) {
      const targetLink = this.eventData.enlaces[index];
      let newUrl = '';

      if (targetLink.calidades && targetLink.calidades.length > 0) {
        newUrl = targetLink.calidades[0].m3u8;
      } else if ((targetLink as any).m3u8) {
         const oldM3u8 = (targetLink as any).m3u8;
         newUrl = Array.isArray(oldM3u8) ? oldM3u8[0] : oldM3u8;
      }

      if (newUrl) {
        const finalUrl = this.getProxiedUrl(newUrl, false);
        this.streamUrl = finalUrl;
        this.currentOriginalUrl = finalUrl;
        this.initializePlayer();
      }
    }
  }
}
