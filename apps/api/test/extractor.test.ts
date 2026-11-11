import { describe,it,expect } from 'vitest';
import { fromSyndication,fromYtdlp } from '../src/extractor.js';
describe('media extraction',() => {
 it('keeps photos, videos and GIFs in publication order',() => {
  const result = fromSyndication({text:'mixed',mediaDetails:[{type:'photo',media_url_https:'https://pbs.twimg.com/media/test.jpg',original_info:{width:100,height:200}},{type:'animated_gif',media_url_https:'https://pbs.twimg.com/tweet_video_thumb/a.jpg',video_info:{variants:[{content_type:'video/mp4',url:'https://video.twimg.com/tweet_video/a.mp4'}]}},{type:'video',video_info:{variants:[{content_type:'application/x-mpegURL',url:'https://video.twimg.com/a.m3u8'},{content_type:'video/mp4',url:'https://video.twimg.com/vid/640x360/a.mp4',bitrate:200000},{content_type:'video/mp4',url:'https://video.twimg.com/vid/1280x720/a.mp4',bitrate:900000}]}}]});
  expect(result.media.map(m => m.public.kind)).toEqual(['image','gif','video']);
  expect(result.media[0]!.qualities[0]!.url).toContain('name=orig');
  expect(result.media[1]!.qualities[0]!.public.extension).toBe('gif');
  expect(result.media[2]!.qualities).toHaveLength(2); expect(result.media[2]!.qualities[0]!.public.label).toContain('720p');
 });
 it('rejects unsafe media URLs from untrusted upstream metadata',() => {
  expect(fromSyndication({mediaDetails:[{type:'photo',media_url_https:'https://127.0.0.1/private'}]}).media).toHaveLength(0);
 });
 it('accepts yt-dlp playlists and only complete direct MP4 formats',() => {
  const result = fromYtdlp({title:'hello',entries:[{formats:[{url:'https://video.twimg.com/a.mp4',ext:'mp4',protocol:'https',height:720},{url:'https://video.twimg.com/audio.mp4',ext:'mp4',vcodec:'none'},{url:'https://video.twimg.com/a.m3u8',ext:'mp4',protocol:'m3u8_native'},{url:'https://evil.com/v.mp4',ext:'mp4'}]}]});
  expect(result.media).toHaveLength(1); expect(result.media[0]!.qualities).toHaveLength(1);
 });
});

it('recognizes a silent Twitter GIF in yt-dlp fallback metadata',() => {
 const result = fromYtdlp({formats:[{url:'https://video.twimg.com/tweet_video/animation.mp4',ext:'mp4',protocol:'https',acodec:'none'}]});
 expect(result.media[0]!.public.kind).toBe('gif');
 expect(result.media[0]!.public.qualities[0]!.extension).toBe('gif');
});
