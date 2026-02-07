// Declaraciones de tipos para Google Cast
declare namespace chrome.cast {
  const VERSION: string;

  class Image {
    constructor(url: string);
    url: string;
  }

  namespace media {
    const DEFAULT_MEDIA_RECEIVER_APP_ID: string;

    class MediaInfo {
      constructor(contentId: string, contentType: string);
      metadata: any;
      streamType: string;
      duration: number;
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
