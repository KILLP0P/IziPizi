import { afterEach,describe,it,expect,vi } from 'vitest';
import { mkdtemp,readdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { DownloadEngine } from '../src/engine.js';
import { config } from '../src/config.js';
import * as extractor from '../src/extractor.js';
import * as network from '../src/network.js';
vi.mock('../src/extractor.js',async importOriginal => ({...await importOriginal<typeof extractor>(),extract:vi.fn()}));
vi.mock('../src/network.js',async importOriginal => ({...await importOriginal<typeof network>(),safeResponse:vi.fn()}));
const media = {public:{id:'m0',kind:'image' as const,qualities:[{id:'q0',label:'Original',extension:'jpg' as const}]},qualities:[{public:{id:'q0',label:'Original',extension:'jpg' as const},url:'https://pbs.twimg.com/a.jpg'}]};
afterEach(() => vi.restoreAllMocks());
describe('download engine lifecycle',() => {
 it('caps streaming bytes and deletes partial files after failure',async () => {
  const dir = await mkdtemp(join(tmpdir(),'izipizi-engine-test-')); const engine = new DownloadEngine({...config,TEMP_ROOT:dir,MAX_FILE_MB:1});
  try {
   vi.mocked(extractor.extract).mockResolvedValueOnce({title:'test',media:[media],warnings:[]});
   const session = await engine.analyze('https://x.com/i/web/status/1',AbortSignal.timeout(5000));
   const response = Readable.from([Buffer.alloc(600000),Buffer.alloc(600000)]) as unknown as Awaited<ReturnType<typeof network.safeResponse>>;response.headers={'content-type':'image/jpeg'};
   vi.mocked(network.safeResponse).mockResolvedValueOnce(response);
   await expect(engine.download(session.sessionId,'m0','q0',AbortSignal.timeout(5000))).rejects.toMatchObject({code:'FILE_TOO_LARGE'});expect(await readdir(dir)).toEqual([]);
  } finally {await engine.close();await rm(dir,{recursive:true,force:true});}
 });
 it('rejects missing or expired capabilities',async () => {
  const engine = new DownloadEngine(config);
  try {await expect(engine.download('missing','m0','q0',AbortSignal.timeout(1000))).rejects.toMatchObject({code:'EXPIRED'});} finally {await engine.close();}
 });
});

it('downloads a real animated GIF from an MP4 source, with looping and cleanup',async () => {
 const { readFile } = await import('node:fs/promises');
 const { runProcess } = await import('../src/process.js');
 const dir = await mkdtemp(join(tmpdir(),'izipizi-gif-test-'));
 const engine = new DownloadEngine({...config,TEMP_ROOT:dir});
 try {
  const input = join(dir,'fixture.mp4');
  await runProcess(config.FFMPEG_BIN,['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=0.6','-c:v','mpeg4','-y',input],AbortSignal.timeout(10000));
  const bytes = await readFile(input);
  const gif = {public:{id:'m0',kind:'gif' as const,qualities:[{id:'q0',label:'Original',extension:'gif' as const}]},qualities:[{public:{id:'q0',label:'Original',extension:'gif' as const},url:'https://video.twimg.com/tweet_video/test.mp4'}]};
  vi.mocked(extractor.extract).mockResolvedValueOnce({title:'animated fixture',media:[gif],warnings:[]});
  const response = Readable.from([bytes]) as unknown as Awaited<ReturnType<typeof network.safeResponse>>;response.headers={'content-type':'video/mp4'};
  vi.mocked(network.safeResponse).mockResolvedValueOnce(response);
  const session = await engine.analyze('https://x.com/i/web/status/1',AbortSignal.timeout(10000));
  const result = await engine.download(session.sessionId,'m0','q0',AbortSignal.timeout(10000));
  expect(result.filename).toBe('izipizi-m0.gif');expect(result.type).toBe('image/gif');
  const data = await readFile(result.path);expect(data.subarray(0,6).toString()).toBe('GIF89a');expect(data.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);
  const probe = JSON.parse(await runProcess('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,nb_read_frames,width,height','-of','json',result.path],AbortSignal.timeout(10000)));
  expect(probe.streams[0].codec_name).toBe('gif');expect(Number(probe.streams[0].nb_read_frames)).toBeGreaterThan(1);expect(probe.streams[0].width).toBe(64);
  await result.cleanup();expect(await readdir(dir)).toEqual(['fixture.mp4']);
 } finally {await engine.close();await rm(dir,{recursive:true,force:true});}
});
