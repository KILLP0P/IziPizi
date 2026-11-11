import { describe,it,expect } from 'vitest';
import { fromHtml } from '../src/html.js';
import { fromYtdlp } from '../src/ytdlp.js';
describe('general multimedia discovery',() => {
 it('extracts relative images, video sources, audio and direct GIF links without following pages',() => {
  const result = fromHtml(`<title>A public page</title><video poster="/poster.jpg"><source src="/movie.mp4"></video><audio src="https://cdn.example.org/song.mp3"></audio><img src="/photo.webp"><a href="/animation.gif">GIF</a><a href="/another-page">page</a>`, 'https://example.org/article');
  expect(result.media.map(m => m.public.kind)).toEqual(['video','audio','image','gif']);
  expect(result.media[0]!.qualities[0]!.url).toBe('https://example.org/movie.mp4');expect(result.media[3]!.gifSource).toBe('gif');
 });
 it('filters SVG, data URLs, private targets and malformed URLs and deduplicates media',() => {
  const result = fromHtml(`<meta property="og:image" content="/a.png"><img src="/a.png"><img src="http://127.0.0.1/admin"><img src="data:image/png;base64,a"><img src="/unsafe.svg"><a href="https://[invalid">bad</a><img src="/pixel.png" width="1" height="1">`,'https://example.org/');
  expect(result.media).toHaveLength(1);expect(result.media[0]!.qualities[0]!.url).toBe('https://example.org/a.png');
 });
 it('bounds results to 16 files on a large page',() => {
  const result = fromHtml(Array.from({length:100},(_,i) => `<img src="/${i}.jpg">`).join(''),'https://example.org/');expect(result.media).toHaveLength(16);expect(result.warnings.join(' ')).toContain('16');
 });
 it('plans video and audio merging for adaptive MP4 and keeps a separate audio option',() => {
  const result = fromYtdlp({title:'Adaptive',formats:[
   {url:'https://media.example.org/video.mp4',ext:'mp4',protocol:'https',height:1080,vcodec:'avc1',acodec:'none'},
   {url:'https://media.example.org/audio.m4a',ext:'m4a',protocol:'https',vcodec:'none',acodec:'mp4a',abr:128},
  ]});
  const video = result.media.find(m => m.public.kind === 'video')!;
  expect(video.qualities[0]!.plan?.selection).toBe('v+a');expect(video.qualities[0]!.plan?.formats.map(f => f.format_id)).toEqual(['v','a']);expect(result.media.some(m => m.public.kind === 'audio')).toBe(true);
 });
 it('keeps HLS and DASH native download plans and blocks unsafe fragment URLs and DRM',() => {
  const result = fromYtdlp({formats:[
   {url:'https://cdn.example.org/playlist.m3u8',ext:'mp4',protocol:'m3u8_native',height:720},
   {url:'https://cdn.example.org/manifest.mpd',ext:'mp4',protocol:'http_dash_segments',height:1080,fragments:[{url:'http://127.0.0.1/key'}]},
   {url:'https://cdn.example.org/drm.mp4',ext:'mp4',protocol:'https',height:2160,has_drm:true},
  ]});
  expect(result.media).toHaveLength(1);expect(result.media[0]!.qualities).toHaveLength(1);expect(result.media[0]!.qualities[0]!.plan?.formats[0]!.protocol).toBe('m3u8_native');
 });
 it('rejects live streams explicitly',() => {expect(() => fromYtdlp({is_live:true})).toThrow(/directo/);});
});
