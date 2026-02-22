import { Component, ElementRef, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import Hls from 'hls.js';

@Component({
  selector: 'app-test-player',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="test-player-container">
      <h1>Test Player HLS</h1>
      <video #videoEl controls width="100%" height="auto"></video>
    </div>
  `,
  styles: [`
    .test-player-container {
      padding: 20px;
      background: #000;
      min-height: 100vh;
    }
    h1 {
      color: white;
      text-align: center;
      margin-bottom: 20px;
    }
    video {
      max-width: 100%;
      height: auto;
    }
  `]
})
export class TestPlayerComponent implements OnInit, OnDestroy {
  @ViewChild('videoEl', { static: true }) videoRef!: ElementRef<HTMLVideoElement>;
  
  private hls!: Hls;
  
  private streamUrl = 'https://ssu5.bionyxarchitects.cyou/v4/mf/6l91dw/cf-master.1770527567.txt';

  ngOnInit(): void {
    const video = this.videoRef.nativeElement;

    if (Hls.isSupported()) {
      this.hls = new Hls({
        xhrSetup: (xhr) => {
          xhr.setRequestHeader('Referer', 'https://latinlucha.upns.online/');
        }
      });

      this.hls.loadSource(this.streamUrl);
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = this.streamUrl;
      video.play();
    }
  }

  ngOnDestroy(): void {
    if (this.hls) {
      this.hls.destroy();
    }
  }
}
