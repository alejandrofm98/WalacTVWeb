import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VideoPlayerComponent } from './components/video-player/video-player.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, VideoPlayerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('walactvWeb');
    streamUrl = 'http://127.0.0.1:6878/ace/manifest.m3u8?id=00c9bc9c5d7d87680a5a6bed349edfa775a89947';

}
