import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp,readdir,rm,stat } from 'node:fs/promises';
import { join,basename } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeDownload } from '../src/native-download.js';
import { runProcess } from '../src/process.js';
import { config } from '../src/config.js';
import type { DownloadPlan } from '../src/media.js';
import * as network from '../src/network.js';
// The fixture proxy replaces only network transport, never yt-dlp or FFmpeg.
// Production proxy validation is tested separately with private DNS and redirects.
vi.mock('../src/network.js',async original => ({...await original<typeof network>(),createEgressProxy:vi.fn()}));
let root: string;let server: Server;let proxyUrl: string;
const source = (file: string) => `http://fixtures.example.org/${file}`;
beforeAll(async () => {
 root = await mkdtemp(join(tmpdir(),'izipizi-native-test-'));
 server = createServer((req,res) => {
  const file = basename(new URL(req.url ?? '/', 'http://fixtures.example.org').pathname);const path = join(root,file);
  void stat(path).then(info => {res.writeHead(200,{'Content-Length':info.size,'Content-Type':file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream'});createReadStream(path).pipe(res);}).catch(() => {res.writeHead(404);res.end();});
 });
 await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
 const address = server.address();if (!address || typeof address === 'string') throw new Error('fixture');proxyUrl = `http://127.0.0.1:${address.port}`;
 vi.mocked(network.createEgressProxy).mockImplementation(async () => ({url:proxyUrl,error:undefined,close:() => {}}));
 const signal = AbortSignal.timeout(15000);
 await runProcess(config.FFMPEG_BIN,['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=0.6','-c:v','libx264','-g','2','-an','-y',join(root,'video.mp4')],signal);
 await runProcess(config.FFMPEG_BIN,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.6','-c:a','aac','-y',join(root,'audio.m4a')],signal);
 await runProcess(config.FFMPEG_BIN,['-nostdin','-v','error','-i',join(root,'video.mp4'),'-c','copy','-f','hls','-hls_time','0.2','-hls_playlist_type','vod','-y',join(root,'playlist.m3u8')],signal);
 await runProcess(config.FFMPEG_BIN,['-nostdin','-v','error','-i',join(root,'video.mp4'),'-c','copy','-f','dash','-seg_duration','0.2','-y',join(root,'manifest.mpd')],signal);
},20000);
afterAll(async () => {server?.closeAllConnections();await new Promise<void>(resolve => server?.close(() => resolve()));if (root) await rm(root,{recursive:true,force:true});});
async function verify(plan: DownloadPlan, expected: string[]) {
 const dir = await mkdtemp(join(root,'job-'));
 const result = await nativeDownload(plan,dir,AbortSignal.timeout(15000),1024*1024,config);
 const metadata = JSON.parse(await runProcess(config.FFPROBE_BIN,['-v','error','-show_entries','stream=codec_type','-of','json',result],AbortSignal.timeout(5000)));
 expect(metadata.streams.map((s: {codec_type:string}) => s.codec_type).sort()).toEqual(expected.sort());
}
describe('real native adaptive downloads',() => {
 it('merges separate video and audio into a playable MP4',async () => {
  await verify({extension:'mp4',selection:'v+a',formats:[{format_id:'v',url:source('video.mp4'),protocol:'http',ext:'mp4',vcodec:'avc1',acodec:'none'},{format_id:'a',url:source('audio.m4a'),protocol:'http',ext:'m4a',vcodec:'none',acodec:'mp4a'}]},['audio','video']);
 },20000);
 it('downloads and remuxes HLS using the native downloader',async () => {
  await verify({extension:'mp4',selection:'v',formats:[{format_id:'v',url:source('playlist.m3u8'),protocol:'m3u8_native',ext:'mp4',vcodec:'avc1',acodec:'none'}]},['video']);
 },20000);
 it('downloads DASH init and media fragments into a playable file',async () => {
  const files = (await readdir(root)).filter(file => file.endsWith('.m4s')).sort((a,b) => Number(b.startsWith('init'))-Number(a.startsWith('init')) || a.localeCompare(b));
  expect(files.length).toBeGreaterThan(1);
  await verify({extension:'mp4',selection:'v',formats:[{format_id:'v',url:source('manifest.mpd'),protocol:'http_dash_segments',ext:'mp4',vcodec:'avc1',acodec:'none',fragments:files.map(file => ({url:source(file)}))}]},['video']);
 },20000);
});

it('does not bypass the explicit proxy for loopback targets',async () => {
 let hits = 0;
 const honeypot = createServer((_req,res) => {hits++;res.end('private');});
 await new Promise<void>(resolve => honeypot.listen(0,'127.0.0.1',resolve));
 const address = honeypot.address();if (!address || typeof address === 'string') throw new Error('fixture');
 const dir = await mkdtemp(join(root,'denied-'));
 try {
  await expect(nativeDownload({extension:'mp4',selection:'v',formats:[{format_id:'v',url:`http://127.0.0.1:${address.port}/private.mp4`,protocol:'http',ext:'mp4'}]},dir,AbortSignal.timeout(10000),1024*1024,config)).rejects.toThrow();
  expect(hits).toBe(0);
 } finally {honeypot.closeAllConnections();await new Promise<void>(resolve => honeypot.close(() => resolve()));}
},15000);
