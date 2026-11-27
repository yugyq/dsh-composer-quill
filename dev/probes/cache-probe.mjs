/**
 * Does prompt caching care where the volatile part sits?
 *
 * Same system prompt every call. Five calls per layout, each with a *different* draft,
 * the way typing produces them. Reports the cache hit the API itself returns.
 *
 *   node dev/probes/cache-probe.mjs
 */
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MODEL = 'deepseek-flash'

// ---- key, never printed
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

// ---- the fixed parts: rules, transcript, digest, style (stable within one turn)
const system = [
  'You help finish the user\'s own draft message in the composer.',
  'The draft is what the user has typed so far, and the caret sits at its end. The draft may stop mid-sentence.',
  'Case A — the existing text only needs finishing: output ONLY the text to append, starting exactly where the draft stops.',
  'Case B — existing text must be repaired: output the single marker line REWRITE: followed by the whole repaired message.',
  'Decide the case from the draft alone. Prefer Case A whenever the existing text is already sound.',
  'Do not answer the request and never invent facts, credentials or permissions.',
  'Match the language, tone and typical message length given in the style profile.',
  'Never describe the draft, the task or your reasoning.',
].join('\n')

const transcript = JSON.stringify(
  Array.from({ length: 8 }, (_, i) => [
    { role: 'user', text: `第${i}轮：auth.test.ts 本地一直过，CI 必挂，我已经看了三次日志了` },
    { role: 'assistant', text: `第${i}轮回答：看了日志，是并发度不同导致的状态污染，建议先给这个用例加锁或者串行执行。` },
  ]).flat(),
)
const digest = JSON.stringify({ goals: ['修掉 CI 上不稳定的用例'], names: ['auth.test.ts'], decisions: ['先固定最不稳定的一条'] })
const style = JSON.stringify({ language: 'zh', avgLength: 26, tone: 'plain' })
const assistant = JSON.stringify('建议先给这个用例加锁或者串行执行。')

const stableBody = [
  `Transcript, chronological:\n${transcript}`,
  `Digest: ${digest}`,
  `Style profile: ${style}`,
  `Latest assistant reply: ${assistant}`,
  'Write in Chinese — this is the user\'s language setting.',
].join('\n\n')

// five drafts, as if the user were typing one message
const drafts = [
  '帮我把 auth.test.ts 那个用例先',
  '帮我把 auth.test.ts 那个用例先改',
  '帮我把 auth.test.ts 那个用例先改成',
  '帮我把 auth.test.ts 那个用例先改成串行',
  '帮我把 auth.test.ts 那个用例先改成串行执行',
]

const layouts = {
  '草稿在前（现在）': (draft) => `${JSON.stringify(draft)}\n\n${stableBody}`,
  '草稿在后（提议）': (draft) => `${stableBody}\n\nDraft: ${JSON.stringify(draft)}`,
  '草稿放 user，其余进 system（最稳）': (draft) => `${JSON.stringify(draft)}`,
}

const call = async (systemText, userText) => {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: userText },
      ],
      max_tokens: 64,
      temperature: 1,
      stream: false,
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 100)}`)
  return (await response.json())?.usage ?? {}
}

console.log(`模型 ${MODEL}，每种布局 5 次（草稿逐次加长，模拟打字）\n`)
console.log('布局'.padEnd(34) + 'prompt  命中  未命中  命中率')
for (const [label, build] of Object.entries(layouts)) {
  const rows = []
  for (const draft of drafts) {
    const systemText = label.includes('system') ? `${system}\n\n${stableBody}` : system
    const usage = await call(systemText, build(draft))
    rows.push({
      prompt: usage.prompt_tokens ?? 0,
      hit: usage.prompt_cache_hit_tokens ?? 0,
      miss: usage.prompt_cache_miss_tokens ?? 0,
    })
  }
  const prompt = Math.round(rows.reduce((n, r) => n + r.prompt, 0) / rows.length)
  const hit = Math.round(rows.reduce((n, r) => n + r.hit, 0) / rows.length)
  const miss = Math.round(rows.reduce((n, r) => n + r.miss, 0) / rows.length)
  console.log(label.padEnd(34) + String(prompt).padStart(6) + String(hit).padStart(6) + String(miss).padStart(8) + String(Math.round((hit / Math.max(1, prompt)) * 100) + '%').padStart(7))
  console.log('   逐次命中: ' + rows.map((r) => r.hit).join(' / '))
}
