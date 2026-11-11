import { z } from 'zod';
const schema = z.object({
 HOST: z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),
 PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
 PUBLIC_ORIGIN: z.string().url().startsWith('https://').optional(),
 WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
 MAX_CONCURRENT: z.coerce.number().int().min(1).max(8).default(2),
 MAX_FILE_MB: z.coerce.number().int().min(1).max(500).default(100),
 JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(300).default(120),
 SESSION_TTL_SECONDS: z.coerce.number().int().min(30).max(1800).default(600),
 FFPROBE_BIN: z.string().default('ffprobe'),
 YTDLP_BIN: z.string().default('yt-dlp'), FFMPEG_BIN: z.string().default('ffmpeg'), TEMP_ROOT: z.string().optional(),
});
export const config = schema.parse(process.env);
export type Config = typeof config;
