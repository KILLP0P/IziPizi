import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Analysis } from '@izipizi/shared';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { extract, type Extracted } from './extractor.js';
import { Gate } from './limits.js';
import { safeBuffer, safeResponse } from './network.js';
import { runProcess, runProcessToFile } from './process.js';
import { nativeDownload } from './native-download.js';
import { contentExtension, mediaKind, mimeByExtension } from './media.js';

interface Session { result: Extracted; analysis: Analysis; expires: number }
export interface Download { path: string; filename: string; type: string; size: number; cleanup: () => Promise<void> }
export interface Engine {
 analyze(url: string, signal: AbortSignal): Promise<Analysis>;
 download(sessionId: string, mediaId: string, qualityId: string, signal: AbortSignal): Promise<Download>;
 preview(sessionId: string, mediaId: string, signal: AbortSignal): Promise<{ data: Buffer; type: string }>;
 close(): Promise<void>;
}
export class DownloadEngine implements Engine {
 private sessions = new Map<string, Session>();
 private gate: Gate;
 private previewGate = new Gate(4);
 private timer: ReturnType<typeof setInterval>;
 private tempDirs = new Set<string>();
 constructor(private config: Config) {
   this.gate = new Gate(config.MAX_CONCURRENT);
   this.timer = setInterval(() => this.prune(),30000); this.timer.unref();
 }
 private prune() { for (const [id,s] of this.sessions) if (s.expires < Date.now()) this.sessions.delete(id); }
 private get(sessionId: string, mediaId: string) {
   const session = this.sessions.get(sessionId);
   if (!session || session.expires < Date.now()) { this.sessions.delete(sessionId); throw new AppError('EXPIRED','La vista previa ha caducado. Vuelve a analizar el enlace.',410); }
   const media = session.result.media.find(m => m.public.id === mediaId);
   if (!media) throw new AppError('NOT_FOUND','No encontramos este archivo.',404);
   return media;
 }
 async analyze(url: string, signal: AbortSignal): Promise<Analysis> {
   return this.gate.run(async () => {
     const result = await extract(url, signal, this.config); signal.throwIfAborted(); this.prune();
     if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value!);
     const sessionId = randomUUID(); const expires = Date.now() + this.config.SESSION_TTL_SECONDS * 1000;
     const analysis: Analysis = { sessionId, sourceUrl: url, title: result.title, ...(result.author ? { author: result.author } : {}), expiresAt: new Date(expires).toISOString(), media: result.media.map(m => ({ ...m.public, ...(m.thumbnail ? { previewUrl: `/api/preview/${sessionId}/${m.public.id}` } : {}) })), warnings: result.warnings };
     this.sessions.set(sessionId,{ result, analysis, expires }); return analysis;
   });
 }
 async preview(sessionId: string, mediaId: string, signal: AbortSignal) {
   return this.previewGate.run(async () => {
     const media = this.get(sessionId,mediaId);
     if (!media.thumbnail) throw new AppError('NO_PREVIEW','Vista previa no disponible.',404);
     const preview = await safeBuffer(media.thumbnail,signal,5 * 1024 * 1024,media.qualities[0]?.headers);
     if (!/^image\/(jpeg|png|webp|gif|avif)(;|$)/.test(preview.type)) throw new AppError('INVALID_MEDIA','Vista previa no disponible.',422);
     return preview;
   });
 }
 async download(sessionId: string, mediaId: string, qualityId: string, signal: AbortSignal): Promise<Download> {
   if (this.tempDirs.size >= this.config.MAX_CONCURRENT) throw new AppError('BUSY','Hay varias descargas en curso. Inténtalo de nuevo en unos segundos.',503);
   return this.gate.run(async () => {
     const media = this.get(sessionId,mediaId); const quality = media.qualities.find(q => q.public.id === qualityId);
     if (!quality) throw new AppError('NOT_FOUND','Esta calidad no está disponible.',404);
     const max = this.config.MAX_FILE_MB * 1024 * 1024;
     if ((quality.public.bytes ?? 0) > max) throw new AppError('FILE_TOO_LARGE',`El archivo supera el límite de ${this.config.MAX_FILE_MB} MB. Prueba otra calidad.`,413);
     const dir = await mkdtemp(join(this.config.TEMP_ROOT ?? tmpdir(),'izipizi-')); this.tempDirs.add(dir);
     const cleanup = async () => { await rm(dir,{ recursive: true, force: true }); this.tempDirs.delete(dir); };
     try {
       let ext = quality.public.extension;
       let input: string;
       if (quality.plan) {
         input = await nativeDownload(quality.plan,dir,signal,max,this.config);
       } else {
         const convertedGif = media.public.kind === 'gif' && media.gifSource !== 'gif';
         input = join(dir,`source.${convertedGif ? 'mp4' : ext}`);
         const response = await safeResponse(quality.url,signal,max,0,quality.headers);
         const type = (response.headers['content-type'] ?? '').split(';')[0]!.toLowerCase();
         const actual = contentExtension(response);
         const expectedKind = convertedGif ? 'video' : media.public.kind === 'gif' ? 'image' : media.public.kind;
         const actualKind = actual ? mediaKind(actual) : undefined;
         if (actual && ((expectedKind === 'image' && ['image','gif'].includes(actualKind!)) || expectedKind === actualKind || (expectedKind === 'audio' && ['audio/webm','video/webm','video/mp4'].includes(type)))) {
           if (!convertedGif && !(expectedKind === 'audio' && ['mp4','webm'].includes(actual))) ext = actual;
         } else if (type !== 'application/octet-stream' && type !== 'binary/octet-stream') {
           response.destroy();throw new AppError('INVALID_MEDIA','El sitio no ha entregado un archivo multimedia compatible.',422);
         }
         let size = 0;
         const limit = new Transform({transform(chunk: Buffer,_encoding,cb) {size += chunk.length;cb(size > max ? new AppError('FILE_TOO_LARGE','El archivo supera el límite de tamaño.',413) : null,chunk);}});
         await pipeline(response,limit,createWriteStream(input,{flags:'wx',mode:0o600}),{signal});
       }
       // Probe the downloaded bytes, not just an extension or upstream MIME type.
       const metadata = JSON.parse(await runProcess(this.config.FFPROBE_BIN,[
         '-v','error','-protocol_whitelist','file','-format_whitelist','mov,matroska,webm,gif,jpeg_pipe,png_pipe,webp_pipe,mp3,aac,wav,flac,ogg,mpegts',
         '-show_entries','stream=codec_type,codec_name','-of','json',input,
       ],signal,256*1024)) as {streams?: {codec_type?:string;codec_name?:string}[]};
       const expectedStream = media.public.kind === 'audio' ? 'audio' : 'video';
       if (!metadata.streams?.some(stream => stream.codec_type === expectedStream)) throw new AppError('INVALID_MEDIA','El archivo recibido no contiene el tipo de medio esperado.',422);
       if (media.public.kind === 'image' || media.gifSource === 'gif') {
         const codec = metadata.streams.find(stream => stream.codec_type === 'video')?.codec_name;
         const images = {mjpeg:'jpg',png:'png',webp:'webp',gif:'gif',av1:'avif'} as const;
         if (!codec || !(codec in images)) throw new AppError('INVALID_MEDIA','El archivo recibido no es una imagen compatible.',422);
         ext = images[codec as keyof typeof images];
       }
       let path = input;
       if (media.public.kind === 'gif' && media.gifSource !== 'gif') {
         path = join(dir,'ready.gif');
         await runProcessToFile(this.config.FFMPEG_BIN,[
           '-nostdin','-v','error','-threads','2','-filter_complex_threads','1',
           '-protocol_whitelist','file','-format_whitelist','mov','-enable_drefs','0','-use_absolute_path','0','-i',input,
           '-filter_complex',"[0:v:0]fps=15,scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease:flags=lanczos,split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1:dither=sierra2_4a[out]",
           '-map','[out]','-an','-loop','0','-f','gif','pipe:1',
         ],path,signal,max);
       } else if (ext === 'mp4') {
         path = join(dir,'ready.mp4');
         // FFmpeg only sees a local file; network protocols and playlist inputs are disabled.
         await runProcess(this.config.FFMPEG_BIN,['-nostdin','-v','error','-protocol_whitelist','file','-format_whitelist','mov','-enable_drefs','0','-use_absolute_path','0','-i',input,'-map','0:v:0','-map','0:a?','-c','copy','-movflags','+faststart','-y',path],signal,1024 * 1024);
       }
       const info = await stat(path);
       if (!info.size || info.size > max) throw new AppError('FILE_TOO_LARGE','El archivo no cumple el límite de tamaño.',413);
       return { path, filename: `izipizi-${mediaId}.${ext}`, type: media.public.kind === 'audio' && ext === 'webm' ? 'audio/webm' : mimeByExtension[ext], size: info.size, cleanup };
     } catch (error) { await cleanup(); throw error; }
   });
 }
 async close() { clearInterval(this.timer); this.sessions.clear(); await Promise.all([...this.tempDirs].map(dir => rm(dir,{ recursive: true, force: true }))); this.tempDirs.clear(); }
}
export { createReadStream };
