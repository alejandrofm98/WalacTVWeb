declare global {
  interface Window {
    chrome: any;
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
  }
}

declare const chrome: any;

export {};
