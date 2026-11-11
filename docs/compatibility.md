# Compatibilidad multimedia general

IziPizi combina tres métodos. La [lista oficial de sitios de yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) describe extractores disponibles, no una garantía de acceso anónimo a todos sus enlaces.

| Método | Qué encuentra | Límites |
| --- | --- | --- |
| Extractores yt-dlp | Vídeos y audio de plataformas compatibles; formatos completos, pistas separadas, HLS y DASH | Sitios públicos accesibles sin cuentas; sin DRM ni emisiones en directo |
| HTML estático | Imágenes, vídeo/audio con `src`/`source`, Open Graph y enlaces a archivos | Sin JavaScript, sin rastreo recursivo, hasta 16 resultados; puede incluir logos o imágenes decorativas |
| Archivo directo | Medio identificado por Content-Type y comprobado con FFprobe al descargar | Dominio público HTTP/HTTPS, formato admitido y límites de recursos |
| Adaptador de X | Fotos, vídeo, GIFs y orden de publicación desde metadatos públicos | El endpoint de sindicación puede omitir medios o exigir acceso no disponible |

## Formatos

- Vídeo: MP4, WebM, MOV y MKV, según lo que ofrezca el sitio. HLS/DASH se guardan en un archivo reproducible, no como una carpeta de segmentos.
- Audio: M4A, MP3, AAC, Ogg, Opus, WAV, FLAC y WebM de audio. Se conserva el formato publicado; no se recodifica por defecto.
- Imágenes: JPEG, PNG, WebP, AVIF y GIF. Los SVG se excluyen.
- GIF: los archivos `.gif` directos se conservan; las animaciones MP4 de X se convierten a GIF animado en bucle, con un máximo de 15 fps y 640 px por lado.

Los formatos que exigen protocolos no web, contienen DRM, no tienen una pista de audio compatible para la unión o no pueden verificarse se omiten o producen un error claro. Los manifiestos requieren un descargador nativo compatible; se prohíbe que FFmpeg abra URLs remotas como fallback.

## Comprobación en esta sesión

Se descargaron vídeo con audio unido y audio independiente de un vídeo público de YouTube, un MP4 y un MP3 directos de Mozilla, una imagen extraída de la página de Python.org y un GIF directo de Wikimedia. HLS, DASH y la unión de pistas se comprobaron con binarios reales y medios generados localmente en pruebas controladas. Otros extractores no han sido probados individualmente.

Un vídeo de Vimeo devolvió solo la imagen pública encontrada en su HTML cuando el extractor no pudo ofrecer el vídeo; esto no se considera una descarga de vídeo verificada. Los sitios y sus restricciones pueden cambiar.
