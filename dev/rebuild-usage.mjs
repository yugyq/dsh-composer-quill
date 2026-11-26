/**
 * Rebuild the usage ledger from the live log.
 *
 * The log records one `usage-call` line per model call (since 0.31.50), with the tokens
 * and the model. That is enough to reconstruct counts, tokens and cost — the cost is
 * recomputed at each call's own peak/off-peak price, exactly as the plugin books it.
 *
 * Only real model names count: the profile-directory log holds the test suite's own
 * output (models called `m`, `probe-model`, and so on), which must never enter a ledger.
 *
 *   node dev/rebuild-usage.mjs            # dry run, prints what it found
 *   node dev/rebuild-usage.mjs --write    # backs the current file up, then writes
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const write = process.argv.includes('--write')
const host = await import(pathToFileURL(path.resolve('index.js')).href)
const { estimateCost, emptyUsage, usageLedgerPath } = host.__test

const logs = [
  path.join(os.homedir(), '.dsh', 'composer-quill.log'),
  path.join(os.homedir(), '.dsh', 'composer-quill.log.1'),
]

const isRealModel = (model) => typeof model === 'string' && /^deepseek-(flash|v4)/.test(model)
const buckets = new Map()
const bucket = (key) => {
  if (!buckets.has(key)) buckets.set(key, { ...emptyUsage() })
  return buckets.get(key)
}

let counted = 0
let skipped = 0
const perDay = new Map()

for (const file of logs) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage-call"')) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRealModel(row.model)) {
      skipped += 1
      continue
    }
    const at = Date.parse(row.at)
    const usage = {
      inputTokens: row.input ?? 0,
      outputTokens: row.output ?? 0,
      cacheReadTokens: row.cacheRead ?? 0,
      cacheWriteTokens: row.cacheWrite ?? 0,
      reasoningTokens: row.reasoning ?? 0,
    }
    const cost = estimateCost({ model: row.model, usage, at })
    const mode = row.mode === 'next' ? 'next' : 'compose'
    const day = row.at.slice(0, 10)
    for (const target of [bucket('lifetime'), bucket(`mode:${mode}`), bucket(`model:${row.model}`), bucket(`day:${day}`)]) {
      target.calls += 1
      if (cost === null) target.uncosted += 1
      else target.costMicro += Math.round(cost * 1_000_000)
      target.input += usage.inputTokens
      target.output += usage.outputTokens
      target.cacheRead += usage.cacheReadTokens
      target.cacheWrite += usage.cacheWriteTokens
      target.reasoning += usage.reasoningTokens
    }
    counted += 1
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }
}

const rebuilt = { version: 1, lifetime: buckets.get('lifetime') ?? emptyUsage(), byMode: {}, byModel: {}, days: {} }
for (const [key, value] of buckets) {
  if (key.startsWith('mode:')) rebuilt.byMode[key.slice(5)] = value
  if (key.startsWith('model:')) rebuilt.byModel[key.slice(6)] = value
  if (key.startsWith('day:')) rebuilt.days[key.slice(4)] = value
}

const target = usageLedgerPath()
let existing = null
try {
  existing = JSON.parse(fs.readFileSync(target, 'utf8'))
} catch {
  existing = null
}

console.log(`从日志读到 ${counted} 次真实调用，跳过 ${skipped} 条测试数据`)
console.log('  按日期:', JSON.stringify(Object.fromEntries([...perDay.entries()].sort())))
console.log(`  重建结果: calls=${rebuilt.lifetime.calls}  input=${rebuilt.lifetime.input}  cost≈$${(rebuilt.lifetime.costMicro / 1e6).toFixed(3)}`)
console.log(`  现有账本: calls=${existing?.lifetime?.calls ?? 0}  (${target})`)

if (!write) {
  console.log('\n只做了试算。加 --write 才会写入（会先备份现有文件）。')
  process.exit(0)
}
if (existing !== null && (existing.lifetime?.calls ?? 0) >= rebuilt.lifetime.calls) {
  console.log('\n现有账本不比重建结果小，保持不动。')
  process.exit(0)
}
const backup = `${target}.before-rebuild-${Date.now()}`
if (fs.existsSync(target)) fs.copyFileSync(target, backup)
fs.writeFileSync(target, `${JSON.stringify(rebuilt, null, 2)}\n`)
console.log(`\n已写入 ${target}`)
if (fs.existsSync(backup)) console.log('原文件备份为:', path.basename(backup))
