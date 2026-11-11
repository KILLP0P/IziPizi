import { analysisSchema, type Analysis } from '@izipizi/shared';
async function errorMessage(response: Response): Promise<string> {
  try { const body: unknown = await response.json(); if (body && typeof body === 'object' && 'error' in body) { const error = body.error; if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message; } } catch { /* use friendly fallback */ }
  return response.status === 429 ? 'Demasiadas solicitudes. Espera un minuto.' : 'No se ha podido conectar con IziPizi. Comprueba que la API está en marcha.';
}
export async function analyze(url: string, signal: AbortSignal): Promise<Analysis> {
  const response = await fetch('/api/analyze',{ method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ url }), signal });
  if (!response.ok) throw new Error(await errorMessage(response));
  return analysisSchema.parse(await response.json());
}
export async function download(sessionId: string, mediaId: string, qualityId: string, signal: AbortSignal): Promise<string> {
  const response = await fetch('/api/download',{ method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ sessionId,mediaId,qualityId }), signal });
  if (!response.ok) throw new Error(await errorMessage(response));
  const blob = await response.blob();
  const name = /filename="([a-zA-Z0-9._-]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'izipizi.mp4';
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
  return name;
}
