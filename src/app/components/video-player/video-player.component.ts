import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  Input,
  OnDestroy,
  ChangeDetectorRef,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ChannelOption } from '../../models/channel-option.model';
import Hls from 'hls.js';

@Component({
  selector: 'app-video-player',
  imports: [CommonModule],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @Input() streamUrl: string | string[] = '';
  @Input() eventTitle: string = 'Reproducción en vivo';

  private hls?: Hls;
  isPlaying = false;
  volume = 1;
  isMuted = false;
  showControls = true;
  private hideControlsTimeout?: number;
  private shouldInitializePlayer = false;

  channel1Options: ChannelOption[] = [
    { label: 'Opción 1', value: 'option1' },
    { label: 'Opción 2', value: 'option2' },
    { label: 'Opción 3', value: 'option3' },
    { label: 'Opción 4', value: 'option4' }
  ];

  channel2Options: ChannelOption[] = [
    { label: 'Opción 1', value: 'option1' },
    { label: 'Opción 2', value: 'option2' },
    { label: 'Opción 3', value: 'option3' },
    { label: 'Opción 4', value: 'option4' }
  ];

  selectedChannel1Option = 'option1';
  selectedChannel2Option = 'option1';

  constructor(
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['streamId']) {
        const streamIdParam = params['streamId'];
        const streamIdStr = Array.isArray(streamIdParam) ? streamIdParam[0] : streamIdParam;

        console.log('📥 streamId recibido:', streamIdStr);

        try {
          const url = new URL(streamIdStr);

          if (url.toString().startsWith('http://127.0.0.1:6878')) {
            const id = url.searchParams.get('id');
            this.streamUrl = '/apiace/ace/manifest.m3u8?id=' + id;
          } else if (url.toString().startsWith('https://walactv.walerike.com/proxy?url=')) {
            const fullUrl = url.toString();
            this.streamUrl = fullUrl.replace('https://walactv.walerike.com', '/apiwalactv');
          } else {
            this.streamUrl = streamIdStr;
          }
        } catch (e) {
          console.error('⚠️ Error parsing URL:', e);
          this.streamUrl = streamIdParam;
        }

        console.log('🔗 URL final del stream:', this.streamUrl);
        this.eventTitle = params['channelName'] || this.eventTitle;
        this.shouldInitializePlayer = true;
      }
    });
  }

  ngAfterViewInit() {
    if (this.shouldInitializePlayer) {
      setTimeout(() => this.initializePlayer(), 0);
    }
  }

  ngOnDestroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }
    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout);
    }
  }

  /** =========================================================
   * 🎬 Inicializar HLS.js
   * ========================================================= */
  private async initializePlayer() {
    const video = this.videoElement.nativeElement;
    const urlToUse = Array.isArray(this.streamUrl) ? this.streamUrl[0] : this.streamUrl;

    if (!urlToUse) {
      console.error('❌ No stream URL provided');
      return;
    }

    console.log('🎥 Inicializando HLS con URL:', urlToUse);

    if (this.hls) {
      this.hls.destroy();
      this.hls = undefined;
    }

    if (Hls.isSupported()) {
      this.hls = new Hls({ autoStartLoad: true });
      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        console.log('📡 Media attached, cargando URL HLS...');
        this.hls?.loadSource(urlToUse);
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('✅ Manifest parsed, listo para reproducir');
        video.play().catch(err => console.error('❌ Error al reproducir:', err));
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('⚠️ HLS.js error:', data);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari nativo
      video.src = urlToUse;
      video.addEventListener('loadedmetadata', () => video.play());
    }

    // Listeners básicos
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

  // 🎮 Controles del reproductor
  togglePlayPause() {
    const video = this.videoElement.nativeElement;
    if (video.paused) video.play().catch(err => console.error('❌ Error al reproducir:', err));
    else video.pause();
  }

  toggleMute() {
    const video = this.videoElement.nativeElement;
    video.muted = !video.muted;
  }

  setVolume(event: Event) {
    const input = event.target as HTMLInputElement;
    const video = this.videoElement.nativeElement;
    video.volume = parseFloat(input.value);
  }

  toggleFullscreen() {
    const video = this.videoElement.nativeElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else video.requestFullscreen();
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

  selectChannel1Option(value: string) {
    this.selectedChannel1Option = value;
  }

  selectChannel2Option(value: string) {
    this.selectedChannel2Option = value;
  }
}
