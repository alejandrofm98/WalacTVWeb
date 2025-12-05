import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Input,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ActivatedRoute} from '@angular/router';
import {DataService} from '../../services/data.service';
import {PlayerStateService} from '../../services/player-state.service';
import {Events} from '../../models';
import {slugify} from '../../utils/slugify';
import {NavbarComponent} from '../../shared/components/navbar-component/navbar.component';
import {environment} from '../../../environments/environment';
import {Channel} from '../../models/channel.model';
import {Subscription} from 'rxjs';

import mpegts from 'mpegts.js/dist/mpegts.js';


@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule, NavbarComponent],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @Input() streamUrl: string | string[] = '';
  @Input() eventTitle: string = 'Reproducción en vivo';
  @Input() channel: Channel | null = null;

  private player: any; // 👉 player mpegts
  private shouldInitializePlayer = false;
  private dataService = inject(DataService);
  private playerState = inject(PlayerStateService);
  private cdr = inject(ChangeDetectorRef);
  private castSubscription?: Subscription;

  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;

  eventData?: Events;
  currentOriginalUrl: string = '';
  isChannelMode = false;

  constructor(private route: ActivatedRoute) {
  }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('title');
      if (!slug) return;

      const savedChannel = this.playerState.getChannel();
      const savedEvent = this.playerState.getEvent();

      if (savedChannel && slugify(savedChannel.canal) === slug) {
        this.channel = savedChannel;
        this.isChannelMode = true;
        this.eventTitle = savedChannel.canal;
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

  private loadFromBackend(slug: string) {
    this.dataService.getChannels().subscribe({
      next: (data) => {
        if (data?.canales) {
          const foundChannel = data.canales.find((c: Channel) =>
            slugify(c.canal) === slug
          );

          if (foundChannel) {
            this.channel = foundChannel;
            this.isChannelMode = true;
            this.eventTitle = foundChannel.canal;
            this.playerState.setChannel(foundChannel);
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
    if (!this.channel?.m3u8?.length) return;

    this.streamUrl = this.processStreamUrl(this.channel.m3u8[0]);
    this.currentOriginalUrl = this.channel.m3u8[0];
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
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout);
    }
    if (this.castSubscription) {
      this.castSubscription.unsubscribe();
    }
  }

  get availableStreams(): string[] {
    if (this.isChannelMode && this.channel) {
      return this.channel.m3u8 ?? [];
    }
    if (!this.isChannelMode && this.eventData) {
      return this.eventData.enlaces?.flatMap(e => e.m3u8 ?? []) ?? [];
    }
    return [];
  }

  get streamSectionTitle(): string {
    if (this.isChannelMode && this.channel) {
      return this.channel.canal;
    }

    if (!this.isChannelMode && this.eventData?.enlaces?.length) {
      const activeLink = this.eventData.enlaces.find(e =>
        e.m3u8?.includes(this.currentOriginalUrl)
      );
      return activeLink?.canal || this.eventData.enlaces[0].canal || 'Stream';
    }

    return 'Stream';
  }

  private loadStreamFromEvent() {
    const firstM3u8 = this.eventData?.enlaces?.[0]?.m3u8?.[0];
    if (!firstM3u8) return;

    this.currentOriginalUrl = firstM3u8;
    this.streamUrl = this.processStreamUrl(firstM3u8);
    this.shouldInitializePlayer = true;
    this.cdr.detectChanges();

    if (this.videoElement) {
      this.initializePlayer();
    }
  }

  // 🔥🔥🔥 YA NO DEVUELVE manifest.m3u8 – siempre respetamos la URL
  private processStreamUrl(url: string): string {
    try {
      // Detectar URLs locales de AceStream
      if (url.includes("/ace/getstream?id=")) {
        // Extraer el ID
        const idMatch = url.match(/id=([a-fA-F0-9]+)/);
        if (idMatch) {
          const id = idMatch[1];
          return `https://acestream.walerike.com/ace/getstream?id=${id}`;
        }
      }

      // También para URLs con redirect /ace/r/.... → obtener getstream puro
      const redirectMatch = url.match(/\/ace\/r\/[a-fA-F0-9]+\/([a-fA-F0-9]+)/);
      if (redirectMatch) {
        const id = redirectMatch[1];
        return `https://acestream.walerike.com/ace/getstream?id=${id}`;
      }

      // Cualquier otra URL queda igual
      return url;

    } catch (e) {
      console.error("Error procesando URL:", e);
      return url;
    }
  }


  // 🔥🔥🔥 Todo el reproductor se maneja con MPEGTS.JS
  private initializePlayer() {
    const video = this.videoElement?.nativeElement;
    if (!video) return;

    const urlToUse = Array.isArray(this.streamUrl) ? this.streamUrl[0] : this.streamUrl;
    if (!urlToUse) return;

    if (this.player) {
      this.player.destroy();
      this.player = null;
    }

    if (mpegts.isSupported()) {
      this.player = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: urlToUse,
        enableWorker: true,
        liveBufferLatencyChasing: true,
        lazyLoad: false
      });

      this.player.attachMediaElement(video);
      this.player.load();
      this.player.play().catch(() => {
        video.muted = true;
        this.player!.play();
      });
    }

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
      if (elem.requestFullscreen) elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
      else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
      else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
    } else {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
      else if (doc.msExitFullscreen) doc.msExitFullscreen();
    }
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

  changeStream(stream: string) {
    this.currentOriginalUrl = stream;
    this.streamUrl = this.processStreamUrl(stream);
    this.initializePlayer();
  }

  changeChannelStream(index: number) {
    if (this.channel?.m3u8?.[index]) {
      this.streamUrl = this.channel.m3u8[index];
      this.currentOriginalUrl = this.channel.m3u8[index];
      this.initializePlayer();
    }
  }
}

