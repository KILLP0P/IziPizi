import { describe,it,expect } from 'vitest';
import { analyzeSchema,normalizeMediaUrl,downloadSchema } from './index.js';
describe('public multimedia URLs',() => {
 it.each(['https://x.com/hello/status/123?utm_source=foo','https://twitter.com/hello/status/123/video/1','https://mobile.twitter.com/i/web/status/123',' https://www.x.com/hello/status/123/ '])('normalizes X posts: %s',url => expect(normalizeMediaUrl(url)).toBe('https://x.com/i/web/status/123'));
 it.each(['https://www.youtube.com/watch?v=abc','https://vimeo.com/123','https://example.org/photo.jpg?signature=keep','http://media.example.org/video.mp4','https://t.co/abc'])('accepts public pages and direct files: %s',url => expect(normalizeMediaUrl(url)).toBe(url));
 it.each(['https://x.com@127.0.0.1/a/status/1','https://example.org:8443/file','https://x.com/a','https://127.0.0.1/file','http://2130706433/','http://0x7f000001/','http://[::1]/','https://router.local/file','https://localhost/file','https://metadata.google.internal/','https://user:secret@example.org/','file:///etc/passwd','ftp://example.org/file'])('rejects unsafe input: %s',url => expect(analyzeSchema.safeParse({url}).success).toBe(false));
 it('preserves signed query strings and removes fragments on ordinary pages',() => {expect(normalizeMediaUrl('https://media.example.org/a.mp4?token=abc#player')).toBe('https://media.example.org/a.mp4?token=abc');});
 it('rejects extra parameters and arbitrary downloader arguments',() => {
  expect(analyzeSchema.safeParse({url:'https://example.org/video',cookies:'secret'}).success).toBe(false);
  expect(downloadSchema.safeParse({sessionId:'00000000-0000-4000-8000-000000000000',mediaId:'m0',qualityId:'--exec=sh'}).success).toBe(false);
 });
});
