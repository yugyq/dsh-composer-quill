/**
 * Show what CONTEXT_BUDGET actually does: same draft, growing transcript, and the
 * prompt size under the current budget. There is one budget now; to compare a
 * candidate set of numbers, edit CONTEXT_BUDGET and run this again.
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

// ~420 characters, so ten rows blow past both the 1600 and 3200 character caps.
const SENTENCE = '帮我看下这段日志里的连接超时问题，重试一次有时候能好，但频率越来越高，我不确定要不要把超时时间从二十秒调到三十秒，或者先确认是哪个接口在拖后腿。'.repeat(6)

function transcript(turns) {
  const events = []
  for (let i = 0; i < turns; i += 1) {
    events.push({ type: 'user/message', data: { content: [{ type: 'text', text: `第${i}轮：${SENTENCE}` }] } })
    events.push({ type: 'assistant/message', data: { content: [{ type: 'text', text: `第${i}轮回答：${SENTENCE}` }] } })
  }
  return events
}

const session = { requestHeader: () => null, id: 's-cap' }

function fakeCtx() {
  const calls = []
  return {
    calls,
    ctx: {
      llm: {
        stream(request) {
          calls.push(request.messages?.[0]?.content?.[0]?.text?.length ?? 0)
          return (async function* () {
            yield { type: 'text-delta', index: 0, text: '，顺便说下是哪个接口超时。' }
            yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 40 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
      agents: { get: () => ({ session }) },
      get: (name) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined),
    },
  }
}

const caps = { ctx: 3200, msg: 2200 }
console.log(`预算：上下文上限 ${caps.ctx} 字符（主补写）/ 单条消息 ${caps.msg}`)
for (const turns of [2, 6, 12, 24, 40]) {
  const events = transcript(turns)
  const chars = events.reduce((sum, e) => sum + e.data.content[0].text.length, 0)
  const { ctx, calls } = fakeCtx()
  await produceCompose(ctx, {
    sessionId: 'probe-context-cap',
    draft: '帮我看下这个报错',
    key: `cap-${turns}`,
    events,
    session,
    send: () => {},
    locale: 'zh-CN',
    forced: '',
    signal: new AbortController().signal,
  })
  console.log(`  ${String(turns).padStart(2)} 轮  对话 ${String(chars).padStart(5)} 字符  →  提示词 ${String(calls[0] ?? 0).padStart(5)} 字符`)
}
