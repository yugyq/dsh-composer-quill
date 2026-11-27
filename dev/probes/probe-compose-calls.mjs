/**
 * Probe: how many model calls does one compose produce, and with what cap?
 * Drives produceCompose with a scripted llm so the shape of the fallback is visible
 * without a provider.
 */
import fs from 'node:fs'

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A scripted run must never append to the log the user's own traffic is read from:
// pin a throwaway state directory before index.js is imported, because the plugin
// resolves that directory once, at load time.
process.env.DSH_COMPOSER_QUILL_STATE_DIR ??= mkdtempSync(join(tmpdir(), 'quill-probe-'))

const { __test } = await import('../../index.js')
const { produceCompose } = __test
if (typeof produceCompose !== 'function') {
  console.log('produceCompose 未导出，先导出它')
  process.exit(2)
}

const events = [
  { type: 'user/message', data: { content: [{ type: 'text', text: '帮我看下这个报错' }] } },
  { type: 'assistant/message', data: { content: [{ type: 'text', text: '是连接超时，重试一次通常就好。' }] } },
]

const session = { requestHeader: () => null, id: 'probe-compose-calls' }

/** One scripted reply per call. */
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
            yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 40, cacheReadTokens: 0 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
      agents: { get: () => ({ session }) },
      get: (name) => (name === 'agentDefaultModel'
        ? { currentSelection: () => ({ provider: 'probe', model: 'probe-model' }) }
        : undefined),
    },
  }
}

const run = async (label, replies, draft) => {
  const { ctx, calls } = fakeCtx(replies)
  const sent = []
  await produceCompose(ctx, {
    sessionId: 's-probe',
    draft,
    key: `probe-${label}`,
    events,
    session,
    send: (event, data) => sent.push({ event, data }),
    locale: 'zh-CN',
    forced: '',
    signal: new AbortController().signal,
  })
  const final = sent.find((s) => s.event === 'final')
  console.log(`${label.padEnd(28)} calls=${calls.length}  caps=${calls.map((c) => c.maxTokens).join('+')}  ` +
    `promptChars=${calls.map((c) => c.promptChars).join('+')}  final=${final ? JSON.stringify(final.data).slice(0, 40) : '无'}`)
  return calls.length
}

console.log('场景                     调用数  输出上限        提示词字符')
let total = 0
total += await run('模型说没得改（SKIP）', ['SKIP', '把超时调大到 30 秒试试。'], '帮我看下这个报错')
total += await run('模型给尾巴', ['，顺便说下是哪个接口超时'], '帮我看下这个报错')
total += await run('模型给整段改写', ['REWRITE: 帮我看下这个报错，顺便说下是哪个接口超时。'], '帮我看下这个报错')
total += await run('超长草稿（>240 字）', ['REWRITE: 整理过的版本'], 'x'.repeat(300))
total += await run('三个字草稿', ['SKIP', '接着说'], '帮忙看')
console.log('')
console.log('合计调用', total)
console.log('')
console.log('说明：每次 run() 只发一次 produceCompose，调用数 >1 才是宿主内部重发；')
console.log('      为 1 说明日志里成对的调用来自客户端的第二次请求。')
