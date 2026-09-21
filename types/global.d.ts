import type { FilemindApi } from '../src/shared/types';

declare global {
  interface Window {
    filemind: FilemindApi;
  }
}

export {};
