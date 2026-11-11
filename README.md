# IziPizi

Pega un enlace público de X y descarga sus vídeos, GIFs e imágenes. Aplicación local, open source y sin cuentas. React + TypeScript + Vite + Tailwind, Fastify, Zod, yt-dlp y FFmpeg.

## Ejecutar en macOS (Apple Silicon)

Requisitos: Homebrew, Node.js **24 LTS**, pnpm, yt-dlp y FFmpeg.

```sh
brew install node@24 pnpm yt-dlp ffmpeg
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH"
cd /Users/marcelo/Documents/Codex/IziPizi
pnpm install
pnpm run doctor
pnpm dev
```

Abre **http://localhost:5173**. La API escucha únicamente en `127.0.0.1:3001`; Vite reenvía `/api`. No necesitas crear `.env` para empezar. Opcionalmente copia `.env.example` a `.env` y ajusta los límites antes de arrancar.

Si Homebrew no está en tu PATH, también puedes arrancar con `./scripts/dev.sh`. Este lanzador ajusta el PATH solo para su propio proceso, sin modificar tu configuración de shell.

1. Copia un enlace como `https://x.com/usuario/status/123456789`.
2. Pégalo y pulsa **Obtener archivos**.
3. Selecciona calidad si hay varias y pulsa **Descargar** en el archivo deseado.

Las publicaciones con varios elementos muestran una tarjeta por archivo. Los GIFs de X se convierten a **archivos `.gif` animados** con reproducción en bucle. La conversión utiliza hasta 15 fps y 640 px por lado, sin ampliar imágenes pequeñas, para moderar tamaño y consumo de memoria.

## Probar desde el móvil en la misma red

El modo predeterminado solo escucha en el propio Mac. Para una prueba por Wi-Fi, configura `.env` con la IP local del Mac:

```dotenv
HOST=0.0.0.0
PORT=3001
WEB_ORIGIN=http://192.168.0.139:3001
```

Ejecuta `pnpm build && pnpm start` y abre **http://192.168.0.139:3001** en el móvil, conectado a la misma red. Usa `http`, no `https`. La IP del ejemplo es la del Mac al configurar esta prueba; si cambia, actualiza `WEB_ORIGIN` y reinicia el servidor. La validación de Host admite únicamente localhost y el host configurado. Si macOS muestra una solicitud de conexiones entrantes para Node, permite la conexión para poder probar desde otro dispositivo.

Para volver al modo exclusivo del Mac, elimina estas opciones de `.env` o configura `HOST=127.0.0.1` y `WEB_ORIGIN=http://localhost:3001`. El acceso por red local no configura un despliegue público ni abre puertos en el router.

## Comandos

| Comando | Resultado |
| --- | --- |
| `pnpm dev` | Frontend y API con recarga |
| `pnpm run doctor` | Verifica las cuatro herramientas; usar `run` para evitar el comando interno de pnpm |
| `pnpm typecheck` | TypeScript estricto en todos los paquetes |
| `pnpm lint` | ESLint |
| `pnpm test` | Tests unitarios y de integración, independientes de X |
| `pnpm build` | Frontend y backend de producción |
| `pnpm check` | Tipos, lint, tests y build |
| `pnpm start` | Sirve el build completo en http://localhost:3001 |
| `MEDIADROP_TEST_URL=https://x.com/usuario/status/ID pnpm run smoke` | Prueba real contra la API en marcha; descarga, verifica y borra el archivo de prueba |

Para probar el build local: detén `pnpm dev`, ejecuta `pnpm build && pnpm start` y abre http://localhost:3001. No hace falta Vite en este modo.

## Estructura

```text
apps/web/          React, temas, tarjetas, accesibilidad y cliente HTTP
apps/api/          Rutas Fastify, extractor, red, procesos y temporales
packages/shared/  Esquemas Zod, validación y contratos TypeScript
scripts/          Diagnóstico, arranque y prueba real opcional
docs/             Arquitectura, seguridad y comprobaciones
docker/           Ejemplos preparatorios para Linux ARM64, sin despliegue definitivo
```

## Límites y privacidad

Por defecto: **100 MiB por archivo, 120 s por operación, 2 operaciones simultáneas**, 12 análisis y 20 descargas por minuto e IP. Las previsualizaciones tienen un límite de 5 MiB y 4 solicitudes simultáneas. Las sesiones duran 10 minutos y solo existen en memoria (máximo 100). El servidor no registra enlaces, direcciones IP, cuentas ni historial. El navegador guarda únicamente la preferencia de tema.

Los archivos se guardan en directorios temporales privados y se borran al terminar la respuesta, cancelar, fallar o cerrar el servidor de forma normal. Un barrido inicial elimina directorios de trabajos abandonados de esta aplicación con más de una hora de antigüedad. No hay almacenamiento permanente ni base de datos.

Solo se admiten enlaces HTTPS de publicaciones de `x.com` y `twitter.com` y sus variantes explícitas `www`, `m` y `mobile`. Se descartan parámetros de seguimiento. No se admiten acortadores `t.co`, perfiles, espacios, emisiones en directo ni enlaces externos incluidos en una publicación.

## Limitaciones conocidas

- X puede retirar publicaciones, limitar peticiones o exigir sesión. IziPizi no utiliza cuentas, cookies ni técnicas para eludir restricciones; no todo enlace público será accesible anónimamente.
- yt-dlp extrae metadatos de vídeo. Las fotos, el orden de elementos y la identidad de los GIFs se obtienen del endpoint público de sindicación de X, que puede omitir medios y cambiar sin aviso. Si yt-dlp falla pero el endpoint ofrece variantes MP4 públicas, se muestran con un aviso.
- Esta fase admite las variantes **MP4 directas** y las fotos JPEG/PNG/WebP. No descarga HLS, DASH, contenido DRM, vídeos con audio separado ni galerías de enlaces externos. FFmpeg remultiplexa los vídeos MP4 sin recodificar y convierte las animaciones de X a GIF con una paleta optimizada.
- La conversión a GIF puede tardar más y producir archivos mayores que el MP4 de origen. Se aplican los mismos límites de tiempo y tamaño; si se superan, se muestra un error sin entregar un archivo incompleto.
- No hay botón ZIP ni descarga masiva: cada archivo se guarda desde su tarjeta.
- La descarga se prepara primero en el servidor; el navegador recibe después un Blob completo. En móviles, el límite de memoria del navegador puede aconsejar una calidad inferior.
- Los límites y las sesiones son locales a un proceso. No está preparado como servicio público permanente ni para múltiples réplicas. El despliegue definitivo en Raspberry Pi queda para la siguiente fase.

Si algo falla, ejecuta `pnpm run doctor`. Para cambios del extractor: `brew upgrade yt-dlp`. Consulta [arquitectura](docs/architecture.md), [seguridad](docs/security.md) y [verificación](docs/verification.md).

## Licencia

MIT. Las dependencias y los binarios conservan sus propias licencias. Respeta los derechos de los creadores del contenido.

## Compartir una demo temporal por Internet

Se puede exponer únicamente el servidor de IziPizi mediante un Quick Tunnel de Cloudflare, sin abrir puertos del router:

```sh
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:3001 --no-autoupdate
```

Copia la URL HTTPS que imprime el túnel a `PUBLIC_ORIGIN` en `.env`, conservando `WEB_ORIGIN` para la red local y `HOST=0.0.0.0`, y reinicia `pnpm start`. La API solo acepta ese origen público exacto, además del origen local configurado. No se habilitan comodines ni confianza en cabeceras de IP aportadas por el cliente; el tráfico del túnel comparte los límites de solicitudes del conector.

Cualquier persona que tenga la URL podrá utilizar la demo. Mantén encendido y conectado el Mac; el enlace deja de funcionar al detener `cloudflared` (Ctrl+C en su terminal). El hostname cambia si creas un túnel nuevo y tendrás que actualizar `PUBLIC_ORIGIN`. Esto sirve para una demostración, no sustituye el futuro despliegue definitivo. [Documentación oficial de Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
