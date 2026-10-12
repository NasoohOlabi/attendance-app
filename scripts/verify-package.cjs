const path = require('node:path');
const { listPackage, statFile, extractFile } = require('@electron/asar');

function verifyPackage(appOutDir) {
  const archive = path.join(appOutDir, 'resources', 'app.asar');
  const allowedRoots = new Set(['out', 'node_modules', 'package.json', 'LICENSE']);
  for (const entry of listPackage(archive)) {
    const archivePath = entry.replace(/^[\\/]/, '');
    const name = entry.replaceAll('\\', '/').replace(/^\//, '');
    if (!allowedRoots.has(name.split('/')[0])) {
      throw new Error(`Unexpected packaged root entry: ${name}. Only compiled app files, dependencies, and license may be shipped.`);
    }
    const stat = statFile(archive, archivePath);
    if (stat.files || stat.link || !name.endsWith('.json')) continue;
    const text = extractFile(archive, archivePath).toString('utf8');
    if (/"type"\s*:\s*"service_account"|"private_key"\s*:\s*"[^"\r\n]*-----BEGIN/.test(text)) {
      throw new Error(`Credential-shaped JSON in package: ${name}. No credential values were printed.`);
    }
  }
  console.log('Packaged app file boundary and credential JSON checks passed.');
}

module.exports = (context) => verifyPackage(context.appOutDir);
if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error('Pass the unpacked app directory.');
    verifyPackage(path.resolve(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
