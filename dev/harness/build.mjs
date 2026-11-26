/**
 * Build the simulator bundle. Cross-platform on purpose: `node_modules/esbuild/bin/esbuild`
 * is a native binary on Linux and a .cmd shim on Windows, so running it with `node` only
 * works in one of those places. The JS API works everywhere.
 *
 *   node dev/harness/build.mjs
 */
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [join(here, 'src.js')],
  outfile: join(here, 'bundle.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
})
