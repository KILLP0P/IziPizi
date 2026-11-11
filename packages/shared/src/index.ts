import { z } from 'zod';

const xHosts = new Set(['x.com','www.x.com','m.x.com','mobile.x.com','twitter.com','www.twitter.com','m.twitter.com','mobile.twitter.com']);
export function isPublicHostname(host: string): boolean {
  if (host.length > 253 || !host.includes('.') || host.endsWith('.') || /^\d+(?:\.\d+)*$/.test(host)) return false;
  if (/(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|example|onion)$/.test(host)) return false;
  return host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}
export function normalizeMediaUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Pega un enlace completo de una página o archivo multimedia.'); }
  if (!['https:','http:'].includes(url.protocol) || !isPublicHostname(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Utiliza una dirección HTTP o HTTPS de un sitio público, sin credenciales ni puertos alternativos.');
  }
  if (xHosts.has(url.hostname)) {
    const match = /^\/(?:[a-zA-Z0-9_]{1,15}|i\/web)\/status\/(\d{1,22})(?:\/(?:photo|video)\/[1-4])?\/?$/.exec(url.pathname);
    if (!match?.[1]) throw new Error('Para X o Twitter, pega el enlace de una publicación.');
    return `https://x.com/i/web/status/${match[1]}`;
  }
  url.hash = '';
  return url.href;
}
export const normalizePostUrl = normalizeMediaUrl;
export const extensionSchema = z.enum(['mp4','webm','mov','mkv','gif','jpg','png','webp','avif','mp3','m4a','aac','ogg','opus','wav','flac']);
export type Extension = z.infer<typeof extensionSchema>;
export const postUrlSchema = z.string().trim().max(2048).transform((value, ctx) => {
  try { return normalizeMediaUrl(value); } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message }); return z.NEVER;
  }
});
export const analyzeSchema = z.object({ url: postUrlSchema }).strict();
export const downloadSchema = z.object({ sessionId: z.string().uuid(), mediaId: z.string().regex(/^m\d{1,2}$/), qualityId: z.string().regex(/^q\d{1,3}$/) }).strict();
export const qualitySchema = z.object({ id: z.string(), label: z.string(), extension: extensionSchema, bytes: z.number().positive().optional() });
export const mediaSchema = z.object({ id: z.string(), kind: z.enum(['video','gif','image','audio']), previewUrl: z.string().optional(), width: z.number().optional(), height: z.number().optional(), duration: z.number().optional(), qualities: z.array(qualitySchema).min(1) });
export const analysisSchema = z.object({ sessionId: z.string().uuid(), sourceUrl: z.string(), title: z.string(), author: z.string().optional(), expiresAt: z.string(), media: z.array(mediaSchema).min(1), warnings: z.array(z.string()) });
export type Analysis = z.infer<typeof analysisSchema>;
export type Media = z.infer<typeof mediaSchema>;
export type Quality = z.infer<typeof qualitySchema>;
export interface ApiError { error: { code: string; message: string } }
