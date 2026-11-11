# Seguridad y ciclo de vida

## Frontera de entrada

Los esquemas Zod son estrictos: no aceptan opciones arbitrarias de yt-dlp, cookies, rutas de salida ni URLs de archivos. El esquema de enlaces acepta únicamente HTTPS, dominios explícitos y rutas de publicaciones con ID numérico. Rechaza credenciales, puertos alternativos, perfiles y acortadores.

La API escucha en loopback por defecto, valida el Host para evitar DNS rebinding y no habilita CORS. Rechaza orígenes ajenos y peticiones de navegador marcadas `cross-site`. Se usan cabeceras de seguridad, CSP en producción, `no-store` y `no-referrer`. `trustProxy` está deshabilitado: no se confía en cabeceras de IP aportadas por el cliente.

## Frontera de red

La lista de destinos es exacta, nunca una coincidencia libre por sufijo. El análisis permite los endpoints públicos conocidos de X/Twitter; la descarga y las previsualizaciones solo `video.twimg.com` y `pbs.twimg.com`.

Cada petición Node valida URL y redirecciones (máximo 3), resuelve todos los registros A/AAAA y rechaza direcciones privadas, reservadas, loopback, link-local, multicast y IPv4 mapeada en IPv6. La conexión se fija a una IP validada y TLS verifica el nombre original, evitando una segunda resolución vulnerable a rebinding.

yt-dlp recibe un proxy HTTP temporal en loopback. Solo admite CONNECT a destinos explícitos y puerto 443, aplica la misma validación DNS y fija la IP. El tráfico de análisis se limita a 16 MiB. Las peticiones HTTP en texto claro y los dominios de redirección no permitidos se rechazan. No se utiliza un extractor genérico para descargar enlaces externos. No se entregan URLs remotas a FFmpeg. La salida GIF se transmite mediante una tubería con backpressure y límite estricto de bytes; superar el límite mata el proceso y elimina los temporales, sin entregar animaciones truncadas.

Esta frontera se aplica al tráfico realizado por los componentes configurados de la aplicación. No sustituye el aislamiento del sistema operativo frente a un binario comprometido ni a modificaciones locales del código.

## Recursos y archivos

Límites de cuerpo HTTP, solicitudes por minuto, respuesta de metadatos, bytes de red, tamaño de archivo, tiempo y concurrencia. No hay cola ilimitada. Los slots de archivos preparados permanecen limitados mientras se entregan al cliente. Las sesiones tienen TTL y capacidad máxima.

Los procesos se ejecutan con `spawn`, argumentos separados y `shell:false`. yt-dlp ignora configuración del usuario, plugins y caché; no se cargan credenciales. FFmpeg solo admite el contenedor MOV/MP4 de entrada y el protocolo local `file`. Sus referencias externas están deshabilitadas.

`mkdtemp` crea directorios privados; los archivos de origen usan `wx` y modo 0600. Los nombres descargados los genera la aplicación. Se eliminan archivos parciales ante errores; terminar/cancelar la respuesta también limpia el directorio. Al apagar normalmente se abortan trabajos y se limpian directorios. El arranque barre trabajos propios abandonados con más de una hora, sin seguir enlaces simbólicos ni tocar directorios de otros usuarios.

No se registran cuerpos de peticiones, enlaces, títulos ni IPs. Los metadatos públicos solo permanecen en memoria durante la sesión. El navegador guarda únicamente el tema; el archivo descargado queda en el dispositivo por decisión del usuario.

## Antes de una exposición pública futura

El ejemplo ARM64 conserva el alcance local. Una versión pública necesitará TLS de entrada, configuración explícita de orígenes/hosts/proxy, límites de disco/contenedor y revisión operativa. No habilitar `HOST=0.0.0.0` en el host sin completar esa fase.
