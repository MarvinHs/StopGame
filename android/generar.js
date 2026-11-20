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
  // Según la versión de Bubblewrap el nombre se llama appVersionName o appVersion: llenamos los dos.
  const name = process.env.VERSION_NAME || manifest.appVersionName || manifest.appVersion || '1.0.0';
  manifest.appVersionName = name;
  manifest.appVersion = name;
  const error = typeof manifest.validate === 'function' ? manifest.validate() : null;
  if (error) throw new Error(`twa-manifest.json inválido: ${error}`);
  console.log(`Generando ${manifest.packageId} versión ${name} (${manifest.appVersionCode})`);
  const dir = path.join(__dirname, 'proyecto');
  await new TwaGenerator().createTwaProject(dir, manifest, new ConsoleLog('bubblewrap'));
  // Comprobación: el número y el nombre de versión deben quedar bien en el proyecto.
  const gradle = require('fs').readFileSync(path.join(dir, 'app', 'build.gradle'), 'utf8');
  const code = gradle.match(/versionCode\s+(\S+)/);
  const ver = gradle.match(/versionName\s+"?([^"\n]+)"?/);
  console.log(`build.gradle -> versionCode ${code && code[1]}, versionName ${ver && ver[1]}`);
  if (!ver || /undefined/.test(ver[1])) throw new Error('versionName quedó vacío en build.gradle');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
