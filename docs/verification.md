# Verificación — 11 de noviembre de 2026

Entorno: macOS Apple Silicon (ARM64), Node 24.22.2, pnpm 10.28.2, yt-dlp 2026.10.26 y FFmpeg 9.0.2.

## Comprobaciones completadas

- `pnpm typecheck`: correcto; TypeScript estricto en frontend, backend y paquete compartido.
- `pnpm lint`: correcto.
- `pnpm test`: **60 pruebas, 7 archivos**, todas correctas.
- `pnpm build`: frontend y backend compilados correctamente.
- `pnpm run doctor`: las cuatro herramientas disponibles.
- `pnpm audit --prod`: sin vulnerabilidades conocidas en el lockfile verificado. La auditoría detectó problemas en las versiones iniciales de static y Zod; se actualizaron y se repitieron las comprobaciones.

Las pruebas cubren validación de enlaces, entradas adicionales, IPs internas y reservadas, DNS con respuestas mixtas, IP fijada en la conexión, redirecciones no permitidas, límites de bytes sin Content-Length, concurrencia, cancelación de procesos, argumentos sin shell, playlists de metadatos, fotos/GIFs/publicaciones mixtas, respuestas de API, expiración, origen/Host, cuerpos grandes, rate limiting y limpieza de archivos parciales, entregados y abandonados.

## Verificación real sin mocks

Se inició Fastify desde `apps/api/dist/index.js` mediante `pnpm start`; se sirvió el frontend compilado en `http://localhost:3001`.

- Vídeo público: `https://x.com/historyinmemes/status/1790637656616943991`.
  - Análisis anónimo con yt-dlp a través del proxy validado, sin aviso de fallback en la comprobación final.
  - Calidades de 720p, 360p y 270p.
  - Archivo de 1.406.661 bytes descargado desde la API y desde la interfaz del navegador.
  - FFprobe confirmó dos streams (audio y vídeo), y duración aproximada de 15,56 s tras el remux.
- Imagen pública: `https://x.com/NASAWebb/status/1592902833766076416`.
  - JPEG original de 160.890 bytes, descargado y validado con FFprobe.
- Ambos flujos se repitieron contra el build de producción con `scripts/smoke.mjs`. Los archivos de las pruebas de smoke se eliminaron automáticamente.
- El navegador mostró la previsualización real, las calidades y la confirmación de descarga. Se inspeccionaron vistas de 320 y 1280 px, tema claro y oscuro, validación y limpieza del campo.

Las publicaciones de prueba pertenecen a terceros y pueden dejar de estar disponibles. Una publicación antigua de GIF utilizada inicialmente ya estaba eliminada; otra no resultó accesible anónimamente. La clasificación de GIF y los medios mixtos tienen cobertura automatizada; **no se afirma una descarga real de GIF verificada en esta sesión**.

## Límites de la comprobación

No se ha ejecutado Docker, Linux ARM64 ni una Raspberry Pi física. Tampoco se ha hecho una auditoría externa de seguridad, prueba de carga prolongada, validación con lectores de pantalla reales ni comprobación en todos los navegadores/dispositivos. Los avisos del empaquetador sobre comentarios de anotación de Zod no impiden la compilación.

## Actualización: IziPizi y GIF real

La aplicación se ha renombrado a **IziPizi**, incluidos interfaz, título del navegador, paquetes, mensajes y archivos descargados. Se conserva compatibilidad para limpiar temporales del nombre anterior y recuperar la preferencia de tema.

Los GIFs se entregan como `image/gif` con extensión `.gif`, animación y bucle infinito. FFmpeg convierte una fuente MP4 local con paletas por fotograma, hasta 15 fps y 640 px por lado. La salida pasa por una tubería con límite de bytes y cancelación. Los vídeos normales conservan MP4.

La suite incorpora una conversión real con FFmpeg de un MP4 generado para la prueba: comprueba firma GIF89a, extensión, tipo MIME, bucle NETSCAPE2.0 y varios fotogramas mediante FFprobe. También comprueba que superar el límite de salida termina con error y no entrega un GIF truncado. La red del caso automatizado se simula; además se realizó la verificación real descrita a continuación.

### GIF real desde la interfaz

Se repitió el enlace público que estaba abierto en el navegador (`https://x.com/quetallitabusca/status/2120294993873211442`) con la versión actualizada. La descarga desde la interfaz entregó `izipizi-m0.gif`. FFprobe confirmó codec GIF, 51 fotogramas, 480 × 476 px, 3,40 segundos y 5.971.565 bytes; se comprobaron firma GIF89a y extensión NETSCAPE2.0 para bucle infinito. El archivo quedó en Descargas para poder revisarlo.

Resultado final: **63 pruebas correctas**, comprobaciones de tipos y lint correctas y build completo. Servidor reiniciado con la nueva versión en `http://localhost:3001`.

## Demo pública temporal

Se añadió `PUBLIC_ORIGIN` opcional y exacto para compartir la demo mediante Cloudflare Quick Tunnel, conservando el origen de la red local. Se verificó la página y `/api/health` por HTTPS público, además del acceso LAN. La prueba de integración admite ambos orígenes y rechaza hosts/orígenes ajenos; la suite final tiene **65 pruebas correctas**, tipos, lint y build correctos. No se configuró un servicio permanente ni se abrieron puertos en el router.
