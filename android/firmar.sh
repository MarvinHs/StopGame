#!/usr/bin/env bash
# Firma el .aab (para Google Play) y el .apk (para instalar y probar en un celular).
# Usa la llave guardada en los secretos de GitHub; si no está, firma con una llave
# de PRUEBA que sirve para probar en el celular pero NO para subir a Play.
set -euo pipefail
cd "$(dirname "$0")"
OUT=salida
mkdir -p "$OUT"
AAB=proyecto/app/build/outputs/bundle/release/app-release.aab
APK=$(ls proyecto/app/build/outputs/apk/release/*.apk | head -1)

if [ -n "${KS_B64:-}" ] && [ -n "${KS_PASS:-}" ]; then
  echo "$KS_B64" | base64 -d > android.keystore
  TIPO="OFICIAL"
else
  echo "::warning::No están los secretos ANDROID_KEYSTORE_BASE64 y ANDROID_KEYSTORE_PASSWORD. Se firma con una llave de PRUEBA (no subir a Play)."
  KS_PASS="prueba-$(date +%s)"
  keytool -genkeypair -keystore android.keystore -storetype PKCS12 -alias stop -keyalg RSA -keysize 2048 \
    -validity 365 -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Prueba, O=SoportesRD, C=DO"
  TIPO="PRUEBA"
fi

BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)

jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore android.keystore \
  -storepass "$KS_PASS" -keypass "$KS_PASS" -signedjar "$OUT/stop-dominicano.aab" "$AAB" stop

"$BT/zipalign" -f -p 4 "$APK" "$OUT/alineado.apk"
"$BT/apksigner" sign --ks android.keystore --ks-key-alias stop --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$OUT/stop-dominicano.apk" "$OUT/alineado.apk"
rm -f "$OUT/alineado.apk" "$OUT"/*.idsig

SHA=$(keytool -list -v -keystore android.keystore -storepass "$KS_PASS" -alias stop | grep 'SHA256:' | awk '{print $2}')
rm -f android.keystore

cat > "$OUT/LEEME.txt" <<TXT
STOP Dominicano — app de Android
Firma: $TIPO
Huella SHA-256 de la llave: $SHA

stop-dominicano.aab  -> se sube a Google Play Console (solo si la firma es OFICIAL).
stop-dominicano.apk  -> para instalar directo en un celular y probar.
TXT
cat "$OUT/LEEME.txt"
echo "### App de Android lista ($TIPO)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "Huella SHA-256: \`$SHA\`" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
