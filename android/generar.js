'use strict';
/**
 * Genera el proyecto Android (TWA) de STOP Dominicano a partir de twa-manifest.json,
 * usando la librería de Bubblewrap (la misma que usa PWABuilder).
 * Lo corre GitHub Actions: .github/workflows/android.yml
 */
const path = require('path');
const { TwaManifest, TwaGenerator, ConsoleLog } = require('@bubblewrap/core');

(async () => {
  const manifest = await TwaManifest.fromFile(path.join(__dirname, 'twa-manifest.json'));
  if (process.env.VERSION_CODE) manifest.appVersionCode = Number(process.env.VERSION_CODE);
  if (process.env.VERSION_NAME) manifest.appVersionName = process.env.VERSION_NAME;
  const error = typeof manifest.validate === 'function' ? manifest.validate() : null;
  if (error) throw new Error(`twa-manifest.json inválido: ${error}`);
  console.log(`Generando ${manifest.packageId} versión ${manifest.appVersionName} (${manifest.appVersionCode})`);
  await new TwaGenerator().createTwaProject(path.join(__dirname, 'proyecto'), manifest, new ConsoleLog('bubblewrap'));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
