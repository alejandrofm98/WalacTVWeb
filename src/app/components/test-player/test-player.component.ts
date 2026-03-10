import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';

@Component({
  selector: 'app-test-player',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="test-page">
      <div class="hero">
        <p class="eyebrow">Prueba de navegador</p>
        <h1>Embed Dailymotion</h1>
        <p class="intro">
          He cambiado el embed a la URL estandar de Dailymotion usando el video id real para forzar la UI
          completa del player, incluido fullscreen.
        </p>
      </div>

      <article class="panel">
        <div class="panel-header">
          <div>
            <p class="panel-kicker">Player</p>
            <h2>Iframe con fullscreen habilitado</h2>
          </div>
          <span class="badge">Oficial</span>
        </div>

        <div #frameShell class="frame-shell">
          <button
            class="fullscreen-button control-button"
            type="button"
            (click)="toggleFullscreen()"
            aria-label="Pantalla completa">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9V4h5" />
              <path d="M20 9V4h-5" />
              <path d="M4 15v5h5" />
              <path d="M20 15v5h-5" />
            </svg>
          </button>
          <iframe
            class="dm-frame"
            [src]="safeEmbedUrl"
            title="Prueba Dailymotion embed"
            allow="autoplay; fullscreen"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin">
          </iframe>
        </div>

        <label class="url-block">
          <span>URL embed</span>
          <textarea readonly>{{ embedUrl }}</textarea>
        </label>
      </article>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        color: #f7f1e8;
        background:
          radial-gradient(circle at top, rgba(225, 111, 61, 0.25), transparent 40%),
          linear-gradient(180deg, #19130f 0%, #100d0a 50%, #090807 100%);
      }

      .test-page {
        max-width: 1100px;
        margin: 0 auto;
        padding: 48px 20px 72px;
      }

      .hero {
        margin-bottom: 28px;
      }

      .eyebrow,
      .panel-kicker,
      .badge {
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.72rem;
      }

      .eyebrow,
      .panel-kicker {
        color: #ffb07a;
        margin: 0 0 10px;
      }

      .badge {
        border-radius: 999px;
        padding: 8px 12px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #94f0b0;
        background: rgba(106, 201, 138, 0.14);
      }

      h1,
      h2 {
        margin: 0;
        font-family: Georgia, 'Times New Roman', serif;
      }

      h1 {
        font-size: clamp(2.2rem, 4vw, 4.2rem);
        line-height: 0.98;
      }

      h2 {
        font-size: 1.6rem;
      }

      .intro,
      textarea {
        font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
      }

      .intro {
        max-width: 760px;
        margin: 16px 0 0;
        color: #d9cfc2;
        font-size: 1rem;
        line-height: 1.6;
      }

      .panel {
        border: 1px solid rgba(255, 176, 122, 0.18);
        border-radius: 24px;
        padding: 22px;
        background: linear-gradient(180deg, rgba(37, 29, 24, 0.92), rgba(17, 14, 11, 0.98));
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
      }

      .panel-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
      }

      .frame-shell {
        position: relative;
        overflow: hidden;
        border-radius: 18px;
        background: #000;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .control-button {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        transition: all 0.2s ease;
      }

      .control-button:hover,
      .control-button:focus-visible {
        background: rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.4);
        transform: scale(1.05);
      }

      .control-button:active {
        transform: scale(0.95);
      }

      .fullscreen-button {
        position: absolute;
        right: 14px;
        bottom: 14px;
        z-index: 2;
        width: 44px;
        height: 44px;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
        opacity: 0;
        pointer-events: none;
        transform: translateY(8px);
      }

      .frame-shell:hover .fullscreen-button,
      .frame-shell:focus-within .fullscreen-button {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }

      .fullscreen-button svg {
        width: 20px;
        height: 20px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .dm-frame {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        border: 0;
        background: #000;
      }

      .url-block {
        display: block;
        margin-top: 18px;
      }

      .url-block span {
        display: block;
        margin-bottom: 8px;
        color: #ffcfab;
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.14em;
      }

      textarea {
        width: 100%;
        min-height: 96px;
        resize: vertical;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.22);
        color: #f8f2e8;
        padding: 14px;
        line-height: 1.5;
      }

      @media (max-width: 900px) {
        .test-page {
          padding: 32px 16px 56px;
        }

        .panel {
          padding: 18px;
        }

        .panel-header {
          flex-direction: column;
        }
      }
    `,
  ],
})
export class TestPlayerComponent {
  @ViewChild('frameShell', { read: ElementRef }) frameShell?: ElementRef<HTMLElement>;

  readonly embedUrl =
    'https://www.dailymotion.com/embed/video/k5izqVY9lqyOJHF5AyE?autoPlay=0&quality=720&playlist=x7kgvf';

  readonly safeEmbedUrl: SafeResourceUrl;

  private readonly sanitizer = inject(DomSanitizer);

  constructor() {
    this.safeEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.embedUrl);
  }

  toggleFullscreen(): void {
    const element = this.frameShell?.nativeElement;
    if (!element) {
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    void element.requestFullscreen?.();
  }
}
