import { z } from 'zod';

const hosts = new Set(['x.com', 'www.x.com', 'm.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'm.twitter.com', 'mobile.twitter.com']);
export function normalizePostUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Pega un enlace completo de una publicación de X o Twitter.'); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Utiliza un enlace https://x.com o https://twitter.com.');
  }
  const match = /^\/(?:[a-zA-Z0-9_]{1,15}|i\/web)\/status\/(\d{1,22})(?:\/(?:photo|video)\/[1-4])?\/?$/.exec(url.pathname);
  if (!match?.[1]) throw new Error('El enlace debe apuntar a una publicación: x.com/usuario/status/123…');
  return `https://x.com/i/web/status/${match[1]}`;
}
export const postUrlSchema = z.string().trim().max(2048).transform((value, ctx) => {
  try { return normalizePostUrl(value); } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message }); return z.NEVER;
  }
});
export const analyzeSchema = z.object({ url: postUrlSchema }).strict();
export const downloadSchema = z.object({ sessionId: z.string().uuid(), mediaId: z.string().regex(/^m\d{1,2}$/), qualityId: z.string().regex(/^q\d{1,3}$/) }).strict();
export const qualitySchema = z.object({ id: z.string(), label: z.string(), extension: z.enum(['mp4','gif','jpg','png','webp']), bytes: z.number().positive().optional() });
export const mediaSchema = z.object({ id: z.string(), kind: z.enum(['video','gif','image']), previewUrl: z.string().optional(), width: z.number().optional(), height: z.number().optional(), duration: z.number().optional(), qualities: z.array(qualitySchema).min(1) });
export const analysisSchema = z.object({ sessionId: z.string().uuid(), sourceUrl: z.string(), title: z.string(), author: z.string().optional(), expiresAt: z.string(), media: z.array(mediaSchema).min(1), warnings: z.array(z.string()) });
export type Analysis = z.infer<typeof analysisSchema>;
export type Media = z.infer<typeof mediaSchema>;
export type Quality = z.infer<typeof qualitySchema>;
export interface ApiError { error: { code: string; message: string } }
