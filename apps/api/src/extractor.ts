import { z } from 'zod';
import type { Media, Quality } from '@izipizi/shared';
import { AppError } from './errors.js';
import { checkedUrl, createEgressProxy, safeBuffer } from './network.js';
import { runProcess } from './process.js';
import type { Config } from './config.js';

export interface SourceQuality { public: Quality; url: string }
export interface SourceMedia { public: Media; thumbnail?: string; qualities: SourceQuality[] }
export interface Extracted { title: string; author?: string; media: SourceMedia[]; warnings: string[] }
const num = z.number().nonnegative().nullish();
const str = z.string().nullish();
const variantSchema = z.object({ url: z.string(), content_type: str, bitrate: num });
const detailSchema = z.object({ type: z.string(), media_url_https: str, original_info: z.object({ width: num, height: num }).nullish(), video_info: z.object({ duration_millis: num, variants: z.array(variantSchema).optional() }).nullish() });
const tweetSchema = z.object({ text: str, user: z.object({ name: str }).optional(), mediaDetails: z.array(detailSchema).max(16).optional() });
const formatSchema = z.object({ url: str, ext: str, protocol: str, height: num, width: num, tbr: num, vcodec: str, acodec: str, filesize: num });
const entrySchema = z.object({ title: str, uploader: str, duration: num, thumbnail: str, formats: z.array(formatSchema).max(300).optional() });
const infoSchema = entrySchema.extend({ entries: z.array(entrySchema).max(16).optional() });
function safeMedia(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try { return checkedUrl(raw, true).href; } catch { return undefined; }
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
export function fromYtdlp(raw: unknown): Extracted {
  const info = infoSchema.parse(raw);
  const entries = info.entries ?? [info];
  const media: SourceMedia[] = [];
  for (const entry of entries) {
    const variants = (entry.formats ?? []).filter(f => f.ext === 'mp4' && f.vcodec !== 'none' && (f.acodec !== 'none' || f.url?.includes('/tweet_video/')) && f.url && /^https:/.test(f.url) && (!f.protocol || f.protocol === 'https' || f.protocol === 'http')).map(f => ({ url: f.url!, ...(f.height ? { height: f.height } : {}), ...(f.width ? { width: f.width } : {}), ...(f.tbr ? { bitrate: f.tbr * 1000 } : {}), ...(f.filesize ? { bytes: f.filesize } : {}) }));
    const item = videoMedia(media.length, variants, variants.some(v => new URL(v.url).pathname.startsWith('/tweet_video/')) ? 'gif' : 'video', entry.thumbnail ?? undefined, entry.duration ?? undefined);
    if (item) media.push(item);
  }
  return { title: (info.title ?? 'Publicación de X').slice(0,500), ...(info.uploader ? { author: info.uploader.slice(0,100) } : {}), media, warnings: [] };
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
export async function extract(url: string, signal: AbortSignal, config: Config): Promise<Extracted> {
  const id = url.split('/').at(-1)!;
  let publicData: Extracted | undefined;
  try {
    const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g,'');
    const response = await safeBuffer(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, signal, 2 * 1024 * 1024, false);
    publicData = fromSyndication(JSON.parse(response.data.toString()));
  } catch { signal.throwIfAborted(); /* yt-dlp remains the fallback for public videos */ }
  if (publicData?.media.length && publicData.media.every(m => m.public.kind === 'image')) return publicData;
  const proxy = await createEgressProxy(signal);
  try {
    const output = await runProcess(config.YTDLP_BIN, ['--ignore-config','--no-plugin-dirs','--no-cache-dir','--no-cookies','--socket-timeout','12','--retries','0','--extractor-retries','0','--proxy',proxy.url,'--extractor-args','twitter:api=syndication','--skip-download','--dump-single-json','--no-warnings','--yes-playlist','--',url],signal);
    const extracted = fromYtdlp(JSON.parse(output));
    // The public endpoint preserves original media order, animated-GIF identity and photos.
    if (publicData?.media.length) {
      // Prefer yt-dlp's measured formats when they describe the same media,
      // retaining publication order, original IDs and GIF identity from X.
      for (const media of publicData.media) {
        if (media.public.kind === 'image') continue;
        const paths = new Set(media.qualities.map(q => new URL(q.url).pathname));
        const match = extracted.media.find(item => item.qualities.some(q => paths.has(new URL(q.url).pathname)));
        if (match) {
          media.qualities = match.qualities.map(q => ({ ...q, public: media.public.kind === 'gif' ? { id:q.public.id, label:q.public.label, extension:'gif' as const } : q.public }));
          media.public = { ...match.public, id: media.public.id, kind: media.public.kind, qualities:media.qualities.map(q => q.public) };
        }
      }
      return publicData;
    }
    if (!extracted.media.length) throw new AppError('NO_MEDIA','No encontramos vídeos, GIFs o imágenes descargables en esta publicación.',422);
    return extracted;
  } catch (error) {
    signal.throwIfAborted();
    if (publicData?.media.length) { publicData.warnings.push('Se ha utilizado la información pública de X porque yt-dlp no pudo completar el análisis.'); return publicData; }
    throw error;
  } finally { proxy.close(); }
}
