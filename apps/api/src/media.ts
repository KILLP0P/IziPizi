import type { Extension, Quality, Media } from '@izipizi/shared';
import type { IncomingMessage } from 'node:http';
import { checkedUrl, mediaHeaders } from './network.js';

export interface DownloadFormat {
  format_id: string; url: string; ext: string; protocol: string;
  vcodec?: string; acodec?: string; width?: number; height?: number; filesize?: number;
  http_headers?: Record<string,string>; fragments?: {url:string;duration?:number}[];
}
export interface DownloadPlan { formats: DownloadFormat[]; selection: string; extension: Extension }
export interface SourceQuality { public: Quality; url: string; headers?: Record<string,string>; plan?: DownloadPlan }
export interface SourceMedia { public: Media; thumbnail?: string; qualities: SourceQuality[]; gifSource?: 'mp4' | 'gif' }
export interface Extracted { title: string; author?: string; media: SourceMedia[]; warnings: string[] }

export const mimeByExtension: Record<Extension,string> = {
 mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mkv:'video/x-matroska',
 gif:'image/gif',jpg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',
 mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',opus:'audio/ogg',wav:'audio/wav',flac:'audio/flac',
};
export const extensionByMime = new Map<string,Extension>(Object.entries(mimeByExtension).map(([extension,mime]) => [mime,extension as Extension]));
extensionByMime.set('audio/webm','webm');
extensionByMime.set('audio/x-wav','wav');extensionByMime.set('audio/x-flac','flac');extensionByMime.set('audio/ogg','ogg');extensionByMime.set('audio/x-m4a','m4a');
const imageExtensions = new Set<Extension>(['jpg','png','webp','avif','gif']);
const audioExtensions = new Set<Extension>(['mp3','m4a','aac','ogg','opus','wav','flac']);
export function mediaKind(ext: Extension): Media['kind'] {return ext === 'gif' ? 'gif' : imageExtensions.has(ext) ? 'image' : audioExtensions.has(ext) ? 'audio' : 'video';}
export function urlExtension(raw: string): Extension | undefined {
 try {
  const suffix = new URL(raw).pathname.split('.').at(-1)?.toLowerCase();
  if (suffix === 'jpeg') return 'jpg';
  return suffix && Object.hasOwn(mimeByExtension,suffix) ? suffix as Extension : undefined;
 } catch {return undefined;}
}
export function sourceForUrl(raw: string, ext: Extension, index = 0, headers: Record<string,string> = {}): SourceMedia {
 const url = checkedUrl(raw).href;const kind = mediaKind(ext);const quality: Quality = {id:'q0',label:'Original',extension:ext};
 return {public:{id:`m${index}`,kind,qualities:[quality]},qualities:[{public:quality,url,headers:mediaHeaders(headers)}],...((kind === 'image' || kind === 'gif') ? {thumbnail:url} : {}),...(kind === 'gif' ? {gifSource:'gif' as const} : {})};
}
export function contentExtension(response: IncomingMessage): Extension | undefined {
 return extensionByMime.get((response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase());
}
