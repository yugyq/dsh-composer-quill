/**
 * Probe with a realistic transcript: which path does a 2-char draft take?
 * The gate is `length >= 4 && await composeShortDraft(...)`, so a shorter draft skips
 * the short path entirely and falls into the heavy main compose.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A scripted run must never append to the log the user's own traffic is read from:
// pin a throwaway state directory before index.js is imported, because the plugin
// resolves that directory once, at load time.
process.env.DSH_COMPOSER_QUILL_STATE_DIR ??= mkdtempSync(join(tmpdir(), 'quill-probe-'))

const { __test } = await import('../../index.js')
const { produceCompose } = __test

const longEvents = []
for (let i = 0; i < 15; i += 1) {
  longEvents.push({ type: 'user/message', data: { content: [{ type: 'text', text: `第${i}轮：帮我看下这段日志里的连接超时，是不是要把超时时间调大一点` }] } })
  longEvents.push({ type: 'assistant/message', data: { content: [{ type: 'text', text: `第${i}轮回答：是连接超时，重试一次通常就好；另外可以把超时从 20 秒调到 30 秒。` }] } })
}

const session = { requestHeader: () => null, id: 's-probe' }

function fakeCtx(replies) {
  const calls = []
  let index = 0
  return {
    calls,
    ctx: {
      llm: {
        stream(request) {
          calls.push({ maxTokens: request.maxTokens, promptChars: request.messages?.[0]?.content?.[0]?.text?.length ?? 0 })
          const reply = replies[Math.min(index, replies.length - 1)]
          index += 1
          return (async function* () {
            yield { type: 'text-delta', index: 0, text: reply }
            yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 40 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
      agents: { get: () => ({ session }) },
      get: (name) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'probe', model: 'probe-model' }) } : undefined),
    },
  }
}

const run = async (label, replies, draft, events = longEvents) => {
  const { ctx, calls } = fakeCtx(replies)
  const sent = []
  await produceCompose(ctx, {
    sessionId: 'probe-short-draft',
    draft,
    key: `probe-long-${label}-${draft.length}`,
    events,
    session,
    send: (event, data) => sent.push({ event, data }),
    locale: 'zh-CN',
    forced: '',
    signal: new AbortController().signal,
  })
  const final = sent.find((s) => s.event === 'final')
  const done = sent.filter((s) => s.event === 'done').map((s) => s.data?.reason ?? s.data?.mode ?? 'ok').join(',')
  console.log(`${label.padEnd(22)} 草稿${String(Array.from(draft).length).padStart(2)}字  calls=${calls.length}  ` +
    `promptChars=${calls.map((c) => c.promptChars).join('+')}  建议=${final ? JSON.stringify(final.data.text).slice(0, 26) : '无'}  done=${done || '—'}`)
}

console.log('长对话（15 轮）下的调用形态：')
await run('2 字草稿', ['SKIP', '接着说这个'], '帮忙')
await run('3 字草稿', ['SKIP', '接着说这个'], '帮忙看')
await run('4 字草稿', ['，顺便说下是哪个接口'], '帮忙看下')
await run('10 字草稿', ['，顺便说下是哪个接口'], '帮我看下这个报错')
await run('2 字草稿（模型给尾巴）', ['，先看下日志'], '帮忙')
console.log('')
console.log('主补写路径（≥4 字）的三种回答：')
await run('10 字 · 给尾巴', ['，顺便说下是哪个接口'], '帮我看下这个报错')
await run('10 字 · 给改写', ['REWRITE: 帮我看下这个报错，顺便说下是哪个接口。'], '帮我看下这个报错')
await run('10 字 · SKIP', ['SKIP', '先确认下是哪个接口超时'], '帮我看下这个报错')
