# Arquitectura multimedia general

El navegador utiliza rutas relativas `/api`. En desarrollo, Vite las reenvía a Fastify. El build de producción lo sirve el propio Fastify, también por LAN o mediante el túnel HTTPS configurado.

## Flujo

1. Zod valida una URL pública HTTP/HTTPS y conserva sus parámetros firmados. Los enlaces de X se normalizan y utilizan su adaptador específico.
2. Un slot de trabajo y un AbortSignal limitan tiempo y concurrencia. Una desconexión del cliente cancela la operación.
3. Para enlaces generales se inspecciona la respuesta: un tipo multimedia reconocido genera un archivo directo; el HTML estático se analiza con Cheerio, sin ejecutar scripts. yt-dlp analiza los sitios compatibles a través del proxy de salida protegido. Si no encuentra vídeo/audio descargable, se pueden devolver los medios del HTML con un aviso.
4. Se construyen capacidades temporales en memoria. El navegador recibe IDs opacos y calidades, nunca una API para suministrar URLs de descarga o argumentos arbitrarios.
5. Los formatos completos se descargan por HTTP(S) con DNS validado e IP fijada. Para HLS, DASH o pistas separadas, yt-dlp recibe un `media.json` local construido con campos permitidos y un selector fijo. Sus descargadores nativos atraviesan el mismo proxy.
6. FFmpeg y FFprobe usados por yt-dlp se ejecutan mediante wrappers locales que solo permiten `file,pipe` en cada entrada. Un fallback que pretenda abrir una URL remota se rechaza. La unión y el remux se realizan únicamente sobre medios locales.
7. FFprobe comprueba los bytes descargados. Los GIF directos se conservan; las animaciones MP4 de X se convierten a GIF con límite estricto de salida. Un attachment entrega el archivo y la respuesta elimina el directorio temporal al terminar, cancelar o fallar.

## Módulos

| Archivo | Responsabilidad |
| --- | --- |
| `packages/shared/src/index.ts` | URLs, esquemas y contratos compartidos |
| `extractor.ts` | Orquestación general y adaptador de X |
| `html.ts` | Detección estática de medios sin navegador |
| `ytdlp.ts` | Metadatos, calidades y planes de descarga permitidos |
| `media.ts` | Tipos internos y formatos/MIME |
| `network.ts` | DNS público, peticiones con IP fijada, proxy HTTP y CONNECT |
| `native-download.ts` | HLS/DASH, unión de pistas, wrappers sin red y vigilancia de disco |
| `engine.ts` | Sesiones, descarga, verificación, conversión y temporales |
| `process.ts` | Procesos sin shell, límites de salida y cancelación del grupo de procesos |

## API

| Método | Entrada | Resultado |
| --- | --- | --- |
| `GET /api/health` | — | Proceso activo, modo invitado; no prueba todos los sitios |
| `POST /api/analyze` | `{url}` | Sesión temporal, título, autor si existe, medios, calidades y avisos |
| `GET /api/preview/:sessionId/:mediaId` | Capacidad y medio | Imagen JPEG/PNG/WebP/GIF/AVIF limitada a 5 MiB |
| `POST /api/download` | `{sessionId,mediaId,qualityId}` | Attachment o error JSON antes de comenzar la transferencia |

Los errores tienen forma `{error:{code,message}}`. Los IDs y sesiones existentes caducan o desaparecen al reiniciar. No hay cuentas ni historial. La interfaz `Engine` conserva la separación para futuras extensiones opcionales.

Linux ARM64 utiliza los mismos módulos y binarios de su distribución. `YTDLP_BIN`, `FFMPEG_BIN`, `FFPROBE_BIN` y `TEMP_ROOT` son configurables; no hay rutas de macOS en el motor. Los ejemplos de Docker siguen siendo preparatorios, no un despliegue validado en Raspberry Pi.
