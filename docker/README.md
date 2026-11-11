# Preparación Linux ARM64

Estos archivos son **ejemplos preparatorios**, no un despliegue definitivo ni validado en una Raspberry Pi. No se ha iniciado Docker ni publicado la aplicación.

El Dockerfile usa Node 24 y paquetes nativos de Debian para FFmpeg y Python, e instala yt-dlp en un entorno virtual. No descarga ejecutables x86. El lockfile de pnpm se usa con `--frozen-lockfile`.

Una próxima fase debe fijar una versión probada de yt-dlp, probar el build ARM64 en Raspberry Pi 5, comprobar el espacio de `/tmp`, las restricciones de memoria y CPU y la configuración de orígenes. El ejemplo de Compose limita la publicación al loopback del host. Dentro del contenedor Fastify necesita `HOST=0.0.0.0` para que funcione el mapeo de puerto.

Ejemplo de comprobación futura, desde la raíz:

```sh
docker compose -f docker/compose.example.yaml build
docker compose -f docker/compose.example.yaml up
```

No incorpora autenticación, almacenamiento permanente ni historial.
