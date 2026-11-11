# Seguridad y ciclo de vida

## Entrada y servicio

Se aceptan URLs públicas HTTP/HTTPS, sin credenciales, IPs literales ni puertos alternativos. Se rechazan nombres locales/reservados y esquemas no web. Los esquemas Zod son estrictos y no aceptan cookies, rutas, URLs de descarga ni argumentos de procesos proporcionados por el cliente.

Loopback es el valor por defecto. Para LAN y el túnel temporal se admiten exclusivamente los Hosts y orígenes configurados en `WEB_ORIGIN` y `PUBLIC_ORIGIN`, además de localhost. No se habilita CORS ni confianza en cabeceras de IP (`trustProxy:false`). Las solicitudes del túnel comparten los límites de su conector. CSP, `no-store`, `no-referrer` y la ausencia de logs de peticiones protegen el flujo local; Cloudflare es un intermediario adicional al utilizar el túnel público.

## Red general y SSRF

La versión general no limita todos los destinos a X: exige nombres DNS públicos y comprueba **todas las direcciones A/AAAA** en cada conexión. Rechaza redes privadas, reservadas, loopback, link-local, multicast e IPv4 mapeada en IPv6. Las peticiones Node fijan la conexión a una IP comprobada y TLS sigue verificando el nombre original. Cada redirección se revalida, con un máximo de tres para peticiones Node.

yt-dlp recibe un proxy temporal en loopback. El proxy valida tanto solicitudes HTTP al puerto 80 como CONNECT HTTPS al 443; resuelve y fija la IP de cada conexión, incluidas redirecciones, manifiestos, claves y fragmentos. Hay límites de bytes agregados y de solicitudes. Se fijan las variables de proxy del proceso y se vacía `no_proxy` para evitar exclusiones heredadas o del sistema. Los clientes no pueden elegir el proxy.

Los planes de descarga se reconstruyen con campos permitidos; se filtran protocolos, DRM, URLs y fragmentos peligrosos. No se habilitan URLs `file://` en yt-dlp, configuración del usuario, plugins, cookies ni credenciales del navegador. La detección HTML no ejecuta scripts ni rastrea páginas enlazadas.

## Procesos y archivos

`spawn` usa argumentos separados y `shell:false`. La cancelación mata el grupo de procesos en macOS/Linux, incluidos procesos de unión o runtimes hijos. Los wrappers de FFmpeg/FFprobe generados para cada trabajo solo admiten entradas `file,pipe`, incluso si yt-dlp intenta delegar un manifiesto a FFmpeg. Los procesos directos de conversión/verificación también restringen protocolos y formatos. Ningún usuario puede suministrar argumentos de estas herramientas.

Los límites normales son 100 MiB por archivo, 120 segundos por trabajo y dos trabajos simultáneos. El análisis HTML se limita a 2 MiB, los metadatos/stdout y el proxy tienen presupuestos, y solo se muestran 16 archivos. El descargador adaptativo limita el tamaño conocido, el tráfico agregado y vigila el espacio temporal; tras terminar se comprueba de nuevo el tamaño del archivo entregado. Esto no sustituye una cuota de disco del sistema operativo: entre comprobaciones puede existir un exceso transitorio acotado por el tráfico permitido. La salida GIF se escribe por streaming con backpressure y un límite de bytes estricto.

`mkdtemp` crea directorios privados, los archivos usan creación exclusiva y modo 0600, y los nombres de salida son propios. FFprobe verifica el medio descargado antes de entregarlo. Los parciales y pistas intermedias se limpian al fallar, cancelar, terminar la respuesta o apagar normalmente. Un barrido al iniciar limpia trabajos propios abandonados de más de una hora, sin seguir symlinks ni borrar directorios de otros usuarios.

## Alcance operativo

La frontera de red protege frente a URLs, DNS, metadatos y manifiestos no confiables; no sustituye un sandbox de SO frente a binarios comprometidos o modificaciones locales. Los procesos confiables y sus dependencias deben mantenerse actualizados.

No se guardan enlaces ni medios permanentemente en el servidor. Las sesiones permanecen en memoria durante diez minutos, con un máximo de cien. El navegador guarda solo el tema y los archivos que el usuario decide descargar.

La demo temporal conserva límites, pero no equivale a un servicio público permanente. El despliegue definitivo requiere aislamiento, cuotas de disco/memoria/CPU, TLS de entrada y revisión operativa. Los ejemplos ARM64 no se han validado en una Raspberry Pi física.
