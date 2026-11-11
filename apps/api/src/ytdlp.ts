import { z } from 'zod';
import type { Extension, Media, Quality } from '@izipizi/shared';
import { checkedUrl, mediaHeaders } from './network.js';
import { mimeByExtension, mediaKind, type Extracted, type DownloadFormat, type SourceMedia, type SourceQuality } from './media.js';
import { AppError } from './errors.js';
const num = z.number().nonnegative().nullish();const str = z.string().nullish();
const headers = z.record(z.string(),z.string()).optional();
const formatSchema = z.object({url:str,ext:str,protocol:str,height:num,width:num,tbr:num,abr:num,vcodec:str,acodec:str,filesize:num,has_drm:z.boolean().nullish(),http_headers:headers,fragment_base_url:str,fragments:z.array(z.object({url:str,path:str,duration:num})).max(2000).optional()});
const entrySchema = z.object({title:str,uploader:str,duration:num,thumbnail:str,ext:str,url:str,protocol:str,http_headers:headers,is_live:z.boolean().optional(),has_drm:z.boolean().nullish(),formats:z.array(formatSchema).max(500).optional()});
const infoSchema = entrySchema.extend({entries:z.array(entrySchema.nullable()).max(16).optional(),playlist_count:num});
type Format = z.infer<typeof formatSchema>;
function safe(raw: string | null | undefined) {try {return raw ? checkedUrl(raw).href : undefined;} catch {return undefined;}}
const protocols = new Set(['http','https','m3u8','m3u8_native','http_dash_segments']);
function downloadFormat(format: Format, id: string, inherited: Record<string,string> = {}): DownloadFormat | undefined {
 const url = safe(format.url);const ext = format.ext;
 if (!url || !ext || !Object.hasOwn(mimeByExtension,ext) || format.has_drm || (format.protocol && !protocols.has(format.protocol))) return undefined;
 try {
  const fragments = format.fragments?.map(fragment => {
   const relative = fragment.url ?? fragment.path;if (!relative) throw new Error('invalid fragment');
   return {url:checkedUrl(new URL(relative,format.fragment_base_url ?? url).href).href,...(fragment.duration ? {duration:fragment.duration} : {})};
  });
  return {format_id:id,url,ext:format.vcodec === 'none' && ext === 'mp4' ? 'm4a' : ext,protocol:format.protocol === 'm3u8' ? 'm3u8_native' : format.protocol ?? new URL(url).protocol.slice(0,-1),http_headers:mediaHeaders({...inherited,...format.http_headers}),...(format.vcodec ? {vcodec:format.vcodec} : {}),...(format.acodec ? {acodec:format.acodec} : {}),...(format.width ? {width:format.width} : {}),...(format.height ? {height:format.height} : {}),...(format.filesize ? {filesize:format.filesize} : {}),...(fragments ? {fragments} : {})};
 } catch {return undefined;}
}
export function fromYtdlp(raw: unknown): Extracted {
 const info = infoSchema.parse(raw);
 if (info.is_live) throw new AppError('LIVE_UNSUPPORTED','Las emisiones en directo no están disponibles. Pega un vídeo ya publicado.',422);
 const media: SourceMedia[] = [];let restricted = false;
 for (const entry of info.entries ?? [info]) {
  if (!entry || entry.is_live || entry.has_drm) {restricted = true;continue;}
  const formats = entry.formats?.length ? entry.formats : entry.url && entry.ext ? [{...entry,has_drm:entry.has_drm}] : [];
  const allowed = formats.map(f => ({raw:f,format:downloadFormat(f,'v',entry.http_headers)})).filter((x):x is {raw:Format;format:DownloadFormat} => Boolean(x.format));
  const audio = allowed.filter(f => f.raw.vcodec === 'none' || mediaKind(f.format.ext as Extension) === 'audio').sort((a,b) => (b.raw.abr ?? b.raw.tbr ?? 0) - (a.raw.abr ?? a.raw.tbr ?? 0));
  const videos = allowed.filter(f => !audio.includes(f) && mediaKind(f.format.ext as Extension) === 'video').sort((a,b) => (b.raw.height ?? 0) - (a.raw.height ?? 0) || (b.raw.tbr ?? 0) - (a.raw.tbr ?? 0));
  const qualities: SourceQuality[] = [];const seen = new Set<string>();let width: number|undefined;let height: number|undefined;
  const isGif = videos.some(f => new URL(f.format.url).hostname === 'video.twimg.com' && new URL(f.format.url).pathname.startsWith('/tweet_video/'));
  for (const video of videos) {
   let ext = video.format.ext as Extension;const tracks = [video.format];
   if (video.raw.acodec === 'none' && !isGif) {
    const sound = audio.find(a => ext === 'mp4' || ext === 'mov' ? a.format.ext === 'm4a' : a.format.ext === 'webm' || a.format.ext === 'opus' || a.format.ext === 'ogg');
    if (sound) {tracks.push({...sound.format,format_id:'a'});if (ext === 'mov') ext = 'mp4';}
    else if (audio.length) continue;
   }
   const key = `${video.raw.height ?? 'original'}-${ext}`;if (seen.has(key) || qualities.length >= 10) continue;seen.add(key);
   const id = `q${qualities.length}`;const bytes = tracks.every(f => f.filesize) ? tracks.reduce((sum,f) => sum+f.filesize!,0) : undefined;
   const quality: Quality = {id,label:video.raw.height ? `${video.raw.height}p · ${isGif ? 'GIF' : ext.toUpperCase()}` : isGif ? 'GIF animado' : `Original · ${ext.toUpperCase()}`,extension:isGif ? 'gif' : ext,...(bytes && !isGif ? {bytes} : {})};
   const direct = tracks.length === 1 && ['http','https'].includes(video.format.protocol);
   qualities.push({public:quality,url:video.format.url,headers:video.format.http_headers ?? {},...(!direct ? {plan:{formats:tracks,selection:tracks.length > 1 ? 'v+a' : 'v',extension:ext}} : {})});
   width ??= video.raw.width ?? undefined;height ??= video.raw.height ?? undefined;
  }
  const thumbnail = safe(entry.thumbnail);
  const duration = entry.duration;
  function add(kind: Media['kind'], choices: SourceQuality[]) {
   if (!choices.length || media.length >= 16) return;
   media.push({public:{id:`m${media.length}`,kind,qualities:choices.map(q => q.public),...(width && kind !== 'audio' ? {width} : {}),...(height && kind !== 'audio' ? {height} : {}),...(duration ? {duration} : {})},qualities:choices,...(thumbnail ? {thumbnail} : {})});
  }
  add(isGif ? 'gif' : 'video',qualities);
  const audioQualities: SourceQuality[] = [];const audioSeen = new Set<string>();
  for (const sound of audio) {
   const ext = sound.format.ext as Extension;if (audioSeen.has(ext)) continue;audioSeen.add(ext);
   const quality: Quality = {id:`q${audioQualities.length}`,label:`${ext.toUpperCase()}${sound.raw.abr ? ` · ${Math.round(sound.raw.abr)} kbps` : ' · Original'}`,extension:ext,...(sound.raw.filesize ? {bytes:sound.raw.filesize} : {})};
   audioQualities.push({public:quality,url:sound.format.url,headers:sound.format.http_headers ?? {},...(!['http','https'].includes(sound.format.protocol) ? {plan:{formats:[sound.format],selection:'v',extension:ext}} : {})});
   if (audioQualities.length === 4) break;
  }
  // Animated GIFs are silent videos, not separate audio downloads.
  if (!isGif) add('audio',audioQualities);
  for (const item of allowed.filter(f => ['image','gif'].includes(mediaKind(f.format.ext as Extension)))) {
   const ext = item.format.ext as Extension;const quality: Quality = {id:'q0',label:'Original',extension:ext};
   if (media.length < 16) media.push({public:{id:`m${media.length}`,kind:mediaKind(ext),qualities:[quality]},qualities:[{public:quality,url:item.format.url}],thumbnail:item.format.url,...(ext === 'gif' ? {gifSource:'gif'} : {})});
  }
 }
 return {title:(info.title ?? 'Contenido multimedia').slice(0,500),...(info.uploader ? {author:info.uploader.slice(0,100)} : {}),media,warnings:[...(restricted ? ['Se han omitido medios en directo o con restricciones de acceso.'] : []),...((info.playlist_count ?? 0) > 16 || media.length >= 16 ? ['Se muestran como máximo 16 archivos por enlace.'] : [])]};
}
