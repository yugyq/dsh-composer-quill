/**
 * Summarise the plugin's diagnostic log for a verification pass:
 * which build ran, how often requests were cancelled, and whether the
 * next-message predictions still reach into old topics.
 *
 * Usage: node dev/tools/summarize-log.mjs [hours] [sessionId]
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const hours = Number(process.argv[2] ?? 1)
const onlySession = process.argv[3] ?? null
const candidates = [
  path.join(homedir(), '.dsh', 'composer-quill.log'),
  path.join(homedir(), '.dsh', 'profiles', 'desktop', 'composer-quill.log'),
]
const file = candidates.find((candidate) => existsSync(candidate))
if (file === undefined) {
  console.log('找不到日志文件，试过:', candidates.join(', '))
  process.exit(1)
}

const since = Date.now() - hours * 3600 * 1000
const events = []
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (line.trim() === '') continue
  try {
    const event = JSON.parse(line)
    if (Date.parse(event.at) < since) continue
    if (onlySession !== null && event.sessionId !== onlySession && event.sessionId !== undefined) continue
    events.push(event)
  } catch {
    // A truncated final line is normal while the host is still writing.
  }
}

const count = (name) => events.filter((event) => event.event === name).length
const builds = new Map()
for (const event of events) {
  if (event.build) builds.set(event.build, (builds.get(event.build) ?? 0) + 1)
}

const requests = count('request')
const cancelled = count('cancelled')
const results = events.filter((event) => event.event === 'result')
const skipped = results.filter((event) => event.reason === 'skipped').length
const deltas = events.filter((event) => event.event === 'first-delta').map((event) => event.ms).filter(Boolean)
const median = deltas.length === 0 ? null : [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)]

console.log(`日志: ${file}`)
console.log(`窗口: 最近 ${hours} 小时${onlySession ? `，会话 ${onlySession}` : ''}，共 ${events.length} 条事件`)
console.log('')
console.log(`build     : ${[...builds].map(([build, n]) => `${build} ×${n}`).join('  ') || '(无 beacon)'}`)
console.log(`request   : ${requests}`)
console.log(`cancelled : ${cancelled}${requests > 0 ? `（${Math.round((cancelled / requests) * 100)}% 的请求被取消）` : ''}`)
console.log(`result    : ${results.length} 条，其中 empty/skipped ${skipped} 条`)
console.log(`首字节    : ${median === null ? '(无样本)' : `中位 ${median} ms，样本 ${deltas.length}`}`)
console.log('')

// Per-build breakdown. Only beacons carry `build`, so a request is attributed to
// the last build that reported one — beacons fire on every dock-state change, so
// the attribution is close enough to compare two tuning runs.
const byBuild = new Map()
let currentBuild = '(unknown)'
for (const event of events) {
  if (event.build) currentBuild = event.build
  const bucket = byBuild.get(currentBuild) ?? { requests: 0, cancelled: 0, retrigger: 0, gap: [] }
  if (event.event === 'request') bucket.requests += 1
  if (event.event === 'cancelled') bucket.cancelled += 1
  if (event.event === 'beacon' && event.stage === 'retrigger') {
    bucket.retrigger += 1
    const at = Date.parse(event.at)
    if (bucket.lastAt !== undefined) bucket.gap.push(at - bucket.lastAt)
    bucket.lastAt = at
  }
  byBuild.set(currentBuild, bucket)
}
if (byBuild.size > 0) {
  console.log('按 build 拆分:')
  for (const [build, bucket] of byBuild) {
    const rate = bucket.requests === 0 ? null : Math.round((bucket.cancelled / bucket.requests) * 100)
    const gaps = [...bucket.gap].sort((a, b) => a - b)
    const gapFast = gaps.length === 0 ? null : gaps[Math.floor(gaps.length * 0.2)]
    console.log(
      `  ${build.padEnd(9)} 请求 ${String(bucket.requests).padStart(3)}  ` +
      `取消 ${String(bucket.cancelled).padStart(3)}${rate === null ? '' : `（${rate}%）`}  ` +
      `重触发 ${String(bucket.retrigger).padStart(3)}` +
      (gapFast === null ? '' : `  重触发最快间隔 ${gapFast} ms`),
    )
  }
  console.log('')
}


// The report this pass is checking: a prediction that belongs to a topic the
// conversation left behind. Surface the actual candidate texts so they can be read.
const repeated = events.filter((event) => event.event === 'next-repeated')
console.log(`next-repeated: ${repeated.length} 条${repeated.length > 0 ? '（这条事件已经不存在于 0.31.11，出现即说明版本没生效）' : '（符合预期：闸门已撤）'}`)
