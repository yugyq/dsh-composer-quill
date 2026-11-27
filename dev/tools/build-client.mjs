#!/usr/bin/env node
/**
 * Build the browser half the Host actually serves.
 *
 * DSH's browser loader registers ONE factory per package (`dsh.client` -> the
 * `./client` export), and package-local chunks are a compiler-generated protocol
 * (tsdown's `client.<name>.js`, served only for an exact revision URL). Betting a
 * shipped plugin on that protocol would be the same mistake the plugin avoids
 * elsewhere: assuming a Host implementation detail. So authoring is split by
 * responsibility under `client/`, and this script concatenates those fragments into
 * the single self-contained artifact, `client.js`.
 *
 * Concatenation is safe because every fragment is factory-body code: they share one
 * closure, exactly as they did when this file was one 3.5k-line script. Function
 * declarations hoist within the closure; the fragments are ordered only so the
 * declaration order stays readable.
 *
 *   npm run build:client     # rewrite client.js
 *   npm run check:client     # exit 1 when client.js is stale
 *
 * Zero dependencies on purpose: `npm test` runs from a bare checkout.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// dev/tools/ -> package root, where client/ and client.js live.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The fragments, in the order they are concatenated. */
export const CLIENT_SOURCES = Object.freeze([
  'client/prelude.js',
  'client/attachments.js',
  'client/store.js',
  'client/config.js',
  'client/geometry.js',
  'client/ghost-layer.js',
  'client/hooks.js',
  'client/dock.js',
  'client/entry.js',
])

const BODY_MARKER = '/* @@CLIENT_BODY@@ */'

/** The whole served artifact, as a string. */
export function buildClient() {
  const wrapper = readFileSync(join(root, 'client/wrapper.js'), 'utf8')
  if (!wrapper.includes(BODY_MARKER)) {
    throw new Error(`client/wrapper.js must contain ${BODY_MARKER}`)
  }
  const body = CLIENT_SOURCES
    // Each fragment owns its trailing blank lines: dropping only the final newline
    // (the file's own EOF) and joining with one keeps the rebuilt file byte-exact
    // instead of slowly accumulating blank lines at every boundary.
    .map((relative) => readFileSync(join(root, relative), 'utf8').replace(/\n$/, ''))
    .join('\n')
  return wrapper.replace(BODY_MARKER, body)
}

const target = join(root, 'client.js')
const next = buildClient()

/** Only act when run as a script: `npm test` imports buildClient() to check freshness. */
const invokedDirectly = (() => {
  const entry = process.argv[1]
  if (typeof entry !== 'string' || entry === '') return false
  return pathToFileURL(entry).href === import.meta.url
})()

if (invokedDirectly) {
  const current = (() => {
    try {
      return readFileSync(target, 'utf8')
    } catch {
      return ''
    }
  })()

  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('client.js is out of date: run `npm run build:client` and commit the result.')
      process.exitCode = 1
    } else {
      console.log('client.js matches client/ sources.')
    }
  } else {
    writeFileSync(target, next)
    console.log(`client.js rebuilt from ${CLIENT_SOURCES.length} sources (${next.length} bytes).`)
  }
}
