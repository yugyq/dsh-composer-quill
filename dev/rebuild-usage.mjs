/**
 * Same rebuild, but it writes to every ledger location the plugin would read, not just
 * the one this shell resolves — a shell with DSH_PROFILE_DIR set is not the app.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const write = process.argv.includes('--write')
const explicit = process.argv.find((arg) => arg.startsWith('--to='))
const host = await import(pathToFileURL(path.resolve('index.js')).href)
const { estimateCost, emptyUsage, ledgerCandidates } = host.__test

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

console.log(`从日志读到 ${counted} 次真实调用，跳过 ${skipped} 条测试数据`)
console.log('  按日期:', JSON.stringify(Object.fromEntries([...perDay.entries()].sort())))
console.log(`  重建结果: calls=${rebuilt.lifetime.calls}  input=${rebuilt.lifetime.input}  cost≈$${(rebuilt.lifetime.costMicro / 1e6).toFixed(3)}`)

const candidates = explicit ? [explicit.slice(5)] : ledgerCandidates()
const targets = []
for (const file of candidates) {
  let calls = 0
  try {
    calls = JSON.parse(fs.readFileSync(file, 'utf8'))?.lifetime?.calls ?? 0
  } catch {
    calls = 0
  }
  console.log(`  ${fs.existsSync(file) ? '存在' : '不存在'}  calls=${String(calls).padStart(4)}  ${file}`)
  if (fs.existsSync(file) || file === candidates[0]) targets.push({ file, calls })
}

if (!write) {
  console.log('\n只做了试算。加 --write 才会写入（写入前会备份每个被改动的文件）。')
  process.exit(0)
}

let wrote = 0
for (const { file, calls } of targets) {
  if (calls >= rebuilt.lifetime.calls) {
    console.log(`  跳过（现有不更小）: ${file}`)
    continue
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.before-rebuild-${Date.now()}`)
  fs.writeFileSync(file, `${JSON.stringify(rebuilt, null, 2)}\n`)
  console.log(`  已写入 ${file}`)
  wrote += 1
}
console.log(wrote === 0 ? '\n没有需要写入的文件。' : `\n写了 ${wrote} 个文件。重启 DSH 后面板才会读到新数字。`)
