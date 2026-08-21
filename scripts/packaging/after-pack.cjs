// Ad-hoc re-signs the macOS app after packing. Apple Silicon refuses to start
// executables without any signature, and electron-builder skips signing when
// no Developer ID identity is configured. The packed bundle picks up resource
// forks and Finder metadata during copying, which codesign rejects outright,
// so they are stripped before signing. Cleanup is best-effort: concurrent
// finalisation can make individual paths vanish mid-scan.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

function runQuiet(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
  } catch (error) {
    console.warn(`skipped ${command} cleanup step: ${error.status ?? error.message}`);
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = join(context.appOutDir, appName);
  runQuiet('find', [appPath, '-name', '._*', '-delete']);
  // codesign rejects Finder metadata outright. The workspace can live inside
  // a file-provider domain that keeps re-adding provenance attributes, so a
  // blanket `xattr -c` is neither sufficient nor reliable; strip exactly what
  // codesign rejects, on every path, immediately before signing.
  runQuiet('find', [appPath, '-exec', 'xattr', '-d', 'com.apple.FinderInfo', '{}', ';']);
  runQuiet('find', [appPath, '-exec', 'xattr', '-d', 'com.apple.ResourceFork', '{}', ';']);
  // Rebranding renames nested helper bundles whose old signatures then no
  // longer match; stale signature containers must go before the deep sign.
  runQuiet('find', [appPath, '-depth', '-name', '_CodeSignature', '-exec', 'rm', '-rf', '{}', ';']);
  // Drop the top-level embedded signature too: after rebranding, codesign
  // refuses to re-sign while the stale signature disagrees with the plist.
  runQuiet('codesign', ['--remove-signature', appPath]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`ad-hoc signed: ${appPath}`);
};
