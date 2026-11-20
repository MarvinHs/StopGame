# Cómo subir STOP Dominicano a Google Play

La app de Android es una **TWA (Trusted Web Activity)**: abre el juego de `https://stop-dominicano.onrender.com` a pantalla completa, sin barra del navegador. Lo bueno: cada vez que se actualiza el servidor, la app se actualiza sola, sin subir otra versión a Play.

El juego ya está preparado: se puede instalar como app (PWA), tiene íconos, funciona sin conexión con un aviso, tiene política de privacidad y la ruta `/.well-known/assetlinks.json`.

---

## Antes de empezar (recomendado)

1. **Plan de Render que no se duerma.** En el plan gratis el servidor se apaga a los 15 minutos sin uso y la app tarda unos 50 segundos en abrir. Para la tienda conviene el plan *Starter* (7 dólares al mes).
2. **Dominio propio (opcional), por ejemplo `stop.soportesrd.com`.** Si lo vas a usar, configúralo **antes** de generar la app, porque el dominio queda grabado dentro del `.aab`. Si lo cambias después, hay que publicar otra versión.

## Paso 1 — Crear la cuenta de desarrollador
- Entra a https://play.google.com/console y paga la inscripción (25 dólares, una sola vez).
- Una **cuenta personal nueva** tiene que hacer una **prueba cerrada con al menos 12 personas durante 14 días** antes de poder publicar para todo el mundo. Ve buscando esas 12 personas (familia, clientes, panas).

## Paso 2 — Generar la app (.aab) con PWABuilder (sin instalar nada)
1. Abre https://www.pwabuilder.com y pega `https://stop-dominicano.onrender.com`.
2. Haz clic en **Package for stores → Android → Generate Package**.
3. En las opciones pon:
   - **Package ID:** `com.soportesrd.stopdominicano`
   - **App name:** `STOP Dominicano` · **Launcher name:** `STOP`
   - **Version:** `1.0.0` · **Version code:** `1`
   - **Signing key:** *Create new* (que la cree PWABuilder)
4. Descarga el `.zip`. Adentro vienen:
   - `app-release-bundle.aab` → lo que se sube a Play.
   - `signing.keystore` y `signing-key-info.txt` → **guárdalos en un lugar seguro y haz copia.** Sin esa llave no podrás actualizar la app nunca más.
   - `assetlinks.json` → contiene la huella (SHA-256) de tu llave.

> Si prefieres hacerlo en tu PC: `npm i -g @bubblewrap/cli`, luego `bubblewrap init --manifest https://stop-dominicano.onrender.com/manifest.webmanifest` (o usa el `twa-manifest.json` de esta carpeta) y `bubblewrap build`. Necesitas Java 17 y te descarga el Android SDK.

## Paso 3 — Crear la app en Play Console
1. **Crear app:** nombre "STOP Dominicano", idioma Español (Latinoamérica), tipo **Juego**, **Gratis**.
2. **Presencia en Google Play → Ficha principal:** copia los textos de `FICHA.md` y sube el ícono, el gráfico destacado y las capturas de esta carpeta.
3. **Política de la app** (en el menú *Contenido de la app*):
   - **Política de privacidad:** `https://stop-dominicano.onrender.com/privacidad`
   - **Anuncios:** No contiene anuncios.
   - **Acceso a la app:** Toda la funcionalidad está disponible sin restricciones (no hay inicio de sesión).
   - **Clasificación de contenido:** categoría *Juego*. Cuando pregunte si los usuarios pueden interactuar o comunicarse entre sí, responde **Sí** (chat de texto y de voz). No hay violencia, compras ni apuestas.
   - **Público objetivo:** **13 años o más**. Si marcas edades menores de 13, entras al programa de Familias, que es mucho más estricto con el chat de voz.
   - **Seguridad de los datos** (orientativo; revísalo tú, no soy abogado):
     - ¿Recopila o comparte datos? **Sí recopila, no comparte.**
     - **Información personal → Nombre:** sí (el apodo para jugar). Finalidad: funcionalidad de la app. Se procesa de forma efímera.
     - **Mensajes → Otros mensajes en la app:** sí (chat de texto). Finalidad: funcionalidad. Efímero.
     - **Audio → Grabaciones de voz o sonido:** sí, **opcional** (chat de voz, no se guarda). Finalidad: funcionalidad. Efímero.
     - Los datos van **cifrados en tránsito**: sí (HTTPS/WSS y WebRTC cifrado).
     - ¿Los usuarios pueden pedir que se borren? Se borran solos al terminar la sala.
   - **App de noticias / Gobierno / Salud / Finanzas:** No.

## Paso 4 — Conectar la app con el sitio (importante)
Para que la app se vea **sin barra de dirección**, Google comprueba que la app y el sitio son del mismo dueño.

1. En Play Console ve a **Configuración → Integridad de la app → Firma de apps** y copia el **certificado SHA-256 de la clave de firma de apps** (el de Google). Copia también el de tu llave de subida (está en `assetlinks.json` del zip).
2. En Render → servicio `stop-dominicano` → **Environment**, agrega:
   - `ANDROID_PACKAGE` = `com.soportesrd.stopdominicano`
   - `ANDROID_CERT_SHA256` = las dos huellas separadas por coma, por ejemplo `AB:CD:...:12,98:76:...:EF`
3. Comprueba que `https://stop-dominicano.onrender.com/.well-known/assetlinks.json` muestra tu paquete y tus huellas.

## Paso 5 — Prueba cerrada y producción
1. **Pruebas → Prueba cerrada → Crear versión:** sube el `.aab` y agrega a tus 12 testers (por correo o con un Grupo de Google).
2. Que lo usen durante **14 días**. Pídeles que jueguen de verdad, porque Google lo revisa.
3. Después, en **Panel → Solicitar acceso a producción**, responde las preguntas sobre la prueba y publica.

## Chat de voz en redes de celular (opcional, recomendado)
En la mayoría de los Wi-Fi la voz conecta directo. En algunas redes de datos móviles (con CGNAT) hace falta un servidor **TURN**. Sin él, la voz puede no conectar entre esas personas; el juego sí funciona igual.

- **Cloudflare (recomendado):** en el panel de Cloudflare → *Calls → TURN* crea una llave y pon en Render `CF_TURN_KEY_ID` y `CF_TURN_API_TOKEN`. Los primeros 1 000 GB al mes son gratis (compartidos con su SFU) y luego cuesta 0.05 dólares por GB. Una conversación de voz gasta muy poco (unos 20-30 MB por hora por persona).
- **Otro proveedor (Metered, Twilio, coturn propio):** pon `TURN_URLS` (separados por coma), `TURN_USERNAME` y `TURN_CREDENTIAL`.

## Actualizaciones
- **Cambios en el juego:** solo actualiza el servidor (Render los publica solo). La app los toma al abrir.
- **Cambios en la app** (nombre, ícono, dominio): genera otro `.aab` con la **misma llave**, sube el *Version code* (2, 3…) y súbelo a Play.
