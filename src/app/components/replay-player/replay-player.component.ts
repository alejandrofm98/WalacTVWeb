import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import Hls from 'hls.js';

import {
  DataService,
  IptvReplay,
  ReplaySource,
  ReplaySourceGroup,
} from '../../services/data.service';
import { NavbarComponent } from '../../shared/components/navbar-component/navbar.component';

@Component({
  selector: 'app-replay-player',
  standalone: true,
  imports: [CommonModule, RouterModule, NavbarComponent],
  templateUrl: './replay-player.component.html',
  styleUrls: ['./replay-player.component.css'],
})
export class ReplayPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('playerFrameShell', { read: ElementRef }) playerFrameShell?: ElementRef<HTMLElement>;

  replay: IptvReplay | null = null;
  loading = true;
  error: string | null = null;

  selectedGroupIndex = 0;
  selectedSourceIndex = 0;
  trustedEmbedUrl: SafeResourceUrl | null = null;
  directStreamUrl: string | null = null;
  isDirectPlayback = false;
  playbackModeLabel = 'Embed';

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dataService = inject(DataService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cdr = inject(ChangeDetectorRef);
  private hlsPlayer: Hls | null = null;

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        this.error = 'Replay no encontrado';
        this.loading = false;
        return;
      }

      this.loadReplay(slug);
    });
  }

  ngAfterViewInit(): void {
    this.queuePlaybackInitialization();
  }

  ngOnDestroy(): void {
    this.destroyPlayer();
  }

  loadReplay(slug: string): void {
    this.loading = true;
    this.error = null;
    this.replay = null;
    this.trustedEmbedUrl = null;

    this.dataService.getReplay(slug).subscribe({
      next: (replay) => {
        if (!replay) {
          this.error = 'No se pudo cargar este replay';
          this.loading = false;
          return;
        }

        this.replay = replay;
        this.selectInitialSource();
        this.loading = false;
        this.queuePlaybackInitialization();
      },
      error: () => {
        this.error = 'No se pudo cargar este replay';
        this.loading = false;
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/replays']);
  }

  selectSource(groupIndex: number, sourceIndex: number): void {
    this.selectedGroupIndex = groupIndex;
    this.selectedSourceIndex = sourceIndex;
    this.updateTrustedEmbedUrl();
    this.queuePlaybackInitialization();
  }

  isSelectedSource(groupIndex: number, sourceIndex: number): boolean {
    return this.selectedGroupIndex === groupIndex && this.selectedSourceIndex === sourceIndex;
  }

  getSelectedGroup(): ReplaySourceGroup | null {
    const groups = this.getVisibleVideoSources();
    if (!groups.length) {
      return null;
    }

    return groups[this.selectedGroupIndex] || null;
  }

  getSelectedSource(): ReplaySource | null {
    const group = this.getSelectedGroup();
    if (!group?.sources?.length) {
      return null;
    }

    return group.sources[this.selectedSourceIndex] || null;
  }

  hasPlayableSource(): boolean {
    return !!this.getSelectedDirectStreamUrl() || !!this.getSelectedEmbedUrl();
  }

  getPrimaryDescription(): string {
    return this.replay?.description || 'Replay UFC disponible';
  }

  getEventTypeLabel(eventType?: string | null): string {
    switch (eventType) {
      case 'numbered':
        return 'Numerado';
      case 'fight_night':
        return 'Fight Night';
      case 'other':
        return 'Otro';
      default:
        return 'Replay';
    }
  }

  getSourceCount(): number {
    return this.getVisibleVideoSources().reduce((total, group) => total + group.sources.length, 0);
  }

  getVisibleVideoSources(): ReplaySourceGroup[] {
    return (this.replay?.video_sources || [])
      .map((group) => ({
        ...group,
        sources: group.sources.filter((source) => !!source.web_embed_url?.trim()),
      }))
      .filter((group) => group.sources.length > 0);
  }

  trackByGroup(index: number, group: ReplaySourceGroup): string {
    return `${group.group}-${index}`;
  }

  trackBySource(index: number, source: ReplaySource): string {
    return `${source.label}-${index}`;
  }

  private selectInitialSource(): void {
    const groups = this.getVisibleVideoSources();
    if (!groups.length) {
      this.updateTrustedEmbedUrl();
      this.queuePlaybackInitialization();
      return;
    }

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const sourceIndex = groups[groupIndex].sources.findIndex(
        (source) => !!this.getPreferredEmbedUrl(source)
      );
      if (sourceIndex >= 0) {
        this.selectedGroupIndex = groupIndex;
        this.selectedSourceIndex = sourceIndex;
        this.updateTrustedEmbedUrl();
        this.queuePlaybackInitialization();
        return;
      }
    }

    this.selectedGroupIndex = 0;
    this.selectedSourceIndex = 0;
    this.updateTrustedEmbedUrl();
    this.queuePlaybackInitialization();
  }

  private updateTrustedEmbedUrl(): void {
    const embedUrl = this.getSelectedEmbedUrl();
    this.directStreamUrl = embedUrl ? null : this.getSelectedDirectStreamUrl();
    this.isDirectPlayback = !embedUrl && !!this.directStreamUrl;
    this.playbackModeLabel = this.isDirectPlayback ? 'Video directo' : (embedUrl ? '' : 'Sin player');
    this.trustedEmbedUrl = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private getSelectedDirectStreamUrl(): string | null {
    const source = this.getSelectedSource();
    if (!source || this.getPreferredEmbedUrl(source)) {
      return null;
    }

    return this.getDirectUrlForSource(source);
  }

  private getDirectUrlForSource(source: ReplaySource | null): string | null {
    if (!source) {
      return null;
    }

    const sourceIndex = source.source_index || this.selectedGroupIndex + 1;
    const buttonIndex = source.button_index || this.selectedSourceIndex + 1;
    const slug = this.replay?.slug;

    if (slug) {
      const proxiedStreamUrl = this.dataService.getReplayStreamUrl(slug, sourceIndex, buttonIndex);
      if (proxiedStreamUrl) {
        return proxiedStreamUrl;
      }
    }

    if (source.stream_url) {
      return this.dataService.getReplayProxyUrl(source.stream_url);
    }

    return null;
  }

  private getSelectedEmbedUrl(): string | null {
    return this.getPreferredEmbedUrl(this.getSelectedSource());
  }

  private getPreferredEmbedUrl(source: ReplaySource | null): string | null {
    if (!source) {
      return null;
    }

    return source.web_embed_url || null;
  }

  toggleFullscreen(): void {
    const element = this.playerFrameShell?.nativeElement;
    if (!element) {
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    void element.requestFullscreen?.();
  }

  private initializePlayback(): void {
    this.destroyPlayer();

    if (!this.isDirectPlayback || !this.directStreamUrl || !this.videoElement?.nativeElement) {
      return;
    }

    const video = this.videoElement.nativeElement;
    const streamUrl = this.directStreamUrl;
    video.crossOrigin = 'anonymous';

    if (this.shouldUseHls(streamUrl) && Hls.isSupported()) {
      this.hlsPlayer = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      this.hlsPlayer.loadSource(streamUrl);
      this.hlsPlayer.attachMedia(video);
      this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => undefined);
      });
      this.hlsPlayer.on(Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) {
          console.error('Replay HLS error', data);
        }
      });
      return;
    }

    if (this.shouldUseHls(streamUrl) && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.load();
      video.play().catch(() => undefined);
      return;
    }

    video.src = streamUrl;
    video.load();
    video.play().catch(() => undefined);
  }

  private destroyPlayer(): void {
    if (this.hlsPlayer) {
      this.hlsPlayer.destroy();
      this.hlsPlayer = null;
    }

    if (this.videoElement?.nativeElement) {
      const video = this.videoElement.nativeElement;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  private queuePlaybackInitialization(): void {
    this.cdr.detectChanges();
    setTimeout(() => this.initializePlayback(), 0);
  }

  private shouldUseHls(url: string): boolean {
    const source = this.getSelectedSource();
    const format = source?.stream_format?.toLowerCase() || '';
    const streamUrl = source?.stream_url?.toLowerCase() || '';

    return format.includes('mpegurl') || streamUrl.includes('.m3u8') || url.toLowerCase().includes('.m3u8');
  }
}
