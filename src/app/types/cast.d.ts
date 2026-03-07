// Declaraciones de tipos para Google Cast
declare namespace chrome.cast {
  const VERSION: string;

  class Image {
    constructor(url: string);
    url: string;
  }

  namespace media {
    const DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    const StreamType: {
      BUFFERED: string;
      LIVE: string;
    };

    class MediaInfo {
      constructor(contentId: string, contentType: string);
      metadata: any;
      streamType: string;
      duration: number;
      customData?: unknown;
    }

    class LoadRequest {
      constructor(mediaInfo: MediaInfo);
      autoplay: boolean;
      currentTime: number;
    }

    class GenericMediaMetadata {
      title: string;
      subtitle: string;
      images: Image[];
    }
  }

  enum AutoJoinPolicy {
    TAB_AND_ORIGIN_SCOPED = 'tab_and_origin_scoped',
    ORIGIN_SCOPED = 'origin_scoped',
    PAGE_SCOPED = 'page_scoped'
  }
}

interface Window {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
}

declare namespace cast.framework {
  class CastContext {
    static getInstance(): CastContext;
    setOptions(options: CastOptions): void;
    requestSession(): Promise<void>;
    getCurrentSession(): CastSession | null;
    endCurrentSession(stopCasting: boolean): void;
    addEventListener(eventType: CastContextEventType, listener: (event: CastStateEventData) => void): void;
    removeEventListener(eventType: CastContextEventType, listener: (event: CastStateEventData) => void): void;
  }

  class CastSession {
    loadMedia(request: chrome.cast.media.LoadRequest): Promise<void>;
  }

  interface CastOptions {
    receiverApplicationId: string;
    autoJoinPolicy: chrome.cast.AutoJoinPolicy;
  }

  enum CastContextEventType {
    CAST_STATE_CHANGED = 'caststatechanged'
  }

  enum CastState {
    NO_DEVICES_AVAILABLE = 'NO_DEVICES_AVAILABLE',
    NOT_CONNECTED = 'NOT_CONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED'
  }

  interface CastStateEventData {
    castState: CastState;
  }

}
