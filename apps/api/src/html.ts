import { load } from 'cheerio';
import { checkedUrl } from './network.js';
import { sourceForUrl, urlExtension, type Extracted } from './media.js';

// Static discovery only: no scripts, browser execution, cookies or recursive crawl.
export function fromHtml(html: string, pageUrl: string): Extracted {
 const $ = load(html);const title = $('meta[property="og:title"]').attr('content') ?? $('title').first().text().trim() ?? '';
 let base = pageUrl;
 try { const href = $('base[href]').first().attr('href');if (href) base = checkedUrl(new URL(href,pageUrl).href).href; } catch { /* ignore unsafe base */ }
 const media: Extracted['media'] = []; const seen = new Set<string>(); let candidates = 0;
 function add(raw: string | undefined, hint?: 'image'|'video'|'audio', poster?: string) {
  if (!raw || candidates++ >= 256) return;
  try {
   const url = checkedUrl(new URL(raw,base).href).href; if (seen.has(url)) return;seen.add(url);
   const ext = urlExtension(url) ?? (hint === 'image' ? 'jpg' : undefined);
   if (!ext || media.length >= 16) return;
   const item = sourceForUrl(url,ext,media.length,{Referer:pageUrl});
   if (poster) { try {item.thumbnail = checkedUrl(new URL(poster,base).href).href;} catch { /* optional */ } }
   media.push(item);
  } catch { /* data:, SVG, local endpoints, credentials and unsupported targets are excluded */ }
 }
 $('video,audio').each((_index,node) => {
  const element = $(node);const kind = node.tagName === 'audio' ? 'audio' : 'video';
  const poster = element.attr('poster');add(element.attr('src'),kind,poster);
  element.find('source[src]').each((_i,source) => {add($(source).attr('src'),kind,poster);});
 });
 $('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:audio"]').each((_i,node) => {add($(node).attr('content'));});
 $('meta[property="og:image"],meta[name="twitter:image"],img').each((_i,node) => {
  const image = $(node);if (node.tagName === 'img' && ((Number(image.attr('width')) > 0 && Number(image.attr('width')) < 64) || (Number(image.attr('height')) > 0 && Number(image.attr('height')) < 64))) return;
  const raw = image.attr('content') ?? image.attr('data-src') ?? image.attr('src');
  // SVG is deliberately excluded, including svg URLs without a recognised MIME hint.
  if (raw && !/\.svg(?:[?#]|$)/i.test(raw)) add(raw,'image');
 });
 $('a[href]').each((_i,node) => {const href = $(node).attr('href');try {if (href && urlExtension(new URL(href,base).href)) add(href);} catch { /* malformed link */ }});
 return {title:(title || new URL(pageUrl).hostname).slice(0,500),media,warnings:media.length ? ['Se muestran los medios visibles en el HTML estático; no se ejecutan scripts ni se recorren otras páginas.',...(media.length >= 16 ? ['Se muestran como máximo 16 archivos por página.'] : [])] : []};
}
