# Arquitectura de fase 1

El navegador utiliza exclusivamente rutas relativas `/api`. En desarrollo, Vite las reenvía a Fastify; el build de producción lo sirve el propio Fastify. No hay servicios remotos de analítica, fuentes externas ni dependencias visuales de terceros en tiempo de ejecución.

## Flujo

1. El esquema compartido valida y normaliza el enlace a `https://x.com/i/web/status/ID`.
2. El motor reserva un slot de trabajo. El controlador de la petición impone un plazo total y cancela cuando se desconecta el cliente.
3. El extractor consulta la sindicación pública para fotos, GIFs y orden de publicación; yt-dlp analiza vídeos a través de un proxy de salida temporal. Solo se aceptan fuentes en `video.twimg.com` o `pbs.twimg.com` y MP4 completos por HTTPS.
4. La respuesta contiene metadatos y un UUID aleatorio que identifica una capacidad temporal en memoria. Las URLs reales de los archivos nunca son parámetros aceptados por la API de descarga.
5. Fastify sirve la previsualización mediante una petición con DNS validado, IP fijada y límites de tamaño.
6. La descarga valida el UUID y la calidad, crea un directorio privado y guarda el contenido con un límite real de bytes. Para MP4, FFmpeg procesa solo el archivo local: añade `faststart` a vídeos y convierte las animaciones a GIF con paleta, 15 fps, hasta 640 px y bucle infinito. El GIF se escribe por streaming con límite estricto de bytes.
7. Fastify envía un attachment con longitud y tipo. El directorio se elimina al finalizar o cerrar la respuesta. También se limpia ante fallos, cancelaciones y apagado normal. Los trabajos abandonados por un apagado brusco se eliminan en el próximo arranque tras una hora.

`packages/shared` no depende de Node. El frontend valida la respuesta con Zod, permitiendo detectar incompatibilidades de contrato. El backend se empaqueta con tsup e incluye el paquete compartido; el servidor construido no necesita ejecutar TypeScript.

## API

| Método y ruta | Entrada | Resultado |
| --- | --- | --- |
| `GET /api/health` | — | `{status: "ok", mode: "guest"}`; indica proceso activo, no disponibilidad de X |
| `POST /api/analyze` | `{url}` | `Analysis`: sesión, caducidad, título, autor público, medios, calidades, avisos |
| `GET /api/preview/:sessionId/:mediaId` | Capacidad y medio | Imagen JPEG/PNG/WebP limitada a 5 MiB |
| `POST /api/download` | `{sessionId, mediaId, qualityId}` | Attachment binario o error JSON antes de comenzar la transferencia |

Todos los errores tienen forma `{error: {code, message}}`. Códigos relevantes: `INVALID_INPUT`, `ORIGIN`, `HOST`, `BUSY`, `EXPIRED`, `FILE_TOO_LARGE`, `TIMEOUT`, `RATE_LIMIT`, `DEPENDENCY_MISSING`, `EXTRACTION_FAILED`.

## Extensiones futuras

Las rutas solo dependen de la interfaz `Engine`. Un futuro módulo de identidad y un repositorio opcional de historial se pueden conectar alrededor de estas rutas sin modificar el extractor ni el contrato de medios. No hay identidad, esquema de usuario, migraciones ni almacenamiento de historial en esta versión. El modo invitado es el único implementado.

Linux ARM64 utiliza los mismos módulos Node y binarios nativos de su distribución. No se fijan rutas de macOS en el motor; `YTDLP_BIN`, `FFMPEG_BIN` y `TEMP_ROOT` son configurables. Los ejemplos de `docker/` no son todavía una receta de producción validada.
