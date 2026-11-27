/**
 * Verify on the real model that the real builder now produces a cacheable prompt:
 * five calls, draft growing the way typing produces it, using index.js's own builder.
 */
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const { __test } = await import('../../index.js')
const { composePrompt } = __test

const MODEL = 'deepseek-flash'
const credText = fs.readFileSync(process.env.DSH_QUILL_CREDENTIALS ?? join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
const keys = [...new Set([...credText.matchAll(/(sk-[A-Za-z0-9_-]{16,})/g)].map((m) => m[1]))]
let key = null
for (const candidate of keys) {
  const probe = await fetch('https://api.deepseek.com/v1/models', { headers: { authorization: `Bearer ${candidate}` } })
  if (probe.ok) {
    key = candidate
    break
  }
}
if (key === null) {
  console.log('没有可用的 key')
  process.exit(1)
}

// the same content the plugin sends, including the real rules
const system = [
  "You help finish the user's own draft message in the composer.",
  'Case A — the existing text only needs finishing: output ONLY the text to append.',
  'Case B — existing text must be repaired: output REWRITE: followed by the whole message.',
  'Never describe the draft, the task or your reasoning.',
].join('\n')

const context = JSON.stringify(
  Array.from({ length: 8 }, (_, i) => [
    { role: 'user', text: `第${i}轮：auth.test.ts 本地一直过，CI 必挂，我已经看了三次日志了` },
    { role: 'assistant', text: `第${i}轮回答：看了日志，是并发度不同导致的状态污染，建议先给这个用例加锁或者串行执行。` },
  ]).flat(),
)
const digest = { goals: ['修掉 CI 上不稳定的用例'], names: ['auth.test.ts'], decisions: ['先固定最不稳定的一条'] }
const style = { language: 'zh', avgLength: 26, tone: 'plain' }

const drafts = [
  '帮我把 auth.test.ts 那个用例先',
  '帮我把 auth.test.ts 那个用例先改',
  '帮我把 auth.test.ts 那个用例先改成',
  '帮我把 auth.test.ts 那个用例先改成串行',
  '帮我把 auth.test.ts 那个用例先改成串行执行',
]

const rows = []
for (const draft of drafts) {
  const prompt = composePrompt({ draft, context, digest, style, assistant: '建议先给这个用例加锁或者串行执行。', settingLanguage: 'zh' })
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 64,
      temperature: 1,
      stream: false,
    }),
  })
  if (!response.ok) {
    console.log('请求失败:', response.status, (await response.text()).slice(0, 100))
    process.exit(1)
  }
  const body = await response.json()
  const usage = body?.usage ?? {}
  rows.push({
    prompt: usage.prompt_tokens ?? 0,
    hit: usage.prompt_cache_hit_tokens ?? 0,
    miss: usage.prompt_cache_miss_tokens ?? 0,
    text: String(body?.choices?.[0]?.message?.content ?? '').trim().slice(0, 30),
  })
  await new Promise((resolve) => setTimeout(resolve, 600))
}

console.log(`用真实 builder 组装提示词，${MODEL}，5 次（草稿逐次加长）\n`)
console.log('  次  prompt  命中  未命中  命中率   输出')
rows.forEach((row, index) => {
  const rate = Math.round((row.hit / Math.max(1, row.prompt)) * 100)
  console.log(`  ${index + 1}   ${String(row.prompt).padStart(5)}  ${String(row.hit).padStart(5)}  ${String(row.miss).padStart(6)}  ${String(rate + '%').padStart(5)}   ${JSON.stringify(row.text)}`)
})
const prompt = Math.round(rows.reduce((n, r) => n + r.prompt, 0) / rows.length)
const hit = Math.round(rows.reduce((n, r) => n + r.hit, 0) / rows.length)
console.log(`\n  平均 prompt ${prompt}，平均命中 ${hit}，命中率 ${Math.round((hit / prompt) * 100)}%`)
console.log(`  第一次之后的命中率 ${Math.round((rows.slice(1).reduce((n, r) => n + r.hit, 0) / rows.slice(1).reduce((n, r) => n + r.prompt, 0)) * 100)}%`)
