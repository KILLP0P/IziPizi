import { z } from 'zod';
import type { Quality } from '@izipizi/shared';
import { AppError } from './errors.js';
import { checkedUrl, createEgressProxy, safeBuffer, safeResponse, readLimited, resolvePublic } from './network.js';
import { runProcess } from './process.js';
import type { Config } from './config.js';
import { contentExtension, sourceForUrl, type SourceQuality, type SourceMedia, type Extracted } from './media.js';
import { fromHtml } from './html.js';
import { fromYtdlp } from './ytdlp.js';
export { fromYtdlp } from './ytdlp.js';
export type { SourceQuality, SourceMedia, Extracted } from './media.js';
const num = z.number().nonnegative().nullish();const str = z.string().nullish();
const variantSchema = z.object({url:z.string(),content_type:str,bitrate:num});
const detailSchema = z.object({type:z.string(),media_url_https:str,original_info:z.object({width:num,height:num}).nullish(),video_info:z.object({duration_millis:num,variants:z.array(variantSchema).optional()}).nullish()});
const tweetSchema = z.object({text:str,user:z.object({name:str}).optional(),mediaDetails:z.array(detailSchema).max(16).optional()});
function safeMedia(raw: string | null | undefined): string | undefined {
 if (!raw) return undefined;try {return checkedUrl(raw).href;} catch {return undefined;}
}
function videoMedia(index: number, variants: { url: string; height?: number; width?: number; bitrate?: number; bytes?: number }[], kind: 'video' | 'gif', thumbnail?: string, duration?: number): SourceMedia | undefined {
  const sorted = variants.filter(v => safeMedia(v.url)).sort((a,b) => (b.height ?? b.bitrate ?? 0) - (a.height ?? a.bitrate ?? 0));
  const seen = new Set<string>();
  const unique = sorted.filter(v => { const key = v.height ? `${v.height}` : v.url; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0,12);
  if (!unique.length) return undefined;
  const qualities: SourceQuality[] = unique.map((v, i) => ({ public: { id: `q${i}`, label: v.height ? `${v.height}p${i === 0 ? ' · Mejor calidad' : ''}` : unique.length === 1 ? 'Original' : `${Math.round((v.bitrate ?? 0) / 1000)} kbps${i === 0 ? ' · Mejor calidad' : ''}`, extension: kind === 'gif' ? 'gif' : 'mp4', ...(kind !== 'gif' && v.bytes ? { bytes: v.bytes } : {}) }, url: v.url }));
  const first = unique[0]!;
  const preview = safeMedia(thumbnail);
  return { public: { id: `m${index}`, kind, qualities: qualities.map(q => q.public), ...(first.width ? { width: first.width } : {}), ...(first.height ? { height: first.height } : {}), ...(duration ? { duration } : {}) }, qualities, ...(preview ? { thumbnail: preview } : {}) };
}
export function fromSyndication(raw: unknown): Extracted {
  const tweet = tweetSchema.parse(raw);
  const media: SourceMedia[] = [];
  for (const detail of tweet.mediaDetails ?? []) {
    const thumbnail = safeMedia(detail.media_url_https);
    if (detail.type === 'photo' && thumbnail) {
      const url = new URL(thumbnail);
      const ext = /\.(png|webp)(?:$|\?)/i.exec(url.pathname)?.[1]?.toLowerCase() ?? 'jpg';
      url.searchParams.set('format',ext); url.searchParams.set('name','orig');
      const quality: Quality = { id: 'q0', label: 'Original', extension: ext as 'jpg' | 'png' | 'webp' };
      media.push({ public: { id: `m${media.length}`, kind: 'image', qualities: [quality], ...(detail.original_info?.width ? { width: detail.original_info.width } : {}), ...(detail.original_info?.height ? { height: detail.original_info.height } : {}) }, thumbnail, qualities: [{ public: quality, url: url.href }] });
    } else if (detail.type === 'video' || detail.type === 'animated_gif') {
      const variants = (detail.video_info?.variants ?? []).filter(v => v.content_type === 'video/mp4').map(v => {
        const dims = /\/(\d+)x(\d+)\//.exec(v.url);
        return { url: v.url, ...(dims ? { width: Number(dims[1]), height: Number(dims[2]) } : {}), ...(v.bitrate ? { bitrate: v.bitrate } : {}) };
      });
      const item = videoMedia(media.length,variants, detail.type === 'animated_gif' ? 'gif' : 'video',thumbnail,detail.video_info?.duration_millis ? detail.video_info.duration_millis / 1000 : undefined);
      if (item) media.push(item);
    }
  }
  return { title: (tweet.text ?? 'Publicación de X').slice(0,500), ...(tweet.user?.name ? { author: tweet.user.name.slice(0,100) } : {}), media, warnings: [] };
}
export const extractorArgs = ['--ignore-config','--no-plugin-dirs','--no-cache-dir','--no-cookies','--socket-timeout','12','--retries','0','--extractor-retries','0'];
export async function extract(url: string, signal: AbortSignal, config: Config): Promise<Extracted> {
  const input = checkedUrl(url);await resolvePublic(input.hostname);signal.throwIfAborted();
  const isX = input.hostname === 'x.com' || input.hostname === 'twitter.com';
  let publicData: Extracted | undefined;let htmlData: Extracted | undefined;
  if (isX) {
    const id = input.pathname.split('/').at(-1)!;
    try {
      const token = ((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'');
      const response = await safeBuffer(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`,signal,2*1024*1024);
      publicData = fromSyndication(JSON.parse(response.data.toString()));
    } catch {signal.throwIfAborted();}
    if (publicData?.media.length && publicData.media.every(m => m.public.kind === 'image')) return publicData;
  } else {
    try {
      const response = await safeResponse(url,signal,config.MAX_FILE_MB*1024*1024);
      const ext = contentExtension(response);
      if (ext) {
        response.destroy();
        const target = response.url ?? url;
        const direct = sourceForUrl(target,ext);if ((response.headers['content-type'] ?? '').startsWith('audio/')) direct.public.kind = 'audio';
        return {title:decodeURIComponent(new URL(target).pathname.split('/').at(-1) || input.hostname).slice(0,500),media:[direct],warnings:[]};
      }
      if (/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers['content-type'] ?? '')) {
        htmlData = fromHtml((await readLimited(response,2*1024*1024)).toString('utf8'),response.url ?? url);
      } else response.destroy();
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof AppError && ['UNSAFE_URL','UNSAFE_ADDRESS'].includes(error.code)) throw error;
    }
  }
  const proxy = await createEgressProxy(signal);
  try {
    const output = await runProcess(config.YTDLP_BIN,[...extractorArgs,'--proxy',proxy.url,
      ...(isX ? ['--extractor-args','twitter:api=syndication'] : []),
      '--skip-download','--dump-single-json','--no-warnings','--no-playlist','--playlist-end','16','--',url],signal);
    if (proxy.error) throw proxy.error;
    const extracted = fromYtdlp(JSON.parse(output));
    if (publicData?.media.length) {
      for (const media of publicData.media) {
        if (media.public.kind === 'image') continue;
        const paths = new Set(media.qualities.map(q => new URL(q.url).pathname));
        const match = extracted.media.find(item => item.qualities.some(q => paths.has(new URL(q.url).pathname)));
        if (match) {
          media.qualities = match.qualities.map(q => ({...q,public:media.public.kind === 'gif' ? {id:q.public.id,label:q.public.label,extension:'gif' as const} : q.public}));
          media.public = {...match.public,id:media.public.id,kind:media.public.kind,qualities:media.qualities.map(q => q.public)};
        }
      }
      return publicData;
    }
    if (extracted.media.length) return extracted;
    if (htmlData?.media.length) return htmlData;
    throw new AppError('NO_MEDIA','No encontramos medios descargables. El sitio puede necesitar sesión, tener DRM o no ser compatible.',422);
  } catch (error) {
    signal.throwIfAborted();
    if (proxy.error) throw proxy.error;
    if (publicData?.media.length) {publicData.warnings.push('Se ha utilizado la información pública de X porque yt-dlp no pudo completar el análisis.');return publicData;}
    if (htmlData?.media.length && !(error instanceof AppError && error.code === 'LIVE_UNSUPPORTED')) return htmlData;
    throw error;
  } finally {proxy.close();}
}
