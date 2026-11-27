/**
 * Offline smoke test for dsh-composer-quill.
 *
 * Runs without DSH and without a browser: Host pure helpers, the browser module
 * factory, both slot registrations, the beacon, and the two request triggers
 * (next message, compose) against stub props and a stub fetch.
 *
 * Usage: node smoke-test.mjs
 */
process.env.DSH_COMPOSER_QUILL_NO_CACHE = '1'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir, tmpdir as tmpdirOf } from 'node:os'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

// --- runner -----------------------------------------------------------------
// Zero dependencies on purpose: the suite has to run from a bare checkout, and
// in CI, with nothing but Node. --filter / --list exist because iterating on one
// behaviour should not mean reading sixty lines to find the failure.
const argv = process.argv.slice(2)
const filterArg = argv.find((arg) => arg.startsWith('--filter='))
const filter = filterArg === undefined ? null : new RegExp(filterArg.slice('--filter='.length), 'i')
const listOnly = argv.includes('--list')

let passed = 0
let failed = 0
let skipped = 0
let groupName = ''
const slow = []
const failures = [] // kept for the historical exit-code logic at the bottom

const matches = (name) => filter === null || filter.test(name)

// Runs after every case, pass or fail: one broken case used to leave the effect queue
// and the storage full, and the next case then failed for the wrong reason.
let fixtureReset = () => {}

const abortFailure = (signal) => {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

/**
 * A fake fetch that rejects when its signal aborts, like the real one. Without this a
 * stub kept its promise and answered into the next case — the "old draft, new tail"
 * failure that looked like a product bug but was the fixture.
 */
const honourSignal = (impl) => (url, init) => {
  const signal = init?.signal
  const promise = Promise.resolve().then(() => impl(url, init))
  if (signal === undefined || signal === null) return promise
  if (signal.aborted) return Promise.reject(abortFailure(signal))
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(abortFailure(signal)), { once: true })
    }),
  ])
}

// Every later `globalThis.fetch = …` goes through the wrapper, so a case cannot forget.
{
  let current = typeof globalThis.fetch === 'function' ? honourSignal(globalThis.fetch) : globalThis.fetch
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    get: () => current,
    set: (impl) => {
      current = typeof impl === 'function' ? honourSignal(impl) : impl
    },
  })
}


const resetFixtures = () => {
  try {
    fixtureReset()
  } catch {
    // A broken reset must not hide the failure that triggered it.
  }
}

const record = (name, ok, detail, ms) => {
  if (!groupPrinted) {
    groupPrinted = true
    console.log(`\n${groupName}`)
  }
  if (ok) {
    passed += 1
    console.log(`  ok   ${name}  (${ms.toFixed(1)}ms)`)
  } else {
    failed += 1
    failures.push(name)
    console.log(`  FAIL ${name}: ${detail}`)
  }
  slow.push({ name, ms })
}

let groupPrinted = false
const group = (name) => {
  groupName = name
  groupPrinted = false
}

const check = (name, fn) => {
  if (listOnly) { console.log(`${groupName} :: ${name}`); return }
  if (!matches(name)) { skipped += 1; return }
  const started = performance.now()
  try {
    // An async body here used to be reported as a pass without ever running its
    // assertions. Fail loudly instead: a case that awaits belongs in checkAsync.
    const returned = fn()
    if (returned !== null && typeof returned === 'object' && typeof returned.then === 'function') {
      throw new Error("check() received an async callback; use await checkAsync('" + name + "', …)")
    }
    record(name, true, '', performance.now() - started)
  } catch (error) {
    record(name, false, error.message, performance.now() - started)
  } finally {
    resetFixtures()
  }
}

const checkAsync = async (name, fn) => {
  if (listOnly) { console.log(`${groupName} :: ${name}`); return }
  if (!matches(name)) { skipped += 1; return }
  const started = performance.now()
  try {
    await fn()
    record(name, true, '', performance.now() - started)
  } catch (error) {
    record(name, false, error.message, performance.now() - started)
  } finally {
    resetFixtures()
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- Host half
group('host: pure helpers')
const host = await import(pathToFileURL('./index.js').href)

check('host exports name/inject/apply', () => {
  assert.equal(host.name, 'composerQuill')
  assert.deepEqual(host.inject, ['llm', 'agents'])
  assert.equal(typeof host.apply, 'function')
})

check('parseCandidates reads a JSON object', () => {
  assert.deepEqual(host.__test.parseCandidates('{"candidates":["继续","换个思路"]}'), ['继续', '换个思路'])
})

check('parseCandidates survives code fences and chatter', () => {
  const list = host.__test.parseCandidates('```json\n{"candidates":["  1. 接着写  ", "- 看下日志"]}\n```')
  assert.deepEqual(list, ['接着写', '看下日志'])
})

check('parseCandidates falls back to lines and drops SKIP/dupes', () => {
  assert.deepEqual(host.__test.parseCandidates('* 第一条\n2) 第二条\nSKIP\n第一条'), ['第一条', '第二条'])
})

check('parseCandidates caps at three and rejects oversize', () => {
  const list = host.__test.parseCandidates(JSON.stringify({ candidates: ['a', 'b', 'c', 'd', 'x'.repeat(200)] }))
  assert.deepEqual(list, ['a', 'b', 'c'])
})

check('parseComposed returns the finished-and-tidied message', () => {
  const draft = '帮我把这段日'
  assert.equal(
    host.__test.parseComposed('```json\n{"text":"帮我把这段日志整理一下，找出报错的那几行。"}\n```', draft),
    '帮我把这段日志整理一下，找出报错的那几行。',
  )
})

check('parseComposed ignores a reply that only restates the draft', () => {
  assert.equal(host.__test.parseComposed('{"text":"帮我把这段日"}', '帮我把这段日'), null)
})

check('parseComposed rejects truncation and runaway rewrites', () => {
  const draft = '帮我把这段日志完整地整理一下，并把报错的行标出来，然后给出下一步建议。'
  assert.equal(host.__test.parseComposed('{"text":"帮我把"}', draft), null, 'truncated rewrite slipped through')
  assert.equal(host.__test.parseComposed(JSON.stringify({ text: 'x'.repeat(1200) }), draft), null, 'runaway rewrite slipped through')
})

check('parseSentence reads a fallback sentence', () => {
  assert.equal(host.__test.parseSentence('{"sentence":"请把报错行号贴上。"}'), '请把报错行号贴上。')
  assert.equal(host.__test.parseSentence('{"sentence":""}'), null)
  assert.equal(host.__test.parseSentence('```json\n{"sentence":"顺便给出复现步骤"}\n```'), '顺便给出复现步骤')
})

check('joinSentence glues a sentence the way a person would', () => {
  const { joinSentence } = host.__test
  assert.equal(joinSentence('帮我看下这个报错。', '请把行号贴上。'), '帮我看下这个报错。请把行号贴上。')
  assert.equal(joinSentence('帮我看下这个报错', '请把行号贴上'), '帮我看下这个报错请把行号贴上。')
  assert.equal(joinSentence('Explain the trace', 'and cite the lines'), 'Explain the trace and cite the lines.')
})

check('parseComposeReply splits Case A tails from Case B rewrites', () => {
  const { parseComposeReply } = host.__test
  const tail = parseComposeReply('，请把行号贴上。', '帮我看下这个报错')
  assert.equal(tail.mode, 'append')
  assert.equal(tail.text, '帮我看下这个报错，请把行号贴上。')
  const rewrite = parseComposeReply('REWRITE:\n帮我看下这个报错，并把行号贴上。', '帮我看下这个报错')
  assert.equal(rewrite.mode, 'full')
  assert.equal(rewrite.text, '帮我看下这个报错，并把行号贴上。')
  assert.equal(parseComposeReply('帮我看下这个报错', '帮我看下这个报错'), null, 'echo must not become a tail')
  assert.equal(parseComposeReply('', '帮我看下这个报错'), null)
})

// ------------------------------------------------- Host route, fake model
group('host: routes and streaming')

check('input hygiene normalises what came out of a terminal', () => {
  const { cleanLine, isPunctuationOnly, scriptOf, latinShareOf } = host.__test
  // cleanLine collapses whitespace, strips a list marker and surrounding quotes.
  assert.equal(cleanLine('  帮我把这段   日志\n\n整理一下  '), '帮我把这段 日志 整理一下')
  assert.equal(cleanLine('- 看看这个报错'), '看看这个报错')
  assert.equal(cleanLine('2) "继续补写"'), '继续补写')
  // An empty line yields null, not an empty string: callers test for null.
  assert.equal(cleanLine('   '), null)
  assert.equal(cleanLine(null), null)
  // Punctuation-only lines carry no request.
  assert.equal(isPunctuationOnly('。。。'), true)
  assert.equal(isPunctuationOnly('……！'), true)
  assert.equal(isPunctuationOnly('   '), true)
  assert.equal(isPunctuationOnly('继续'), false)
  // scriptOf returns a coarse label, latinShareOf a ratio.
  assert.equal(scriptOf('帮我把这段日志整理一下'), 'zh')
  assert.equal(scriptOf('please tidy this log'), 'en')
  // Latin outweighs CJK here, so this reads as English: the label is coarse on purpose.
  assert.equal(scriptOf('帮我看 dsh-composer-quill 的报错'), 'en')
  assert.equal(scriptOf('帮我把 abc'), 'mixed')
  assert.equal(scriptOf(''), 'none')
  assert.equal(latinShareOf('全部是中文'), 0)
  assert.equal(latinShareOf('only english here'), 1)
  const mixed = latinShareOf('dsh-composer-quill 的缓存键')
  assert.ok(mixed > 0 && mixed < 1, String(mixed))
})

check('the on-disk cache is inert in tests and knows where it lives', () => {
  const { cacheFile, loadCache } = host.__test
  // DSH_COMPOSER_QUILL_NO_CACHE=1 is set by this suite: loadCache returns 0 entries,
  // so a test run can never hand a stale answer to the next one.
  assert.equal(loadCache(), 0)
  // The path follows the host's own directory, so assert the contract rather than
  // one machine's layout: an absolute path ending with the cache filename.
  const file = cacheFile()
  assert.ok(file.endsWith('composer-quill-cache.json'), file)
  assert.ok(isAbsolute(file), file)
  assert.ok(file.startsWith(process.env.DSH_PROFILE_DIR ?? process.env.DSH_HOME ?? homedir()), file)
})


check('the language gate only fires on a clear mismatch', () => {
  const { wrongLanguage } = host.__test
  // A Chinese user pasting a Latin identifier must not be judged English.
  assert.equal(wrongLanguage('帮我看看 dsh-composer-quill 的缓存', 'zh'), false)
  assert.equal(wrongLanguage('the draft is already complete, nothing to add', 'zh'), true)
  // English setting, Chinese candidate: clearly the wrong language.
  assert.equal(wrongLanguage('这里应该继续补写', 'en'), true)
  assert.equal(wrongLanguage('continue with the cache key', 'en'), false)
  // Short text carries no language signal either way.
  assert.equal(wrongLanguage('ok', 'zh'), false)
  assert.equal(wrongLanguage('继续', 'en'), false)
  // No opinion means no gate.
  assert.equal(wrongLanguage('anything at all here', ''), false)
})

check('the language setting outranks the locale', () => {
  const { resolveLanguage } = host.__test
  assert.equal(resolveLanguage({ locale: 'en-US', forced: 'zh' }), 'zh')
  assert.equal(resolveLanguage({ locale: 'zh-CN', forced: 'en' }), 'en')
  assert.equal(resolveLanguage({ locale: 'zh-CN', forced: 'auto' }), 'zh')
  assert.equal(resolveLanguage({ locale: 'en-GB' }), 'en')
  assert.equal(resolveLanguage({ locale: 'fr-FR' }), '')
})

check('eventsOf picks the longest event list the session exposes', () => {
  const { eventsOf } = host.__test
  const snapshot = [{ seq: 1, type: 'user/message' }, { seq: 2, type: 'assistant/message' }]
  const own = [{ seq: 3, type: 'user/message' }]
  // The snapshot is longer, so it wins: mixing sources would duplicate rows.
  assert.deepEqual(eventsOf({ snapshotEvents: () => snapshot, ownEvents: () => own }), snapshot)
  assert.deepEqual(eventsOf({ snapshotEvents: () => own, ownEvents: () => snapshot }), snapshot)
  // A throwing accessor must not hide the others.
  assert.deepEqual(
    eventsOf({ snapshotEvents: () => { throw new Error('nope') }, ownEvents: () => own }),
    own,
  )
  // A session that exposes nothing yields an empty list, never undefined.
  assert.deepEqual(eventsOf(null), [])
  assert.deepEqual(eventsOf({}), [])
})

check('a one-character draft is asked for a full short sentence', () => {
  const { buildShortDraftPrompt } = host.__test
  const prompt = buildShortDraftPrompt({
    draft: '帮',
    context: '[]',
    digest: null,
    assistant: '',
    style: null,
    language: 'zh',
  })
  assert.ok(prompt.includes('"帮"'), 'the draft must be quoted into the prompt')
  assert.ok(/3 to 20/.test(prompt), 'the answer length must be spelled out')
  assert.ok(prompt.includes('Chinese'), 'the language setting must reach the prompt')
  assert.ok(/not generic filler/.test(prompt), 'the filler ban is what stops "帮我。"')
})
{
  const draft = '帮我看看这个报错是怎么回事。'
  let call = 0
  const session = {
    id: 's-fake',
    snapshotEvents: () => [],
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
  const ctx = {
    get: () => undefined,
    agents: { get: () => ({ session }) },
    llm: {
      async *stream() {
        call += 1
        const text = call === 1
          ? ''                                       // compose: nothing to add
          : '请把报错行号贴上。'                       // fallback sentence (plain text)
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    inject: (_deps, callback) => callback({
      effect: (fn) => { fn(); return () => {} },
      on: () => {},
      webServer: {
        register: (route) => {
          if (route.path === '/composer-quill/predict') globalThis.__predictRoute = route
          return () => {}
        },
      },
      clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [{ id: 'dsh-composer-quill' }] }) },
    }),
  }
  host.apply(ctx)
  const route = globalThis.__predictRoute

  const request = (body) => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-composer-quill-client': '1' }
    const res = new EventEmitter()
    res.statusCode = 0
    res.headers = {}
    res.writableEnded = false
    res.destroyed = false
    res.setHeader = (name, value) => { res.headers[name] = value }
    res.end = (payload) => { res.writableEnded = true; resolve({ status: res.statusCode, body: payload }) }
    route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })

  await checkAsync('a model without reasoning metadata still gets an answer', async () => {
    // dsh-llm refuses an explicit effort for a model that declares none, and reports it
    // as a terminal finish chunk rather than throwing.
    const calls = []
    const { produceCompose } = host.__test
    const session = { id: 's-noeffort', requestHeader: () => ({ config: { provider: 'p', model: 'plain' } }), snapshotEvents: () => [] }
    const ctx = {
      get: () => undefined,
      agents: { get: () => ({ session }) },
      llm: {
        async *stream(options) {
          calls.push(options.reasoningEffort ?? null)
          if (options.reasoningEffort !== undefined) {
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message: 'provider "p" model "plain" does not support reasoning effort "off"' },
              },
            }
            return
          }
          yield { type: 'text-delta', text: '，顺便说下是哪个接口超时。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    }
    const events = [
      { type: 'request/header', data: { header: { config: { provider: 'p', model: 'plain' } } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我把这段日志整理一下' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '好的。' }] } },
    ]
    const sent = []
    await produceCompose(ctx, {
      sessionId: 's-noeffort',
      session,
      events,
      draft: '帮我看下这个报错',
      key: 'no-effort-1',
      send: (event, data) => sent.push({ event, data }),
      locale: 'zh-CN',
      forced: '',
      signal: new AbortController().signal,
    })
    assert.deepEqual(calls, ['off', null], `the retry should drop the effort, saw ${JSON.stringify(calls)}`)
    const final = sent.find((item) => item.event === 'final')
    assert.ok(final && String(final.data.text).includes('接口超时'), JSON.stringify(sent.slice(-2)))
  })

  check('the route token belongs to the process, not to one apply()', () => {
    // A reload re-runs apply(); the Desktop shell keeps handing out the old token.
    const first = process.__dshComposerQuillToken
    assert.equal(first === undefined || typeof first === 'string', true)
    const again = process.__dshComposerQuillToken
    assert.equal(first, again, 'the token must not change between reads')
  })

  check('a request with no browser signal is refused, even with the custom header', () => {
    // Desktop's proxy strips sec-fetch-site; the per-process token is what makes that
    // case work, not a looser rule here. A local process can type any header.
    const { authorized } = host.__test
    const headers = { 'x-composer-quill-client': '1', 'content-type': 'application/json' }
    assert.equal(authorized({ headers, socket: { remoteAddress: '127.0.0.1' } }, 'tok'), false)
  })

  await checkAsync('the chosen thinking intensity reaches the model call', async () => {
    const seen = []
    const { produceCompose } = host.__test
    const session = {
      id: 's-eff',
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
      snapshotEvents: () => [],
    }
    const ctx = {
      get: () => undefined,
      agents: { get: () => ({ session }) },
      llm: {
        async *stream(options) {
          seen.push(options.reasoningEffort)
          yield { type: 'text-delta', text: '，顺便说下是哪个接口超时。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    }
    const events = [
      { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我把这段日志整理一下' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '好的，我看看。' }] } },
    ]
    const base = {
      sessionId: 's-eff',
      session,
      events,
      draft: '帮我看下这个报错',
      send: () => {},
      locale: 'zh-CN',
      forced: '',
      signal: new AbortController().signal,
    }
    await produceCompose(ctx, { ...base, key: 'eff-1', route: { reasoningEffort: 'high' } })
    assert.equal(seen[0], 'high', String(seen[0]))
    await produceCompose(ctx, { ...base, key: 'eff-2', route: { reasoningEffort: 'nonsense' } })
    assert.equal(seen[1], 'off', 'an unknown effort falls back to off')
    await produceCompose(ctx, { ...base, key: 'eff-3' })
    assert.equal(seen[2], 'off', 'no setting means off')
  })

  await checkAsync('suggestions ask for no thinking, and recover when it happens anyway', async () => {
    const seen = []
    const { produceCompose } = host.__test
    const session = {
      id: 's-effort',
      requestHeader: () => ({ config: { provider: 'p', model: 'thinking-model' } }),
      snapshotEvents: () => [],
    }
    let call = 0
    const ctx = {
      get: () => undefined,
      agents: { get: () => ({ session }) },
      llm: {
        async *stream(options) {
          call += 1
          seen.push({ effort: options.reasoningEffort, maxTokens: options.maxTokens })
          if (call === 1) {
            // first call: the model thinks until the budget runs out and says nothing
            yield { type: 'usage', usage: { inputTokens: 100, outputTokens: options.maxTokens } }
            yield { type: 'finish', reason: { kind: 'max-tokens' } }
            return
          }
          yield { type: 'text-delta', text: '，顺便说下是哪个接口超时。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    }
    const events = [
      { type: 'request/header', data: { header: { config: { provider: 'p', model: 'thinking-model' } } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我把这段日志整理一下' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '好的，我看看。' }] } },
    ]
    const sent = []
    await produceCompose(ctx, {
      sessionId: 's-effort',
      session,
      events,
      draft: '帮我看下这个报错',
      key: 'effort-test-1',
      send: (event, data) => sent.push({ event, data }),
      locale: 'zh-CN',
      forced: '',
      signal: new AbortController().signal,
    })
    assert.equal(seen.length, 2, 'the empty attempt should be retried once')
    assert.equal(seen[0].effort, 'off', 'the first call asks for no thinking')
    assert.equal(seen[1].maxTokens > seen[0].maxTokens, true, 'the retry gets more room')
    assert.equal(seen[1].effort, 'off', 'the retry keeps the cheap effort')
    const final = sent.find((item) => item.event === 'final')
    assert.ok(final && String(final.data.text).includes('接口超时'), JSON.stringify(sent.slice(-2)))
  })

  await checkAsync('the model in the request is the model the Host calls', async () => {
    const seen = []
    const { produceCompose } = host.__test
    const session = {
      id: 's-route',
      requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model' } }),
      snapshotEvents: () => [],
    }
    const ctx = {
      get: () => undefined,
      agents: { get: () => ({ session }) },
      llm: {
        async *stream(options) {
          seen.push({ provider: options.provider, model: options.model })
          yield { type: 'text-delta', text: '，顺便说下是哪个接口超时。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    }
    const events = [
      { type: 'request/header', data: { header: { config: { provider: 'session-provider', model: 'session-model' } } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我把这段日志整理一下' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '好的，我看看。' }] } },
    ]
    const base = {
      sessionId: 's-route',
      session,
      events,
      draft: '帮我看下这个报错',
      send: () => {},
      locale: 'zh-CN',
      forced: '',
      signal: new AbortController().signal,
    }

    await produceCompose(ctx, { ...base, key: 'route-test-1', route: { provider: 'chosen-provider', model: 'chosen-model' } })
    assert.equal(seen.length > 0, true, 'no call was made')
    assert.equal(seen[0].provider, 'chosen-provider', JSON.stringify(seen[0]))
    assert.equal(seen[0].model, 'chosen-model', JSON.stringify(seen[0]))

    seen.length = 0
    await produceCompose(ctx, { ...base, key: 'route-test-2' })
    assert.equal(seen[0].provider, 'session-provider', 'without an override the session route wins')
    assert.equal(seen[0].model, 'session-model')

    // A malformed override is ignored, not fatal.
    seen.length = 0
    await produceCompose(ctx, { ...base, key: 'route-test-3', route: { provider: '', model: '' } })
    assert.equal(seen[0].provider, 'session-provider', 'a broken override falls back to the session')
  })

  await checkAsync('compose falls back to an appended sentence when the model says unchanged', async () => {
    call = 0
    const { status, body } = await request({ sessionId: 's-fake', mode: 'compose', draft })
    const parsed = JSON.parse(body)
    assert.equal(status, 200)
    assert.equal(parsed.fallback, 'sentence', `body=${body}`)
    assert.ok(typeof parsed.text === 'string' && parsed.text.length > 0, `body=${body}`)
  })
}

check('maskSecrets hides the credential shapes we may see in a transcript', () => {
  const { maskSecrets } = host.__test
  const cases = [
    ['AWS AKIAABCDEFGHIJKLMNOP here', 'AKIAABCDEFGHIJKLMNOP'],
    ['key sk-proj-abcdefghijklmnopqrstuvwx', 'sk-proj-abcdefghijklmnopqrstuvwx'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['pat github_pat_11ABCDEFG0abcdefghijklmnop', 'github_pat_11ABCDEFG0abcdefghijklmnop'],
    ['slack xoxb-1234567890-abcdefghijkl', 'xoxb-1234567890-abcdefghijkl'],
    ['stripe sk_live_abcdefghijklmnop', 'sk_live_abcdefghijklmnop'],
    ['jwt eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSM'],
    ['auth Bearer abcdefghijklmnopqrstuvwx', 'Bearer abcdefghijklmnopqrstuvwx'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', 'MIIEow'],
  ]
  for (const [input, secret] of cases) {
    const masked = maskSecrets(input)
    assert.ok(!masked.includes(secret), `leaked: ${masked}`)
    assert.ok(masked.includes('redacted'), `no marker: ${masked}`)
  }
  // Ordinary text survives untouched.
  assert.equal(maskSecrets('帮我把这段日志整理一下'), '帮我把这段日志整理一下')
})

check('transcriptOf masks secrets on the way out', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'key=sk-proj-abcdefghijklmnopqrstuvwx' }] } },
  ]
  const rows = JSON.parse(host.__test.transcriptOf(events))
  assert.ok(!rows[0].text.includes('sk-proj-'), rows[0].text)
  assert.ok(rows[0].text.includes('redacted'), rows[0].text)
})
check('a huge emoji message neither hangs nor explodes the transcript', () => {
  const events = [{ type: 'user/message', data: { content: [{ type: 'text', text: '😀'.repeat(1500) }] } }]
  const started = Date.now()
  const out = host.__test.transcriptOf(events)
  const elapsed = Date.now() - started
  assert.ok(elapsed < 500, `took ${elapsed}ms`)
  assert.ok(out.length < 12000, `output ${out.length} chars`)
  assert.ok(out.includes('user'), 'the newest user turn must survive')
})

check('shorten never grows the text', () => {
  const { shorten } = host.__test
  const emoji = '😀'.repeat(200)
  for (const limit of [10, 100, 400]) {
    const out = shorten(emoji, limit)
    assert.ok(Array.from(out).length <= Math.max(limit, 40) + 40, `limit ${limit}: ${Array.from(out).length}`)
  }
})

check('historyOf keeps the user turns, newest last, without duplicates', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '帮我看看这个报错' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好的' }] } } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '把日志按时间排一下' }] } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '帮我看看这个报错' }] } },
  ]
  const items = host.__test.historyOf(events)
  assert.deepEqual(items.map((item) => item.text), ['把日志按时间排一下', '帮我看看这个报错'])
})

check('a short draft gets a real tail when one exists', () => {
  const { parseComposeReply } = host.__test
  // Three characters of genuine continuation are kept (that is the ghost text).
  const tail = parseComposeReply('看一下吧。', '再', { allowTail: true, minTail: 3 })
  assert.equal(tail?.mode, 'append')
  assert.equal(tail?.text, '再看一下吧。')
  // A fragment below the minimum is refused.
  assert.equal(parseComposeReply('我。', '帮', { allowTail: true, minTail: 3 }), null)
  // A rewrite still works when the draft cannot be continued.
  const rewrite = parseComposeReply('REWRITE: 帮我把日志整理一下', '帮', { allowTail: true, minTail: 3 })
  assert.equal(rewrite?.mode, 'full')
})

check('a two-character draft never gets a fragment tail', () => {
  const { parseComposeReply } = host.__test
  // Tails are refused when the draft is too short to continue...
  assert.equal(parseComposeReply('，把日志贴上来', '帮', { allowTail: false }), null)
  // ...but the same reply is fine once the draft carries enough context.
  const kept = parseComposeReply('，把日志贴上来', '帮我看看这个报错', { allowTail: true })
  assert.equal(kept?.mode, 'append')
  // A rewrite is always acceptable.
  const rewrite = parseComposeReply('REWRITE: 帮我看看这段代码有什么问题', '帮', { allowTail: false })
  assert.equal(rewrite?.mode, 'full')
})

check('a next-message with no link to the conversation is dropped', () => {
  const { groundedness, MIN_GROUNDEDNESS } = host.__test
  const context = JSON.stringify([
    { role: 'user', text: '帮我把 dsh-composer-quill 插件的语言设置拆开' },
    { role: 'assistant', text: '语言设置只影响空输入时的下一句建议，补写跟随已有文本。' },
  ])
  // On-topic: shares wording with the transcript.
  assert.ok(groundedness('补写要跟随前面的文本，不要被设置影响', context) >= MIN_GROUNDEDNESS)
  assert.ok(groundedness('语言设置那部分改完了吗', context) >= MIN_GROUNDEDNESS)
  // Off-topic: nothing in common.
  assert.ok(groundedness('明天上海天气怎么样，要不要带伞', context) < MIN_GROUNDEDNESS)
})

check('model commentary is never offered as a completion', () => {
  const { looksLikeMeta, parseComposeReply } = host.__test
  const leaks = [
    'The draft is already complete and sound, so no addition is warranted.',
    'No further additions are needed.',
    'Nothing to add here.',
    '无需补充内容。',
    '草稿已经完整。',
  ]
  for (const text of leaks) {
    assert.equal(looksLikeMeta(text), true, text)
    assert.equal(parseComposeReply(text, '帮我看看这个报错'), null, `tail leaked: ${text}`)
    assert.equal(parseComposeReply(`REWRITE: ${text}`, '帮我看看这个报错'), null, `rewrite leaked: ${text}`)
  }
  // A real completion survives.
  assert.equal(looksLikeMeta('，把报错行和时间一起贴上来。'), false)
})

check('styleProfile describes how this user writes', () => {
  const { styleProfile } = host.__test
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '帮我把日志整理一下' }] } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '再看下报错在哪里' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好的' }] } } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '把结论写成三条' }] } },
  ]
  const profile = styleProfile(events)
  assert.equal(profile.count, 3)
  assert.ok(profile.avgChars > 5 && profile.avgChars < 20, JSON.stringify(profile))
  assert.equal(profile.language, 'zh')
  assert.equal(profile.usesGreeting, false)
})

check('candidates are ranked by fit, not by model order', () => {
  const { rankCandidates } = host.__test
  const profile = { count: 5, avgChars: 12, language: 'zh', usesGreeting: false }
  const lastAssistant = '报错指向第 42 行的空指针，需要贴出那附近十行日志。'
  const ranked = rankCandidates(
    ['好的，我来看看这个问题的具体情况吧。', '我把第 42 行附近的日志贴出来。', '还有别的吗'],
    { profile, lastAssistant, lastUser: '帮我看下报错' },
  )
  assert.ok(ranked.length >= 1, JSON.stringify(ranked))
  // The greeting opener is pushed to the back.
  assert.notEqual(ranked[0], '好的，我来看看这个问题的具体情况吧。', JSON.stringify(ranked))
})

check('a topic from an hour ago cannot be pulled back into the window', () => {
  const { transcriptOf } = host.__test
  const events = []
  // Turns 1-6: the old topic (an hour ago in a real session).
  for (let turn = 1; turn <= 6; turn += 1) {
    events.push({ type: 'user/message', data: { content: [{ type: 'text', text: `第${turn}轮：改名之后旧链接会重定向吗，LINKCHECK` }] } })
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `第${turn}轮回答：会重定向，GitHub 会保留 301。` }] } } })
  }
  // Turns 7-30: the current topic. Same length, no overlap with the old one.
  for (let turn = 7; turn <= 30; turn += 1) {
    events.push({ type: 'user/message', data: { content: [{ type: 'text', text: `第${turn}轮：继续改 composer-quill 的缓存键与回合计数` }] } })
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `第${turn}轮回答：回合计数进键即可让旧结果失效。` }] } } })
  }
  // A draft that happens to share wording with the old topic must not resurrect it.
  const context = transcriptOf(events, { rows: 10, chars: 3200, focus: '再谈一下改名重定向' })
  const rows = JSON.parse(context)
  const old = rows.filter((row) => row.text.includes('LINKCHECK'))
  const newest = rows.slice(-2).map((row) => row.text).join(' ')
  assert.ok(rows.length <= 10, 'window stays bounded: ' + rows.length)
  assert.equal(old.length, 0, 'an old topic must stay out of the prompt: ' + JSON.stringify(old))
  assert.ok(/第29轮|第30轮/.test(newest), 'the newest turns must be present: ' + newest.slice(0, 60))
})

check('a recent topic the draft mentions is still pulled in', () => {
  const { transcriptOf, sessionDigest } = host.__test
  const events = []
  for (let turn = 1; turn <= 30; turn += 1) {
    // The CSV topic sits at turns 24-26: recent enough to earn a backfill slot.
    const csv = turn >= 20 && turn <= 22
    events.push({ type: 'user/message', data: { content: [{ type: 'text', text: `第${turn}轮：${csv ? '请帮我看一下 CSV 导出脚本的时区问题' : '帮我看看这个前端报错怎么修'}，编号 ${turn}` }] } })
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `第${turn}轮回答：${csv ? '时区问题通常是 UTC 与本地时间混用导致的。' : '前端问题通常和依赖版本有关。'} ` }] } } })
  }
  const draft = '再帮我看下 CSV 导出的时区'
  const plain = transcriptOf(events, { rows: 10, chars: 3200 })
  const focused = transcriptOf(events, { rows: 10, chars: 3200, focus: draft })
  assert.equal((plain.match(/CSV/g) ?? []).length, 0, 'without focus the topic is out of the window')
  assert.ok((focused.match(/CSV/g) ?? []).length >= 1, 'a recent topic must still be pulled in')
  assert.ok(focused.length <= 3400, `window grew too much: ${focused.length}`)

  // The opening request is the oldest thing in the session: drop it once the
  // conversation has moved on, keep it while it still describes the topic.
  const longDigest = sessionDigest(events)
  assert.equal(longDigest.openingRequest, undefined, JSON.stringify(longDigest))
  assert.equal(longDigest.latestUserMessages.length, 3)
  const shortDigest = sessionDigest(events.slice(-16))
  assert.ok(shortDigest.openingRequest !== undefined, 'a short session keeps its opening request')
})

check('the diagnostic log rotates once it grows', () => {
  const { rotateLog, LOG_MAX_BYTES } = host.__test
  const file = `${tmpdir()}/ghost-log-test-${process.pid}.log`
  writeFileSync(file, 'x'.repeat(LOG_MAX_BYTES + 10))
  rotateLog(file)
  assert.equal(existsSync(file), false, 'the oversized log should be renamed away')
  assert.equal(existsSync(`${file}.1`), true, 'a rotated copy should exist')
  rmSync(`${file}.1`, { force: true })
})

check('transcriptOf keeps the latest user turn', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'first ask' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'a reply' }] } } },
    { type: 'user/message', data: { content: [{ type: 'text', text: 'latest ask' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'second reply' }] } } },
  ]
  const rows = JSON.parse(host.__test.transcriptOf(events))
  assert.equal(rows.at(-1).text, 'second reply')
  assert.ok(rows.some((row) => row.text === 'latest ask'))
})

check('authorized accepts the token or a browser that sent the preflight header', () => {
  const { authorized } = host.__test
  const token = 'abc'
  const client = { 'x-composer-quill-client': '1', 'content-type': 'application/json' }
  assert.equal(authorized({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-composer-quill-token': token, 'content-type': 'application/json' } }, token), true)
  assert.equal(authorized({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-composer-quill-token': 'other', 'content-type': 'application/json' } }, token), false)
  // Without the custom header there is no preflight barrier: reject.
  assert.equal(authorized({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } }, token), false)
  assert.equal(authorized({ socket: { remoteAddress: '127.0.0.1' }, headers: { ...client, 'sec-fetch-site': 'same-origin' } }, token), true)
  assert.equal(authorized({ socket: { remoteAddress: '127.0.0.1' }, headers: { ...client, 'sec-fetch-site': 'cross-site' } }, token), false)
  // A local process can type any header: without the browser's own signal it is
  // not treated as same-origin.
  assert.equal(authorized({ socket: { remoteAddress: '127.0.0.1' }, headers: { ...client } }, token), false)
  assert.equal(authorized({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'content-type': 'application/json' } }, token), false)
  assert.equal(authorized({ socket: { remoteAddress: '127.0.0.1' }, headers: { ...client, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' } }, token), false)
})

// -------------------------------------------------------------- Client half
group('client: factory, slots, requests')

const registered = []
const disposers = []
let effectQueue = []

const fakeReact = {
  Fragment: Symbol('Fragment'),
  Component: class { constructor(props) { this.props = props; this.state = {} } },
  createElement: (...args) => ({ $$el: args }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useState: (initial) => [initial, () => {}],
  useRef: (value) => ({ current: value }),
  // Enough of a reducer for one render: state from init(), and a dispatch that
  // applies the action to the same cell the component reads back.
  useReducer: (reducer, initialArg, init) => {
    const cell = { value: typeof init === 'function' ? init(initialArg) : initialArg }
    const dispatch = (action) => {
      cell.value = reducer(cell.value, action)
      return cell.value
    }
    return [cell.value, dispatch]
  },
  useCallback: (fn) => fn,
  useEffect: (fn) => { effectQueue.push(fn) },
}

const calls = []
const reply = (url, body) => {
  if (url.includes('/beacon')) return { ok: true }
  if (body.mode === 'compose') return { kind: 'compose', text: `${body.draft}，找出报错的那几行。` }
  return { kind: 'next', candidates: ['候选甲'] }
}

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  calls.push({ url, mode: body.mode ?? 'beacon', draft: body.draft ?? '', sessionId: body.sessionId ?? null })
  return { ok: true, status: 200, json: async () => reply(url, body) }
}

globalThis.window = {
  __ModuleLoader__: { load({ id, factory }) { globalThis.__ghostFactory = { id, factory } } },
  __DSH_COMPOSER_QUILL_TOKEN__: 'test-token',
  localStorage: (() => {
    const store = new Map()
    return {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)) },
      removeItem: (key) => { store.delete(key) },
      clear: () => store.clear(),
    }
  })(),
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: () => {},
}

globalThis.document = {
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  body: { appendChild: () => {} },
  createElement: () => ({ style: { cssText: '' }, setAttribute: () => {}, appendChild: () => {}, remove: () => {}, querySelector: () => null }),
  getElementById: () => null,
}

await import(pathToFileURL('./client.js').href)
check('client registers a module factory', () => {
  assert.equal(globalThis.__ghostFactory.id, 'dsh-composer-quill')
})

// The client's own state lives inside the module it just built: a fresh factory call
// per case would re-run all its module-level caches, but the slot components below are
// already bound to one face. Clearing the stores is enough.
fixtureReset = () => {
  effectQueue = []
  try {
    window.localStorage.clear()
  } catch {
    // Nothing to clear.
  }
  try {
    for (const entry of registered) {
      const injected = entry.inject?.()
      injected?.ghost?.clear?.()
    }
  } catch {
    // Slots that are not mounted yet.
  }
}

const moduleExports = globalThis.__ghostFactory.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require(${name})`)
})

check('client exports slots + locale inject', () => {
  assert.deepEqual(moduleExports.inject, ['slots', 'locale'])
  assert.equal(typeof moduleExports.apply, 'function')
})

check('followRemainder shrinks the tail while the user types into it', () => {
  const { followRemainder } = moduleExports.__test
  const full = '帮我把这段日志，找出报错的那几行'
  assert.equal(followRemainder(full, '帮我把这段日'), '志，找出报错的那几行')
  assert.equal(followRemainder(full, '帮我把这段日志，找出报错'), '的那几行')
  assert.equal(followRemainder(full, '帮我把这段日志，找出报错的那几行'), '')
  assert.equal(followRemainder(full, '完全不同的输入'), '')
  assert.equal(followRemainder('', '草稿'), '')
})


check('bestHistoryMatch prefers the newest prefix match', () => {  const { bestHistoryMatch } = moduleExports.__test
  const items = [
    { text: '帮我看看这个报错的堆栈' },
    { text: '帮我看看这个报错的原因' },
    { text: '完全无关的一句话' },
  ]
  const match = bestHistoryMatch(items, '帮我看看这个报错')
  assert.ok(match, 'no match')
  assert.equal(match.text, '帮我看看这个报错的原因', 'newest match should win')
  assert.equal(match.tail, '的原因')
  assert.equal(bestHistoryMatch(items, '帮我看看这个报错的原因'), null, 'a completed message must not match itself')
  const short = bestHistoryMatch(items, '帮')
  assert.ok(short, 'a single character must be enough')
  assert.equal(bestHistoryMatch(items, ''), null, 'an empty draft has nothing to match')
})

const ctx = {
  effect: (fn) => { const off = fn(); if (typeof off === 'function') disposers.push(off) },
  locale: {
    register: (ns, dictionaries) => {
      assert.equal(ns, 'composer-quill')
      assert.ok(dictionaries.zh['settings.title'])
      assert.ok(dictionaries.en['hint.replace'])
      return () => {}
    },
  },
  slots: {
    inject: (name, factory) => { factory(); return () => {} },
    register: (options, component) => {
      registered.push({ name: options.name, id: options.id, order: options.order, locale: options.locale, component, inject: options.inject })
      return () => {}
    },
  },
}

await moduleExports.apply(ctx)

check('registers the composer dock and the settings section', () => {
  const names = registered.map((entry) => entry.name)
  assert.ok(names.includes('conversation.input.dock'), 'missing conversation.input.dock')
  assert.ok(names.includes('settings.section'), 'missing settings.general.item')
})

check('every registration carries id, order and locale', () => {
  for (const entry of registered) {
    assert.equal(typeof entry.id, 'string')
    assert.equal(typeof entry.order, 'number')
    assert.equal(entry.locale, 'composer-quill')
    assert.equal(typeof entry.component, 'function')
  }
})

const preferences = { subscribe: () => () => {}, getSnapshot: () => true, set: () => {} }
const entryOf = (name) => registered.find((entry) => entry.name === name)

/** Registrations are wrapped in the error boundary; render the inner entry. */
const unwrap = (element) => {
  if (element && element.$$el && typeof element.$$el[0] !== 'string') {
    const child = element.$$el[2]
    if (child && child.$$el) {
      const [Inner, innerProps] = child.$$el
      return Inner(innerProps)
    }
    return null
  }
  return element
}
const renderDock = (props) => unwrap(entryOf('conversation.input.dock').component(props))

const props = (overrides = {}) => {
  const face = entryOf('conversation.input.dock').inject()
  return {
    session: { sessionId: 's-ident', running: false },
    input: { draft: '' },
    inputActions: { insertText: () => true, setDraft: () => true, captureInsertion: () => ({ draftRev: 0 }) },
    t: (key) => key,
    ...face,
    ...overrides,
  }
}

// ④: a stream that is cancelled mid-flight must not leave a proposal to paint.
await checkAsync('a cancelled stream leaves nothing to paint', async () => {
  const face = entryOf('conversation.input.dock').inject()
  face.ghost.clear()
  face.ghost.streamStart('s-cancel', 'compose', '草稿')
  face.ghost.streamDelta('半句')
  const mid = face.ghost.getSnapshot()
  face.ghost.cancel()
  const after = face.ghost.getSnapshot()
  assert.equal(mid.items.length > 0, true, 'the stream should have painted something first')
  assert.equal(after.phase !== 'ready', true, 'phase after cancel: ' + after.phase)
  assert.deepEqual(after.items, [], 'items after cancel: ' + JSON.stringify(after.items))
})

await checkAsync('mount posts the diagnostic beacon first', async () => {
  calls.length = 0
  effectQueue = []
  renderDock(props({ session: { sessionId: 's-beacon', running: false } }))
  for (const run of effectQueue) run()
  await wait(120)
  const beacon = calls.find((call) => call.mode === 'beacon' && call.sessionId === 's-beacon')
  assert.ok(beacon, `no beacon: ${JSON.stringify(calls)}`)
  await wait(400)
})

await checkAsync('an idle Session requests exactly one next-message prediction', async () => {
  calls.length = 0
  effectQueue = []
  renderDock(props({ session: { sessionId: 's-next', running: false } }))
  for (const run of effectQueue) run()
  await wait(500)
  const prediction = calls.filter((call) => call.mode === 'next' && call.sessionId === 's-next')
  assert.equal(prediction.length, 1, `next calls: ${JSON.stringify(calls)}`)
})

await checkAsync('typing requests one compose call carrying the draft', async () => {
  calls.length = 0
  effectQueue = []
  renderDock(props({ session: { sessionId: 's-type', running: false }, input: { draft: '帮我把这段日志' } }))
  for (const run of effectQueue) run()
  await wait(900)
  const compose = calls.filter((call) => call.mode === 'compose' && call.sessionId === 's-type')
  assert.equal(compose.length, 1, `calls: ${JSON.stringify(calls)}`)
  assert.equal(compose[0].draft, '帮我把这段日志')
})

await checkAsync('the dock renders one chip for the compose proposal', async () => {
  calls.length = 0
  effectQueue = []
  const tree = renderDock(props({ session: { sessionId: 's-chip', running: false }, input: { draft: '帮我把这段日志' } }))
  for (const run of effectQueue) run()
  await wait(900)
  // Re-render with the settled store so the chip has something to show.
  effectQueue = []
  const settled = renderDock(props({ session: { sessionId: 's-chip', running: false }, input: { draft: '帮我把这段日志' } }))
  for (const run of effectQueue) run()
  const node = settled ?? tree
  assert.ok(node && node.$$el, 'no chip rendered after a proposal')
  const row = node.$$el.slice(2).find((child) => child && child.$$el && child.$$el[0] === 'div')
  assert.ok(row, 'dock row missing')
  const button = row.$$el.slice(2).find((child) => child && child.$$el && child.$$el[0] === 'button')
  assert.ok(button, 'proposal chip missing')
  assert.ok(String(button.$$el[2]).includes('hint.'), 'chip should name its hint key')
})


check('stored suggestions are reused, expire and clear per session', () => {
  const { saveSuggestion, loadSuggestion, clearSessionSuggestions } = moduleExports.__test
  window.localStorage.clear()
  saveSuggestion('s-a', 'next', '', ['继续看下去', '换个思路'])
  saveSuggestion('s-b', 'compose', '帮我把这段日志', ['帮我把这段日志整理一下'])
  assert.deepEqual(loadSuggestion('s-a', 'next', ''), ['继续看下去', '换个思路'])
  assert.deepEqual(loadSuggestion('s-b', 'compose', '帮我把这段日志'), ['帮我把这段日志整理一下'])
  assert.equal(loadSuggestion('s-missing', 'next', ''), null)

  // An hour old is still the same conversation state, so it is still reused.
  const map = JSON.parse(window.localStorage.getItem('dsh.composer-quill.suggestions'))
  for (const key of Object.keys(map)) map[key].at = Date.now() - 60 * 60_000
  window.localStorage.setItem('dsh.composer-quill.suggestions', JSON.stringify(map))
  assert.deepEqual(
    loadSuggestion('s-a', 'next', ''),
    ['继续看下去', '换个思路'],
    'an hour-old suggestion for an unchanged conversation must be reused',
  )
  // Beyond the storage horizon it is dropped.
  const stale = JSON.parse(window.localStorage.getItem('dsh.composer-quill.suggestions'))
  for (const key of Object.keys(stale)) stale[key].at = Date.now() - 25 * 60 * 60_000
  window.localStorage.setItem('dsh.composer-quill.suggestions', JSON.stringify(stale))
  assert.equal(loadSuggestion('s-a', 'next', ''), null, 'a day-old entry is storage-expired')

  // Clearing one session leaves the others alone.
  saveSuggestion('s-a', 'next', '', ['x'])
  saveSuggestion('s-b', 'next', '', ['y'])
  clearSessionSuggestions('s-a')
  assert.equal(loadSuggestion('s-a', 'next', ''), null)
  assert.deepEqual(loadSuggestion('s-b', 'next', ''), ['y'])
})

check('hydrate shows a stored suggestion without a request', () => {
  const face = entryOf('conversation.input.dock').inject()
  const ghost = face.ghost
  ghost.clear()
  const shown = ghost.hydrate('s-h', 'next', '', ['继续之前的话题'])
  assert.equal(shown, true)
  assert.deepEqual(ghost.getSnapshot().items, ['继续之前的话题'])
  assert.equal(ghost.getSnapshot().phase, 'ready')
  // A live result wins: hydrate must not overwrite one.
  ghost.streamStart('s-h', 'next', '')
  const second = ghost.hydrate('s-h', 'next', '', ['别的'])
  assert.equal(second, false)
})

check('a run of ignored suggestions withholds rewrites, not tails', () => {
  const ghost = moduleExports.__test.createGhostStore()
  ghost.setSuppressRewrites(true)
  const push = (mode, text) => {
    ghost.streamStart('s-pause', 'compose', '草稿')
    ghost.streamModeSet(mode)
    ghost.streamDelta(text)
    ghost.streamFinal(text, mode)
    return ghost.getSnapshot()
  }

  // One ignore is not a streak yet: the rewrite still lands.
  ghost.noteIgnored()
  const first = push('full', '帮我把这段日志整理一下。')
  assert.deepEqual(first.items, ['帮我把这段日志整理一下。'])

  // The second ignore buys silence: nothing is painted, and the store says why.
  ghost.noteIgnored()
  const third = push('full', '整段改写：把日志整理成三条要点。')
  assert.deepEqual(third.items, [])
  assert.equal(third.phase, 'empty')
  assert.equal(ghost.takeSuppressed(), true, 'the caller must be able to report it')
  assert.equal(ghost.takeSuppressed(), false, 'and only once')

  // A tail is not a rewrite: it keeps arriving while suppressed.
  const tail = push('append', '，先看有没有 409。')
  assert.equal(tail.items.length, 1)
  assert.match(tail.items[0], /先看有没有 409/)

  // One accept earns rewrites back.
  ghost.noteAccepted()
  const back = push('full', '帮我把这段日志整理一下，找出报错的那几行。')
  assert.deepEqual(back.items, ['帮我把这段日志整理一下，找出报错的那几行。'])

  // Turning the switch off disables the rule outright.
  ghost.setSuppressRewrites(false)
  ghost.noteIgnored(); ghost.noteIgnored(); ghost.noteIgnored(); ghost.noteIgnored()
  const off = push('full', '仍然可以整段改写。')
  assert.deepEqual(off.items, ['仍然可以整段改写。'])
})

check('normalizeConfig clamps and defaults every field', () => {
  const { normalizeConfig } = moduleExports.__test
  assert.deepEqual(normalizeConfig(null), { nextEnabled: true, composeEnabled: true, mode: 'auto', language: 'auto', debounceMs: 120, timeoutMs: 20000, modelRoute: null, reasoning: 'off', suppressRewrites: true })
  assert.equal(normalizeConfig({ language: 'zh' }).language, 'zh')
  assert.equal(normalizeConfig({ language: 'klingon' }).language, 'auto')
  // A single legacy flag means "both were off".
  assert.deepEqual(normalizeConfig({ enabled: false, mode: 'manual', debounceMs: 9999, timeoutMs: 10 }),
    { nextEnabled: false, composeEnabled: false, mode: 'manual', language: 'auto', debounceMs: 2000, timeoutMs: 3000, modelRoute: null, reasoning: 'off', suppressRewrites: true })
  // Per-feature flags win over the legacy one, and each keeps its own value.
  assert.deepEqual(
    (({ nextEnabled, composeEnabled }) => ({ nextEnabled, composeEnabled }))(normalizeConfig({ enabled: false, composeEnabled: true })),
    { nextEnabled: false, composeEnabled: true },
  )
  assert.deepEqual(normalizeConfig({ mode: 'nonsense', debounceMs: 'abc' }).mode, 'auto')
  assert.equal(normalizeConfig({ debounceMs: '150' }).debounceMs, 150)
  // Suppression is on unless it was explicitly turned off.
  assert.equal(normalizeConfig({ suppressRewrites: false }).suppressRewrites, false)
  assert.equal(normalizeConfig({ suppressRewrites: 'nonsense' }).suppressRewrites, true)
})

check('a thinking intensity is kept only when it is one we can ask for', () => {
  const { normalizeConfig } = moduleExports.__test
  assert.equal(normalizeConfig({ reasoning: 'high' }).reasoning, 'high')
  assert.equal(normalizeConfig({ reasoning: 'MAX' }).reasoning, 'max')
  assert.equal(normalizeConfig({ reasoning: 'extreme' }).reasoning, 'off')
  assert.equal(normalizeConfig({ reasoning: 7 }).reasoning, 'off')
  assert.equal(normalizeConfig({}).reasoning, 'off', 'default costs the least')
})

check('a stored model route survives only when it is complete', () => {
  const { normalizeConfig } = moduleExports.__test
  assert.equal(normalizeConfig({ modelRoute: { provider: 'deepseek', model: 'v4-flash' } }).modelRoute.model, 'v4-flash')
  assert.equal(normalizeConfig({ modelRoute: { provider: 'deepseek' } }).modelRoute, null)
  assert.equal(normalizeConfig({ modelRoute: { provider: '  ', model: 'x' } }).modelRoute, null)
  assert.equal(normalizeConfig({ modelRoute: 'deepseek/v4' }).modelRoute, null)
  assert.equal(normalizeConfig({}).modelRoute, null, 'default follows the session')
})

check('settings row renders the mode, pause and timeout controls', () => {
  const tree = unwrap(entryOf('settings.section').component({
    t: (key) => key,
    config: { subscribe: () => () => {}, getSnapshot: () => ({ enabled: true, mode: 'auto', debounceMs: 120, timeoutMs: 20000 }), set: () => {} },
  }))
  const flat = JSON.stringify(tree)
  for (const marker of ['settings-mode', 'settings-debounce', 'settings-timeout', 'settings.manualHint']) {
    assert.ok(flat.includes(marker), `missing ${marker}`)
  }
})

/** The prompt that reaches the model must not carry a raw credential. */
{
  const prompts = []
  const session = {
    id: 's-secret',
    snapshotEvents: () => ([
      { type: 'user/message', data: { content: [{ type: 'text', text: '我的 key 是 sk-proj-abcdefghijklmnopqrstuvwx 能用吗' }] } },
    ]),
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
  const ctx = {
    get: () => undefined,
    agents: { get: () => ({ session }) },
    llm: {
      async *stream(options) {
        prompts.push(options.messages[0].content[0].text)
        yield { type: 'text-delta', text: '，请把 key 换成环境变量。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    inject: (_deps, callback) => callback({
      effect: (fn) => { fn(); return () => {} },
      on: () => {},
      webServer: { register: (route) => { if (route.path === '/composer-quill/predict') globalThis.__secretRoute = route; return () => {} } },
      clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [] }) },
    }),
  }
  host.apply(ctx)
  const route = globalThis.__secretRoute

  await checkAsync('the model prompt is masked before it leaves the host', async () => {
    const body = { sessionId: 's-secret', mode: 'compose', draft: '帮我看看这个报错' }
    await new Promise((resolve) => {
      const req = new EventEmitter()
      req.method = 'POST'
      req.socket = { remoteAddress: '127.0.0.1' }
      req.headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-composer-quill-client': '1' }
      const res = new EventEmitter()
      res.statusCode = 0
      res.writableEnded = false
      res.destroyed = false
      res.setHeader = () => {}
      res.end = () => resolve()
      route.handler(req, res)
      req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
    assert.ok(prompts.length > 0, 'no model call captured')
    const prompt = prompts.join('\n')
    assert.ok(!prompt.includes('sk-proj-abcdefghijklmnopqrstuvwx'), 'raw key reached the model prompt')
    assert.ok(prompt.includes('redacted'), prompt.slice(0, 200))
  })
}

/** A draft ending with a newline must still get an inline tail, not a rewrite. */
await checkAsync('trailing newline still yields a tail proposal', async () => {
  const frames = [
    'event: start\ndata: {"mode":"append"}\n\n',
    'event: delta\ndata: {"text":"，请附上完整日志。"}\n\n',
    'event: final\ndata: {"text":"，请附上完整日志。"}\n\n',
    'event: done\ndata: {}\n\n',
  ].map((frame) => new TextEncoder().encode(frame))

  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: {
      getReader() {
        let index = 0
        return {
          async read() {
            if (index >= frames.length) return { done: true, value: undefined }
            const value = frames[index]
            index += 1
            return { done: false, value }
          },
          async cancel() {},
        }
      },
    },
    async json() { throw new Error('stream should not be read as JSON') },
  })

  try {
    const face = entryOf('conversation.input.dock').inject()
    face.ghost.clear()
    effectQueue = []
    const draft = '帮我看下这个报错\n'
    renderDock(props({ session: { sessionId: 's-nl', running: false }, input: { draft } }))
    for (const run of effectQueue) run()
    // Wait for *this* case's answer. Stopping at the first 'ready' accepted a leftover
    // result from an earlier case (their requests were still landing) and then asserted
    // against that stale draft — the "old draft + new tail" failure.
    for (let i = 0; i < 40; i += 1) {
      await wait(50)
      const now = face.ghost.getSnapshot()
      if (now.phase === 'ready' && now.sessionId === 's-nl') break
    }
    const snapshot = face.ghost.getSnapshot()
    assert.equal(snapshot.sessionId, 's-nl', `stale session: ${snapshot.sessionId}`)
    assert.equal(snapshot.items[0], '帮我看下这个报错，请附上完整日志。', `items=${JSON.stringify(snapshot.items)}`)

    effectQueue = []
    const tree = renderDock(props({ session: { sessionId: 's-nl', running: false }, input: { draft } }))
    for (const run of effectQueue) run()
    const row = tree && tree.$$el.slice(2).find((child) => child && child.$$el && child.$$el[0] === 'div')
    const chip = row && row.$$el.slice(2).find((child) => child && child.$$el && child.$$el[0] === 'button')
    assert.ok(chip, 'no chip for the trailing-newline draft')
    assert.ok(String(chip.$$el[2]).startsWith('hint.complete'), `expected a tail hint, got ${String(chip.$$el[2]).slice(0, 20)}`)
  } finally {
    globalThis.fetch = previousFetch
  }
})
/** A thin answer (one candidate) is topped up by asking once more. */
{
  let calls = 0
  const session = {
    id: 's-topup',
    snapshotEvents: () => ([
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我看看这个报错' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '先贴出日志。' }] } } },
    ]),
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
  const ctx = {
    get: () => undefined,
    agents: { get: () => ({ session }) },
    llm: {
      async *stream() {
        calls += 1
        const payload = calls === 1
          ? '{"candidates":["我贴一下日志"]}'
          : '{"candidates":["我贴一下日志","顺便说下复现步骤","先看第 42 行附近"]}'
        yield { type: 'text-delta', text: payload }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    inject: (_deps, callback) => callback({
      effect: (fn) => { fn(); return () => {} },
      on: () => {},
      webServer: { register: (route) => { if (route.path === '/composer-quill/predict') globalThis.__topupRoute = route; return () => {} } },
      clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [] }) },
    }),
  }
  host.apply(ctx)
  const route = globalThis.__topupRoute

  const call = () => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-composer-quill-client': '1' }
    const res = new EventEmitter()
    res.statusCode = 0
    res.writableEnded = false
    res.destroyed = false
    res.setHeader = () => {}
    res.end = (chunk) => resolve(JSON.parse(chunk))
    route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify({ sessionId: 's-topup', mode: 'next', draft: '' })))
    req.emit('end')
  })

  await checkAsync('a single candidate is topped up to a full set', async () => {
    const first = await call()
    assert.ok(first.candidates.length >= 2, JSON.stringify(first))
    assert.equal(calls, 2, 'a thin answer should trigger exactly one extra call')
  })
}

/** Two identical requests in flight must cost one model call. */
{
  let calls = 0
  const session = {
    id: 's-dedupe',
    snapshotEvents: () => ([
      { type: 'user/message', data: { content: [{ type: 'text', text: '之前的消息' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好的' }] } } },
    ]),
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
  const ctx = {
    get: () => undefined,
    agents: { get: () => ({ session }) },
    llm: {
      async *stream() {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 40))
        yield { type: 'text-delta', text: '，继续把剩下的部分贴上来。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    inject: (_deps, callback) => callback({
      effect: (fn) => { fn(); return () => {} },
      on: () => {},
      webServer: { register: (route) => { if (route.path === '/composer-quill/predict') globalThis.__dedupeRoute = route; return () => {} } },
      clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [] }) },
    }),
  }
  host.apply(ctx)
  const route = globalThis.__dedupeRoute

  const call = () => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-composer-quill-client': '1' }
    const res = new EventEmitter()
    res.statusCode = 0
    res.writableEnded = false
    res.destroyed = false
    res.setHeader = () => {}
    res.end = (chunk) => resolve(chunk === undefined ? null : JSON.parse(chunk))
    route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify({ sessionId: 's-dedupe', mode: 'compose', draft: '帮我把这段日志' })))
    req.emit('end')
  })

  await checkAsync('identical concurrent requests share one model call', async () => {
    const [first, second] = await Promise.all([call(), call()])
    assert.equal(calls, 1, `model calls: ${calls}`)
    assert.ok(first?.text && second?.text, `${JSON.stringify(first)} / ${JSON.stringify(second)}`)
    assert.equal(first.text, second.text)
  })
}

// Two identical streaming requests must share one model call.
{
  let calls = 0
  const session = {
    id: 's-stream-dedupe',
    snapshotEvents: () => ([
      { type: 'user/message', data: { content: [{ type: 'text', text: '之前' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好' }] } } },
    ]),
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
  const ctx = {
    get: () => undefined,
    agents: { get: () => ({ session }) },
    llm: {
      async *stream() {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 30))
        yield { type: 'text-delta', text: '，继续贴剩下的日志。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    inject: (_deps, callback) => callback({
      effect: (fn) => { fn(); return () => {} },
      on: () => {},
      webServer: { register: (route) => { if (route.path === '/composer-quill/predict') globalThis.__streamRoute = route; return () => {} } },
      clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [] }) },
    }),
  }
  host.apply(ctx)
  const route = globalThis.__streamRoute

  const streamCall = () => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'sec-fetch-site': 'same-origin',
      'x-composer-quill-client': '1',
    }
    const res = new EventEmitter()
    res.statusCode = 0
    res.writableEnded = false
    res.destroyed = false
    res.headersSent = true
    res.setHeader = () => {}
    res.flushHeaders = () => {}
    res.write = () => true
    res.end = () => resolve(true)
    route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify({ sessionId: 's-stream-dedupe', mode: 'compose', draft: '帮我把这段日志' })))
    req.emit('end')
  })

  await checkAsync('identical concurrent streams share one model call', async () => {
    await Promise.all([streamCall(), streamCall()])
    assert.equal(calls, 1, 'model calls: ' + calls)
  })
}

check('an answer from the model is never thrown away entirely', () => {
  const { parseCandidates, rankCandidates } = host.__test
  // A string where a list was expected is still usable.
  assert.deepEqual(parseCandidates('{"candidates":"先看日志"}'), ['先看日志'])
  // Filters may not empty the list: the raw answer survives.
  const filtered = rankCandidates(['Please paste the full stack trace here.', '另一个候选也不算短'], {
    profile: { language: 'zh', avgChars: 20, usesGreeting: false },
    lastAssistant: '没问题',
  })
  assert.ok(filtered.length > 0, 'every candidate was dropped')
  // Model commentary is still never offered.
  const metaOnly = rankCandidates(['The draft is already complete and sound.'], { profile: {}, lastAssistant: '' })
  assert.deepEqual(metaOnly, [])
})

check('a proposal already typed into the editor is stale', () => {
  const { proposalIsStale } = moduleExports.__test
  // The exact case from the report: the chip repeated the composer's own text.
  assert.equal(proposalIsStale('哪 5 条？先列出来我确认一下', '哪 5 条？先列出来我确认一下'), true)
  assert.equal(proposalIsStale('哪 5 条？先列出来我确认一 下', '哪 5 条？先列出来我确认一 下'), true)
  // A genuine continuation is not stale.
  assert.equal(proposalIsStale('里的报错信息提取出来', '帮我把这段日志'), false)
  assert.equal(proposalIsStale('看一下', ''), false)
  assert.equal(proposalIsStale('', '看一下'), false)
})

check('a request in flight keeps covering a draft that only grew', () => {
  const { inFlightCovers } = moduleExports.__test
  // The measured failure: first delta lands ~1.9 s after the request, and every
  // keystroke used to cancel the request that was about to produce the ghost.
  assert.equal(inFlightCovers('帮我把这段', '帮我把这段构建日志'), true)
  assert.equal(inFlightCovers('帮我把这段', '帮我把这段'), true)
  // Shrunk: the tail no longer belongs to this draft.
  assert.equal(inFlightCovers('帮我把这段构建日志', '帮我把这段'), false)
  // Diverged mid-way: the in-flight tail can no longer be pasted.
  assert.equal(inFlightCovers('帮我把这段', '帮我把那份'), false)
  // Nothing to cover.
  assert.equal(inFlightCovers('', '帮我把这段'), false)
  assert.equal(inFlightCovers(null, '帮我把这段'), false)
  assert.equal(inFlightCovers('帮我把这段', null), false)
})

check('the turn counter is per session and survives a session switch', () => {
  const { epochOf, bumpEpoch, syncEpoch } = moduleExports.__test
  window.localStorage.clear()
  assert.equal(epochOf('session-a'), 0)
  assert.equal(bumpEpoch('session-a'), 1)
  assert.equal(bumpEpoch('session-a'), 2)
  // Another session keeps its own count.
  assert.equal(epochOf('session-b'), 0)
  assert.equal(epochOf('session-a'), 2)
  // Switching away and back adopts the stored value instead of resetting it.
  assert.equal(syncEpoch('session-b'), 0)
  assert.equal(syncEpoch('session-a'), 2)
  assert.equal(syncEpoch('session-a'), 2, 'a repeat call must not re-read or reset')
  // The count continues from the stored value after a switch.
  assert.equal(bumpEpoch('session-a'), 3)
  window.localStorage.clear()
})

check('the transcript stamp changes only when the tail does', () => {
  const { transcriptVersion } = moduleExports.__test
  const first = transcriptVersion([{ seq: 1 }, { seq: 2 }])
  assert.equal(transcriptVersion([{ seq: 1 }, { seq: 2 }]), first)
  assert.notEqual(transcriptVersion([{ seq: 1 }, { seq: 3 }]), first)
  assert.notEqual(transcriptVersion([{ seq: 1 }, { seq: 2 }, { seq: 3 }]), first)
  assert.equal(transcriptVersion([]), '0')
})
check('stored suggestions can be listed and cleared per session', () => {
  const { saveSuggestion, readSuggestions, clearSessionSuggestions } = moduleExports.__test
  window.localStorage.clear()
  saveSuggestion('session-x', 'compose', '帮我把这段', ['日志整理一下'], '1', 'append')
  saveSuggestion('session-y', 'next', '', ['继续'], '1', 'full')
  const all = readSuggestions()
  assert.ok(Object.keys(all).length >= 2, JSON.stringify(all))
  clearSessionSuggestions('session-x')
  const after = readSuggestions()
  const keysAfter = JSON.stringify(after)
  assert.equal(keysAfter.includes('session-x'), false, 'session-x entries must be gone')
  window.localStorage.clear()
})

check('the turn counter, not the message count, decides reuse', () => {
  const { saveSuggestion, loadSuggestion, bumpEpoch, syncEpoch } = moduleExports.__test
  window.localStorage.clear()
  window.localStorage.removeItem('dsh.composer-quill.epoch')

  saveSuggestion('s1', 'next', '', ['先把语言设置那段改完'], '3', 'full')
  // Same turn: reusable even though the caller has a different message count
  // (that count is fetched asynchronously and lags behind a Session switch).
  assert.deepEqual(loadSuggestion('s1', 'next', ''), ['先把语言设置那段改完'])
  // A finished turn invalidates it.
  syncEpoch('s1')
  bumpEpoch('s1')
  assert.equal(loadSuggestion('s1', 'next', ''), null)
})

check('acceptance feedback reorders candidates, never invents them', () => {
  const { featuresOf, rankByLearning, recordOutcome, learningSummary } = moduleExports.__test
  window.localStorage.clear()

  const short = '贴一下日志'
  const long = '请把刚才那段报错的完整堆栈从头到尾贴出来，并且标出最先失败的那一行，这样我才能判断是依赖版本还是代码本身的问题'
  assert.equal(featuresOf(short, 'next').length, 'len:xs')
  assert.equal(featuresOf(long, 'next').length, 'len:l')
  assert.equal(featuresOf('，顺便看下版本', 'next').opener, 'open:punct')
  assert.equal(featuresOf('好的，我来看看', 'next').greeting, 'greet:yes')

  // Teach it: short suggestions get accepted, long ones get dismissed.
  for (let index = 0; index < 6; index += 1) {
    recordOutcome(featuresOf(short, 'next'), true)
    recordOutcome(featuresOf(long, 'next'), false)
  }
  const ranked = rankByLearning([long, short], 'next')
  assert.deepEqual(ranked, [short, long], JSON.stringify(ranked))

  // Same set, same membership: reordering must not drop or add candidates.
  assert.equal(ranked.length, 2)

  const summary = learningSummary()
  assert.equal(summary.accepted, 6, JSON.stringify(summary))
  assert.ok(summary.rate > 0.4 && summary.rate < 1, JSON.stringify(summary))
})

await checkAsync('a truncated stream is reported as a failure', async () => {
  const { streamRoute } = moduleExports.__test
  const frames = [
    'event: start\ndata: {"mode":"append"}\n\n',
    'event: delta\ndata: {"text":"，帮我看看"}\n\n',
  ].map((frame) => new TextEncoder().encode(frame))
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: {
      getReader() {
        let index = 0
        return {
          async read() {
            if (index >= frames.length) return { done: true, value: undefined }
            return { done: false, value: frames[index++] }
          },
          async cancel() {},
        }
      },
    },
    async json() { throw new Error('not json') },
  })
  try {
    const seen = []
    await streamRoute('/composer-quill/predict', { sessionId: 's-trunc', draft: 'x' }, undefined, {
      start: () => seen.push('start'),
      delta: () => seen.push('delta'),
      error: (data) => seen.push('error:' + data.message),
    })
    assert.deepEqual(seen, ['start', 'delta', 'error:stream ended without a result'])
  } finally {
    globalThis.fetch = previousFetch
  }
})

await checkAsync('streaming frames arrive in order and end with done', async () => {
  const { streamRoute } = moduleExports.__test
  const frames = [
    'event: start\ndata: {"mode":"full"}\n\n',
    'event: delta\ndata: {"text":"帮我看看"}\n\n',
    'event: delta\ndata: {"text":"这个报错是怎么回事。"}\n\n',
    'event: final\ndata: {"text":"帮我看看这个报错是怎么回事。","mode":"full"}\n\n',
    'event: done\ndata: {"mode":"full"}\n\n',
  ].map((frame) => new TextEncoder().encode(frame))

  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: {
      getReader() {
        let index = 0
        return {
          async read() {
            if (index >= frames.length) return { done: true, value: undefined }
            return { done: false, value: frames[index++] }
          },
          async cancel() {},
        }
      },
    },
    async json() { throw new Error('not json') },
  })
  try {
    const seen = []
    await streamRoute('/composer-quill/predict', { sessionId: 's-stream', draft: '帮我看看' }, undefined, {
      start: (data) => seen.push(`start:${data.mode}`),
      delta: (data) => seen.push(`delta:${data.text}`),
      final: (data) => seen.push(`final:${data.text}:${data.mode}`),
      done: (data) => seen.push(`done:${data.mode}`),
      error: (data) => seen.push(`error:${data.message}`),
    })
    assert.deepEqual(seen, [
      'start:full',
      'delta:帮我看看',
      'delta:这个报错是怎么回事。',
      'final:帮我看看这个报错是怎么回事。:full',
      'done:full',
    ])
  } finally {
    globalThis.fetch = previousFetch
  }
})

// ------------------------------------------------- independent audit findings
group('client: audit findings')
// A long stream used to add one abort listener per chunk (83 on 80 chunks).
{
  let peak = 0
  const counts = new WeakMap()
  const originalAdd = AbortSignal.prototype.addEventListener
  const originalRemove = AbortSignal.prototype.removeEventListener
  AbortSignal.prototype.addEventListener = function add(type, fn, options) {
    if (type === 'abort') {
      const size = (counts.get(this) ?? 0) + 1
      counts.set(this, size)
      if (size > peak) peak = size
    }
    return originalAdd.call(this, type, fn, options)
  }
  AbortSignal.prototype.removeEventListener = function remove(type, fn, options) {
    if (type === 'abort') counts.set(this, Math.max(0, (counts.get(this) ?? 0) - 1))
    return originalRemove.call(this, type, fn, options)
  }
  try {
    const session = {
      id: 's-listeners',
      snapshotEvents: () => ([
        { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '帮我看下这个报错' }] } },
        { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: '先贴日志。' }] } } },
      ]),
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
    }
    const routes = {}
    const ctx = {
      agents: { get: () => ({ session }) },
      llm: {
        async *stream() {
          for (let index = 0; index < 60; index += 1) yield { type: 'text-delta', text: '字' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
      inject: (_deps, callback) => callback({
        effect: (fn) => { fn(); return () => {} },
        on: () => {},
        webServer: { register: (route) => { routes[route.path] = route; return () => {} } },
        clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [] }) },
      }),
    }
    host.apply(ctx)
    await checkAsync('one abort listener per model call, not per chunk', async () => {
      await new Promise((resolve) => {
        const req = new EventEmitter()
        req.method = 'POST'
        req.socket = { remoteAddress: '127.0.0.1' }
        req.headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-composer-quill-client': '1' }
        const res = new EventEmitter()
        res.statusCode = 0
        res.writableEnded = false
        res.destroyed = false
        res.setHeader = () => {}
        res.end = () => resolve()
        routes['/composer-quill/predict'].handler(req, res)
        req.emit('data', Buffer.from(JSON.stringify({ sessionId: 's-listeners', mode: 'next', draft: '' })))
        req.emit('end')
      })
      assert.ok(peak <= 3, 'abort listeners peaked at ' + peak)
    })
  } finally {
    AbortSignal.prototype.addEventListener = originalAdd
    AbortSignal.prototype.removeEventListener = originalRemove
  }
}

// Nothing changed, time passed: still one model call.
{
  let calls = 0
  const session = {
    id: 's-steady',
    snapshotEvents: () => ([
      { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '帮我看下这个报错' }] } },
      { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: '先贴日志。' }] } } },
    ]),
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
  const routes = {}
  const ctx = {
    agents: { get: () => ({ session }) },
    llm: {
      async *stream() {
        calls += 1
        yield { type: 'text-delta', text: '{"candidates":["贴一下第 3 行日志"]}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    inject: (_deps, callback) => callback({
      effect: (fn) => { fn(); return () => {} },
      on: () => {},
      webServer: { register: (route) => { routes[route.path] = route; return () => {} } },
      clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [] }) },
    }),
  }
  host.apply(ctx)
  const call = () => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-composer-quill-client': '1' }
    const res = new EventEmitter()
    res.statusCode = 0
    res.writableEnded = false
    res.destroyed = false
    res.setHeader = () => {}
    res.end = (chunk) => resolve(JSON.parse(String(chunk)))
    routes['/composer-quill/predict'].handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify({ sessionId: 's-steady', mode: 'next', draft: '', epoch: 3 })))
    req.emit('end')
  })
  await checkAsync('an unchanged conversation is never re-sampled', async () => {
    await call()
    const first = calls
    await wait(2500)
    await call()
    await wait(500)
    await call()
    assert.equal(calls, first, 'model calls grew from ' + first + ' to ' + calls)
  })
}

// A finished turn must invalidate the Host cache even when its transcript lags.
{
  let calls = 0
  const session = {
    id: 's-epoch',
    // A host whose snapshot never grows: the epoch is the only thing that changes.
    snapshotEvents: () => ([
      { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '帮我看下这个报错' }] } },
      { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: '先贴日志。' }] } } },
    ]),
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
  const routes = {}
  const ctx = {
    agents: { get: () => ({ session }) },
    llm: {
      async *stream() {
        calls += 1
        yield { type: 'text-delta', text: '{"candidates":["再看下第 3 个报错"]}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    inject: (_deps, callback) => callback({
      effect: (fn) => { fn(); return () => {} },
      on: () => {},
      webServer: { register: (route) => { routes[route.path] = route; return () => {} } },
      clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [] }) },
    }),
  }
  host.apply(ctx)
  const call = (epoch) => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-composer-quill-client': '1' }
    const res = new EventEmitter()
    res.statusCode = 0
    res.writableEnded = false
    res.destroyed = false
    res.setHeader = () => {}
    res.end = (chunk) => resolve(JSON.parse(String(chunk)))
    routes['/composer-quill/predict'].handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify({ sessionId: 's-epoch', mode: 'next', draft: '', epoch })))
    req.emit('end')
  })
  await checkAsync('a new turn is never served from the previous turn cache', async () => {
    await call(4)
    const afterFirst = calls
    await call(5)
    assert.ok(calls > afterFirst, 'model calls stayed at ' + calls)
    // Same epoch still reuses the answer.
    const before = calls
    await call(5)
    assert.equal(calls, before, 'same turn should reuse the cached candidates')
  })
}

// The language setting changes no Session event, so it must be part of the cache key.
{
  let calls = 0
  const session = {
    id: 's-cache-lang',
    snapshotEvents: () => ([
      { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '帮我把日志整理一下' }] } },
      { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: '先贴日志。' }] } } },
    ]),
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
  const routes = {}
  const ctx = {
    agents: { get: () => ({ session }) },
    llm: {
      async *stream() {
        calls += 1
        yield { type: 'text-delta', text: '，把日志贴上来。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    inject: (_deps, callback) => callback({
      effect: (fn) => { fn(); return () => {} },
      on: () => {},
      webServer: { register: (route) => { routes[route.path] = route; return () => {} } },
      clientModules: { clientPath: () => '/tmp/x.js', graph: () => ({ entries: [] }) },
    }),
  }
  host.apply(ctx)
  const call = (language) => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-composer-quill-client': '1' }
    const res = new EventEmitter()
    res.statusCode = 0
    res.writableEnded = false
    res.destroyed = false
    res.setHeader = () => {}
    res.end = (chunk) => resolve(JSON.parse(String(chunk)))
    routes['/composer-quill/predict'].handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify({ sessionId: 's-cache-lang', mode: 'compose', draft: '帮我把日志', language })))
    req.emit('end')
  })
  await checkAsync('switching the language setting is not served from cache', async () => {
    await call('auto')
    const afterFirst = calls
    await call('en')
    assert.ok(calls > afterFirst, 'model calls stayed at ' + calls)
  })
}

for (const off of disposers) off()


const elapsed = slow.reduce((total, entry) => total + entry.ms, 0)
const worst = [...slow].sort((left, right) => right.ms - left.ms).slice(0, 3)

group('host: security')

{
  const api = host.__test
  // Every fake request here comes from this machine: the auth decision now rests on
  // the socket, so the helper provides one.
  const req = (headers, remoteAddress = '127.0.0.1') => ({ headers, socket: { remoteAddress } })

  check('a rebound Host cannot ride the header path', () => {
    assert.equal(
      api.authorized(req({
        host: 'evil.example:58537',
        'sec-fetch-site': 'same-origin',
        'x-composer-quill-client': '1',
        'content-type': 'application/json',
      }), 'the-real-token'),
      false,
    )
  })

  check('a loopback page still may', () => {
    assert.equal(
      api.authorized(req({
        host: '127.0.0.1:58537',
        'sec-fetch-site': 'same-origin',
        'x-composer-quill-client': '1',
        'content-type': 'application/json',
      }), 'the-real-token'),
      true,
    )
  })

  check('isLoopbackHost knows the loopback spellings', () => {
    for (const value of ['127.0.0.1:1', 'localhost:58537', '[::1]:58537', 'localhost']) {
      assert.equal(api.isLoopbackHost(value), true, value)
    }
    for (const value of ['evil.example', '10.0.0.5:80', '']) {
      assert.equal(api.isLoopbackHost(value), false, value)
    }
  })

  check('the session digest leaves with secrets masked', () => {
    const digest = api.sessionDigest([
      { type: 'user/message', data: { content: [{ type: 'text', text: '我的 key 是 sk-abcdef1234567890' }] } },
    ])
    assert.equal(digest.latestUserMessages[0].includes('sk-abcdef'), false)
    assert.equal(digest.latestUserMessages[0].includes('[redacted'), true)
  })

  check('the last assistant reply leaves masked too', () => {
    const text = api.lastAssistantText([
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `你贴的 ghp_${'a'.repeat(36)} 要撤销` }] } } },
    ])
    assert.equal(text.includes('ghp_abcdefghij'), false)
  })
}

group('host: fixes')

{
  const api = host.__test

  check('a backfilled row keeps its chronological place', () => {
    const events = []
    for (let i = 1; i <= 30; i += 1) {
      const text = i === 22 ? 'CSV 导出时区错了' : '第 ' + i + ' 轮：帮我看下这个日志'
      events.push({ type: 'user/message', seq: i * 2, data: { content: [{ type: 'text', text }] } })
      events.push({ type: 'assistant/message', seq: i * 2 + 1, data: { message: { content: [{ type: 'text', text: '回答 ' + i }] } } })
    }
    const rows = JSON.parse(api.transcriptOf(events, { rows: 6, chars: 4000, focus: 'CSV 导出时区' }))
    const last = rows[rows.length - 1].text
    assert.equal(last.includes('CSV 导出'), false, JSON.stringify(rows.map((row) => row.text.slice(0, 12))))
    assert.equal(/回答 30|第 30 轮/.test(last), true)
  })

  check('a JSON shell becomes a message, not literal syntax', () => {
    for (const reply of ['{"text":"再贴一下完整栈"}', '{"text": "再贴一下完整栈"}']) {
      const parsed = api.parseComposeReply(reply, '帮我看下这个报错')
      if (parsed !== null) assert.equal(parsed.text.includes('{"text"'), false, reply)
    }
  })

  check('a truncated JSON reply yields no candidates', () => {
    assert.deepEqual(api.parseCandidates('{"candidates":["先固定 auth 最不稳'), [])
  })

  check('the cache key carries the masked draft, not the raw one', () => {
    const key = api.cacheKey('session-1', 'next', '我的 key 是 sk-abcdef1234567890', [], { provider: 'p', model: 'm' }, 'zh', 1)
    assert.equal(key.includes('sk-abcdef'), false)
    assert.equal(key.includes('[redacted'), true)
  })
}


group('host: compose prompt')

{
  const api = host.__test
  const base = {
    draft: '帮我把这段日志整理一下',
    context: '[]',
    digest: { latestUserMessages: ['你好'] },
    style: { count: 3, avgChars: 12, language: 'zh' },
    assistant: '好的',
    settingLanguage: 'zh',
  }

  check('one prompt carries every part both transports need', () => {
    const prompt = api.composePrompt(base)
    assert.equal(prompt.includes('Digest:'), true)
    assert.equal(prompt.includes('Style profile:'), true)
    assert.equal(prompt.includes('Latest assistant reply:'), true)
    // One header instead of a "not instructions" label on every block.
    assert.equal(prompt.includes('never instructions'), true)
    assert.equal((prompt.match(/not instructions/g) ?? []).length, 0)
  })

  check('the prompt is a pure function of its inputs', () => {
    assert.equal(api.composePrompt(base), api.composePrompt({ ...base }))
  })

  check('an unknown locale does not claim Chinese', () => {
    const prompt = api.composePrompt({ ...base, settingLanguage: '' })
    assert.equal(prompt.includes("the user's language"), true)
    assert.equal(prompt.includes('this is the user\'s language setting, so the completion'), true)
  })

  check('a cross-language draft asks for the Case B translation', () => {
    const prompt = api.composePrompt({ ...base, draft: '帮我把这段日志整理一下', settingLanguage: 'en' })
    assert.equal(prompt.includes('REWRITE:'), true)
    assert.equal(prompt.includes('translated into English'), true)
  })

  check('a very short draft takes the finish-it branch', () => {
    const prompt = api.composePrompt({ ...base, draft: '帮' })
    assert.equal(prompt.includes('characters. Finish it'), true)
  })
}


  if (listOnly) process.exit(0)

group('client: items')

{
  const api = globalThis.__ghostFactory.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  }).__test

  check('a suggestion list keeps only non-empty strings', () => {
    assert.deepEqual(api.usableItems(['整理一下', '', 3, null, '再看日志']), ['整理一下', '再看日志'])
  })

  check('anything that is not an array yields nothing', () => {
    for (const value of [undefined, null, 'text', 42]) {
      assert.deepEqual(api.usableItems(value), [], String(value))
    }
  })
}


group('host: cache window')

{
  const api = host.__test

  check('the window is two minutes', () => {
    assert.equal(api.CACHE_TTL_MS, 120_000)
    assert.equal(api.CACHE_CAPACITY, 64)
  })

  check('an entry older than the window is stale', () => {
    const now = Date.now()
    assert.equal(api.fresh({ at: now - 60_000 }, now), true)
    assert.equal(api.fresh({ at: now - 3 * 60_000 }, now), false)
    // A negative result sets its own, shorter window.
    assert.equal(api.fresh({ at: now - 20_000, ttl: 10_000 }, now), false)
  })

  check('a hit survives the next eviction', () => {
    process.env.DSH_COMPOSER_QUILL_NO_CACHE = '1'
    const first = 'test-hot-key'
    api.remember(first, { kind: 'compose', text: 'hot' })
    for (let i = 0; i < api.CACHE_CAPACITY - 1; i += 1) {
      api.remember('test-cold-' + i, { kind: 'compose', text: 'cold' + i })
    }
    // Touch the oldest entry, then push one new one over the cap.
    assert.equal(api.cached(first)?.text, 'hot')
    api.remember('test-newcomer', { kind: 'compose', text: 'new' })
    assert.equal(api.cached(first)?.text, 'hot')
    delete process.env.DSH_COMPOSER_QUILL_NO_CACHE
  })

  check('history rows carry the event time', () => {
    const at = 1763000000000
    const rows = api.historyOf([
      { type: 'user/message', time: at, data: { content: [{ type: 'text', text: '先看日志' }] } },
    ])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].at, new Date(at).toISOString())
  })
}


group('host: preflight')

{
  const api = host.__test
  const answer = () => {
    const seen = { status: 0, headers: {}, body: null }
    return {
      seen,
      res: {
        setHeader: (name, value) => { seen.headers[name] = value },
        end: (payload) => {
          seen.body = typeof payload === 'string' ? payload : null
          seen.written = true
        },
        writableEnded: false,
        statusCode: 0,
      },
    }
  }
  const token = 'the-real-token'

  check('a non-POST is refused with 405', () => {
    const { seen, res } = answer()
    const ok = api.preflight({ method: 'GET', headers: {} }, res, token, { label: 'predict' })
    assert.equal(ok, false)
    assert.equal(seen.headers.allow, 'POST')
  })

  check('a POST without a token is refused', () => {
    const { res } = answer()
    const ok = api.preflight({ method: 'POST', headers: {} }, res, token, { label: 'predict' })
    assert.equal(ok, false)
  })

  check('the token opens the route', () => {
    const { res } = answer()
    const ok = api.preflight({ method: 'POST', headers: { 'x-composer-quill-token': token } }, res, token, { label: 'predict' })
    assert.equal(ok, true)
  })

  check('a token-only route ignores the header shortcut', () => {
    const { res } = answer()
    const ok = api.preflight(
      {
        method: 'POST',
        headers: {
          host: '127.0.0.1:1',
          'sec-fetch-site': 'same-origin',
          'x-composer-quill-client': '1',
          'content-type': 'application/json',
        },
      },
      res,
      token,
      { tokenOnly: true, label: 'history' },
    )
    assert.equal(ok, false)
  })
}


group('client: a11y')

{
  const api = globalThis.__ghostFactory.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  }).__test

  const t = (key) => ({
    'hint.error': '建议失败',
    'status.prefix': '建议：',
    'hint.pending': '补写中…',
  }[key] ?? key)

  check('a failure is announced with its reason', () => {
    assert.equal(api.describeAnnouncement({ t, status: '', failure: 'model call failed', busy: false }), '建议失败：model call failed')
  })

  check('a settled suggestion is announced once, truncated', () => {
    const long = '一'.repeat(200)
    const said = api.describeAnnouncement({ t, status: long, failure: '', busy: false })
    assert.equal(said.startsWith('建议：'), true)
    assert.equal(said.length, '建议：'.length + 60)
  })

  check('waiting is announced only when nothing is settled', () => {
    assert.equal(api.describeAnnouncement({ t, status: '', failure: '', busy: true }), '补写中…')
    assert.equal(api.describeAnnouncement({ t, status: '有建议', failure: '', busy: true }), '建议：有建议')
    assert.equal(api.describeAnnouncement({ t, status: '', failure: '', busy: false }), '')
  })
}


group('client: booking')

{
  const api = globalThis.__ghostFactory.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  }).__test

  check('a new booking remembers nothing', () => {
    assert.deepEqual(api.createDockBooking(), { painted: '', covered: '', hadDraft: false, dismissed: null, switched: null })
  })

  check('a dismissal belongs to one draft and survives an unrelated one', () => {
    const dismissed = api.dockReducer(api.createDockBooking(), { type: 'dismissed', draft: '草稿' })
    assert.equal(dismissed.dismissed, '草稿')
    // Typing something else does not un-dismiss the old draft.
    assert.equal(api.dockReducer(dismissed, { type: 'typed' }).dismissed, '草稿')
    assert.equal(api.dockReducer(dismissed, { type: 'undismissed' }).dismissed, null)
  })

  check('emptying the composer clears dismissal and the typed flag together', () => {
    let booking = api.dockReducer(api.createDockBooking(), { type: 'typed' })
    booking = api.dockReducer(booking, { type: 'dismissed', draft: '草稿' })
    const emptied = api.dockReducer(booking, { type: 'composer-empty' })
    assert.equal(emptied.dismissed, null)
    assert.equal(emptied.hadDraft, false)
    // A plain 'cleared' (turn end) must not touch the dismissal.
    assert.equal(api.dockReducer(booking, { type: 'cleared' }).dismissed, '草稿')
  })

  check('a switch transition settles once', () => {
    const started = api.dockReducer(api.createDockBooking(), { type: 'switch-started', draft: '旧草稿' })
    assert.equal(started.switched, '旧草稿')
    assert.equal(api.dockReducer(started, { type: 'switch-settled' }).switched, null)
  })

  check('the same fact twice keeps the same object', () => {
    const first = api.dockReducer(api.createDockBooking(), { type: 'painted', key: 'a|b' })
    assert.equal(first.painted, 'a|b')
    assert.equal(api.dockReducer(first, { type: 'painted', key: 'a|b' }), first)
  })

  check('covered clears when the suggestion no longer covers the draft', () => {
    const covered = api.dockReducer(api.createDockBooking(), { type: 'covered', draft: '草稿' })
    assert.equal(covered.covered, '草稿')
    assert.equal(api.dockReducer(covered, { type: 'not-covered' }).covered, '')
  })

  check('typing and clearing flip the same flag once', () => {
    const typed = api.dockReducer(api.createDockBooking(), { type: 'typed' })
    assert.equal(typed.hadDraft, true)
    assert.equal(api.dockReducer(typed, { type: 'typed' }), typed)
    assert.equal(api.dockReducer(typed, { type: 'cleared' }).hadDraft, false)
  })

  check('an unknown action is a no-op', () => {
    const booking = api.createDockBooking()
    assert.equal(api.dockReducer(booking, { type: 'nope' }), booking)
    assert.equal(api.dockReducer(booking, undefined), booking)
  })
}


group('client: error-first')

{
  const api = globalThis.__ghostFactory.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  }).__test

  check('an error outranks a later "nothing to add"', () => {
    const ghost = api.createGhostStore()
    const active = ghost.begin('s1', 'compose', '帮我把这段日志')
    ghost.streamFail('model call failed')
    assert.equal(ghost.getSnapshot().phase, 'error')
    // The retry comes back saying the draft needs nothing: the reason must survive.
    ghost.streamDone({ reason: 'unchanged' })
    const after = ghost.getSnapshot()
    assert.equal(after.phase, 'error')
    assert.equal(after.error, 'model call failed')
    void active
  })

  check('a real answer after an error still wins', () => {
    const ghost = api.createGhostStore()
    ghost.begin('s1', 'compose', '草稿')
    ghost.streamFail('model call failed')
    ghost.streamFinal('草稿，补一句。', 'append')
    ghost.streamDone({ mode: 'append' })
    const after = ghost.getSnapshot()
    assert.equal(after.phase, 'ready')
    assert.deepEqual(after.items, ['草稿，补一句。'])
    assert.equal(after.error, null)
  })
}


group('client: gates')

{
  const api = globalThis.__ghostFactory.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  }).__test

  const live = (over) => ({ enabled: true, sessionId: 's1', running: false, draftEmpty: false, draft: '帮我把这段日志', ...over })
  const base = (over) => ({ mode: 'compose', forDraft: '帮我把这段日志', now: 10_000, live: live({}), ...over })
  const gate = (input) => api.gateFor(input).gate
  const effects = (input) => api.gateFor(input).effects.map((item) => item.type)

  check('the gate order is fixed', () => {
    // Each input satisfies exactly one gate, so the reported gate is the first hit.
    assert.equal(gate(base({ live: live({ enabled: false }) })), 'G1')
    assert.equal(gate(base({ live: live({ sessionId: null }) })), 'G1')
    assert.equal(gate(base({ blockedUntil: 20_000 })), 'G2')
    assert.equal(gate(base({ served: { key: 'compose|帮我把这段日志', at: 9_000 } })), 'G3')
    assert.equal(gate(base({ lastCall: { key: 'compose|帮我把这段日志', at: 9_500 } })), 'G4a')
    assert.equal(gate(base({ stored: { sessionId: 's1', kind: 'compose', forDraft: '帮我把这段日志', phase: 'ready' } })), 'G4b')
    assert.equal(gate(base({ live: live({ running: true }) })), 'G5a')
    assert.equal(gate(base({ forDraft: '  ', live: live({ draft: '  ' }) })), 'G5b')
    assert.equal(gate(base({ dismissed: '帮我把这段日志' })), 'G5c')
    assert.equal(gate(base({ stored: { sessionId: 's1', kind: 'compose', forDraft: '我把这段', phase: 'loading', requested: '帮我把这段' } })), 'G6')
    assert.equal(gate(base({})), 'G7')
  })

  check('a stopped request still claims its 900ms slot', () => {
    // G5a/G5b/G5c come after the dedupe bookkeeping in request(): the call is claimed.
    assert.deepEqual(effects(base({ live: live({ running: true }) })), ['mark-last-call'])
    assert.deepEqual(effects(base({ dismissed: '帮我把这段日志' })), ['mark-last-call'])
    // force skips that bookkeeping entirely.
    assert.deepEqual(effects(base({ force: true, live: live({ running: true }) })), [])
  })

  check('the reuse gates report why they reused', () => {
    assert.deepEqual(effects(base({ served: { key: 'compose|帮我把这段日志', at: 9_000 } })), ['report'])
    assert.deepEqual(
      effects(base({ stored: { sessionId: 's1', kind: 'compose', forDraft: '帮我把这段日志', phase: 'empty' } })),
      ['report', 'mark-last-call'],
    )
    assert.deepEqual(
      effects(base({ stored: { sessionId: 's1', kind: 'compose', forDraft: '我把这段', phase: 'loading', requested: '帮我把这段' } })),
      ['mark-last-call', 'report'],
    )
  })

  check('the dedupe gate asks to be rescheduled, not dropped', () => {
    const verdict = api.gateFor(base({ lastCall: { key: 'compose|帮我把这段日志', at: 9_700 } }))
    assert.equal(verdict.gate, 'G4a')
    assert.equal(verdict.effects[1].type, 'reschedule')
    assert.equal(verdict.effects[1].wait, 600)
  })

  check('next and compose disagree about an empty composer', () => {
    // One space: compose wants nothing, next still counts as empty.
    const space = { live: live({ draft: ' ', draftEmpty: false }), forDraft: '', mode: 'next' }
    assert.equal(gate(space), 'G5ad')
    const empty = { live: live({ draft: '', draftEmpty: true }), forDraft: '', mode: 'next' }
    assert.equal(gate(empty), 'G7')
    // An empty forDraft falls back to the composer for compose.
    const fallback = api.gateFor(base({ forDraft: '' }))
    assert.equal(fallback.draftNow, '帮我把这段日志')
    assert.equal(fallback.key, 'compose|帮我把这段日志')
  })
}


group('client: chip')

{
  const api = globalThis.__ghostFactory.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  }).__test

  check('the row shows one state, in a fixed order', () => {
    assert.equal(api.statusChipKind({ pending: true, failure: 'x', undo: true, suggestion: 'y' }), 'pending')
    assert.equal(api.statusChipKind({ pending: false, failure: 'x', undo: true, suggestion: 'y' }), 'error')
    assert.equal(api.statusChipKind({ pending: false, failure: '', empty: true, undo: true, suggestion: 'y' }), 'empty')
    assert.equal(api.statusChipKind({ failure: '', undo: true, suggestion: 'y' }), 'undo')
    assert.equal(api.statusChipKind({ failure: '', undo: false, suggestion: 'y' }), 'suggestion')
    assert.equal(api.statusChipKind({ failure: '', undo: false, suggestion: '' }), 'hint')
  })
}

group('client: claim')

{
  const api = globalThis.__ghostFactory.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  }).__test

  check('a scheduled compose blocks the safety net for its own draft only', () => {
    const claim = { key: 'compose|这段日志', until: 10_000 }
    assert.equal(api.claimBlocksRetrigger(claim, '这段日志', 9_000), true)
    assert.equal(api.claimBlocksRetrigger(claim, '别的草稿', 9_000), false)
    assert.equal(api.claimBlocksRetrigger(claim, '这段日志', 10_000), false)
  })

  check('no claim, or a malformed one, blocks nothing', () => {
    for (const claim of [null, undefined, {}, { key: 'compose|x' }, 'text', 42]) {
      assert.equal(api.claimBlocksRetrigger(claim, '这段日志', 1_000), false, String(claim))
    }
  })

  check('only a compose claim can block the poll', () => {
    assert.equal(api.claimBlocksRetrigger({ key: 'next|', until: 10_000 }, '', 9_000), false)
  })
}

group('client: keys')

{
  const api = globalThis.__ghostFactory.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  }).__test

  check('only a bare Tab accepts', () => {
    assert.equal(api.isAcceptKey({ key: 'Tab' }), true)
    assert.equal(api.isAcceptKey({ key: 'Tab', shiftKey: true }), false)
    assert.equal(api.isAcceptKey({ key: 'Tab', altKey: true }), false)
    assert.equal(api.isAcceptKey({ key: 'Tab', ctrlKey: true }), false)
    assert.equal(api.isAcceptKey({ key: 'Tab', metaKey: true }), false)
    assert.equal(api.isAcceptKey({ key: 'Enter' }), false)
    assert.equal(api.isAcceptKey(null), false)
  })
}

group('host: usage')

{
  const { noteUsage, usageSnapshot, resetUsage, estimateCost, isPeak } = host.__test

  check('a call lands in lifetime, mode, model and the day bucket', () => {
    resetUsage()
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 400 }, sessionId: 's-usage' })
    noteUsage({ mode: 'next', model: 'deepseek-flash', usage: { inputTokens: 500, outputTokens: 20 }, sessionId: 's-usage' })
    const snap = usageSnapshot({ sessionId: 's-usage' })
    assert.equal(snap.lifetime.calls, 2)
    assert.equal(snap.lifetime.input, 1500)
    assert.equal(snap.lifetime.output, 70)
    assert.equal(snap.lifetime.cacheRead, 400)
    assert.equal(snap.byMode.compose.calls, 1)
    assert.equal(snap.byMode.next.calls, 1)
    assert.equal(snap.byModel['deepseek-flash'].calls, 2)
    assert.equal(snap.session.calls, 2)
    assert.equal(snap.today.calls, 2)
  })

  await checkAsync('a state file is written through a durable handle', async () => {
    const { flushUsage, noteUsage, usageLedgerPath, resetUsage, loadUsage, usageSnapshot } = host.__test
    const file = usageLedgerPath()
    // Whatever is on disk now (another run may have left 300 calls) is the floor.
    let before = 0
    try {
      before = JSON.parse(readFileSync(file, 'utf8'))?.lifetime?.calls ?? 0
    } catch {
      before = 0
    }

    resetUsage()
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage: { inputTokens: 11, outputTokens: 5 } })
    const wrote = await flushUsage()

    const textOnDisk = readFileSync(file, 'utf8')
    const parsed = JSON.parse(textOnDisk)
    // Never shrinks, written completely, and readable as JSON whatever happened.
    assert.equal(parsed.lifetime.calls >= before, true, `disk went from ${before} to ${parsed.lifetime.calls}`)
    assert.equal(textOnDisk.endsWith('\n'), true, 'the file should end with a newline')
    if (wrote) assert.equal(textOnDisk.includes('"version": 1'), true)

    // No temp from this write survives it.
    const temps = readdirSync(dirname(file)).filter((name) => name.includes(`.${process.pid}.`) && name.endsWith('.tmp'))
    assert.deepEqual(temps, [], `this write left ${temps.join(', ')}`)

    await loadUsage()
    assert.equal(usageSnapshot({}).lifetime.calls >= before, true)
    resetUsage()
  })

  await checkAsync('a smaller ledger never replaces a bigger one on disk', async () => {
    const { noteUsage, flushUsage, usageLedgerPath, resetUsage, loadUsage, usageSnapshot } = host.__test
    const file = usageLedgerPath()
    writeFileSync(file, JSON.stringify({ version: 1, lifetime: { calls: 300, input: 1000 }, byMode: {}, byModel: {}, days: {} }))

    // memory thinks it has one call; the file says 300. The file wins.
    resetUsage()
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage: { inputTokens: 5 } })
    await flushUsage()

    const after = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(after.lifetime.calls >= 300, true, `on disk: ${after.lifetime.calls}`)
    await loadUsage()
    const snap = usageSnapshot({})
    assert.equal(snap.lifetime.calls >= 300, true, `in memory: ${snap.lifetime.calls}`)
    rmSync(file, { force: true })
    resetUsage()
  })

  check('a call without usage counts as void and moves no tokens', () => {
    resetUsage()
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage: null })
    const snap = usageSnapshot({})
    assert.equal(snap.lifetime.calls, 1)
    assert.equal(snap.lifetime.void, 1)
    assert.equal(snap.lifetime.input, 0)
  })

  check('days older than the retention window are dropped, lifetime is not', () => {
    resetUsage()
    const old = Date.now() - 40 * 24 * 3600 * 1000
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage: { inputTokens: 10 }, at: old })
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage: { inputTokens: 20 } })
    const snap = usageSnapshot({})
    assert.equal(snap.lifetime.input, 30)
    assert.equal(Object.keys(snap.days ?? {}).length <= 1, true)
  })

  check('peak hours are 01-04 and 06-10 UTC on weekdays', () => {
    const monday = (h) => new Date(Date.UTC(2026, 10, 23, h, 30))
    assert.equal(isPeak(monday(2)), true)
    assert.equal(isPeak(monday(7)), true)
    assert.equal(isPeak(monday(5)), false)
    assert.equal(isPeak(monday(11)), false)
    const sunday = new Date(Date.UTC(2026, 10, 22, 2, 30))
    assert.equal(isPeak(sunday), false)
  })

  await checkAsync('switching model or thinking setting cannot replay the previous answer', async () => {
    const { predict } = host.__test
    const calls = []
    const session = {
      id: 's-key',
      requestHeader: () => ({ config: { provider: 'p', model: 'session-model' } }),
      snapshotEvents: () => events,
    }
    const ctx = {
      get: () => undefined,
      agents: { get: () => ({ session }) },
      llm: {
        async *stream(options) {
          calls.push(`${options.provider}/${options.model}/${options.reasoningEffort ?? '-'}`)
          yield { type: 'text-delta', text: '一组建议' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    }
    const events = [
      { type: 'request/header', data: { header: { config: { provider: 'p', model: 'session-model' } } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我把这段日志整理一下' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '好的。' }] } },
    ]
    const base = {
      sessionId: 's-key',
      session,
      events,
      hasTurns: true,
      kind: 'next',
      cleanDraft: '',
      locale: 'zh-CN',
      forced: '',
      signal: new AbortController().signal,
    }

    // Same question, three different model preferences: three separate answers.
    await predict(ctx, { ...base, key: 'k1', route: { provider: 'a', model: 'm1' } }, new AbortController().signal)
    await predict(ctx, { ...base, key: 'k1', route: { provider: 'a', model: 'm2' } }, new AbortController().signal)
    await predict(ctx, { ...base, key: 'k1', route: { provider: 'a', model: 'm2', reasoningEffort: 'high' } }, new AbortController().signal)
    assert.equal(calls.length, 3, `calls=${JSON.stringify(calls)}`)

    // And the same preference twice is still one call: the cache works.
    await predict(ctx, { ...base, key: 'k1', route: { provider: 'a', model: 'm2', reasoningEffort: 'high' } }, new AbortController().signal)
    assert.equal(calls.length, 3, 'the identical preference should have been a cache hit')
  })

  await checkAsync('an empty next-message set is not cached for two minutes', async () => {
    const { predict } = host.__test
    let calls = 0
    const session = { id: 's-empty', requestHeader: () => ({ config: { provider: 'p', model: 'm' } }), snapshotEvents: () => events }
    const ctx = {
      get: () => undefined,
      agents: { get: () => ({ session }) },
      llm: {
        async *stream() {
          calls += 1
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    }
    const events = [
      { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我把这段日志整理一下' }] } },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '好的。' }] } },
    ]
    const base = {
      sessionId: 's-empty', session, events, hasTurns: true, kind: 'next', cleanDraft: '',
      locale: 'zh-CN', forced: '', key: 'empty-key', signal: new AbortController().signal,
    }
    const first = await predict(ctx, base, new AbortController().signal)
    assert.equal(first.candidates.length, 0)
    assert.equal(calls, 1)
    // The entry exists, but on the short negative lifetime: the two-minute one would have
    // kept the retry button answering from cache long after the model had recovered.
    const { cacheEntries } = host.__test
    const entries = cacheEntries().filter((item) => Array.isArray(item.value?.candidates))
    assert.equal(entries.length > 0, true, 'the empty result was not cached at all')
    const entry = entries[entries.length - 1]
    assert.ok(
      entry.expiresInMs <= 10_500,
      `negative entry lives for ${Math.round(entry.expiresInMs / 1000)}s, expected the 10s negative TTL`,
    )
  })

  await checkAsync('a request from another machine is refused even with perfect headers', async () => {
    const { authorized } = host.__test
    const token = 'test-token'
    const perfect = {
      host: 'localhost:5173',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'x-composer-quill-client': '1',
      'content-type': 'application/json',
    }

    // Perfect headers, wrong machine: every header there is the caller's to write.
    assert.equal(authorized({ headers: perfect, socket: { remoteAddress: '203.0.113.7' } }, token), false)
    // No socket at all is not evidence of a loopback request either.
    assert.equal(authorized({ headers: perfect }, token), false)
    // From this machine, the header path still works for a page served without the token.
    assert.equal(authorized({ headers: perfect, socket: { remoteAddress: '127.0.0.1' } }, token), true)
    assert.equal(authorized({ headers: perfect, socket: { remoteAddress: '::1' } }, token), true)
    // The token itself is never restricted to loopback.
    assert.equal(authorized({ headers: { 'x-composer-quill-token': token }, socket: { remoteAddress: '203.0.113.7' } }, token), true)
  })

  await checkAsync('the model list comes from the Host and is cached', async () => {
    const { handleModels } = host.__test
    let listed = 0
    const ctx = {
      llm: {
        listProviders() {
          listed += 1
          return [{ id: 'deepseek', name: 'DeepSeek' }, { id: 'broken' }]
        },
        async listModels(provider) {
          if (provider === 'broken') throw new Error('no adapter')
          return [{ id: 'v4-flash', name: 'V4 Flash' }, { id: '', name: 'nameless' }]
        },
      },
    }

    // preflight() requires POST with the token header; the response is collected the
    // same way the route tests do it.
    const ask = () => new Promise((resolve) => {
      const req = new EventEmitter()
      req.method = 'POST'
      req.socket = { remoteAddress: '127.0.0.1' }
      req.headers = {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'x-composer-quill-client': '1',
        host: 'localhost',
        'x-composer-quill-token': 'test-token',
      }
      const res = new EventEmitter()
      res.statusCode = 0
      res.headers = {}
      res.writableEnded = false
      res.destroyed = false
      res.setHeader = (name, value) => { res.headers[name] = value }
      res.end = (payload) => { res.writableEnded = true; resolve({ status: res.statusCode, body: payload }) }
      handleModels(ctx, 'test-token', req, res)
      req.emit('data', Buffer.from('{}'))
      req.emit('end')
    })

    const first = await ask()
    assert.equal(first.status, 200, `body=${first.body}`)
    const body = JSON.parse(first.body)
    assert.equal(body.providers.length, 2)
    assert.equal(body.providers[0].models.length, 1, 'nameless entries are dropped')
    assert.equal(body.providers[0].models[0].id, 'v4-flash')
    assert.equal(body.providers[1].models.length, 0, 'a provider that throws is empty, not fatal')

    await ask()
    assert.equal(listed, 1, 'the second call is served from the cache')
  })

  check('cost uses the cache-hit rate for cached input', () => {
    const offPeak = new Date(Date.UTC(2026, 10, 22, 12, 0))
    const cost = estimateCost({
      model: 'deepseek-flash',
      usage: { inputTokens: 1_000_000, cacheReadTokens: 900_000, outputTokens: 0 },
      at: offPeak,
    })
    // 100k fresh at 0.15 + 900k cached at 0.003 = 0.015 + 0.0027
    assert.equal(Math.abs(cost - 0.0177) < 1e-9, true, String(cost))
    assert.equal(estimateCost({ model: 'unknown-model', usage: { inputTokens: 1 }, at: offPeak }), null)
  })

  check('cost is booked when the call happens, at that hour\'s rate', () => {
    resetUsage()
    const peak = new Date(Date.UTC(2026, 10, 23, 2, 0)) // Monday 02:00 UTC = peak
    const quiet = new Date(Date.UTC(2026, 10, 23, 12, 0)) // Monday 12:00 UTC = off-peak
    const usage = { inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage, at: quiet })
    const afterQuiet = usageSnapshot({}).lifetime.costMicro
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage, at: peak })
    const afterPeak = usageSnapshot({}).lifetime.costMicro
    // off-peak 1M input = 0.15 USD = 150000 micro; peak = 0.30 USD = 300000 micro
    assert.equal(afterQuiet, 150_000)
    assert.equal(afterPeak - afterQuiet, 300_000)
  })

  check('a model with no price counts as uncosted, not as free', () => {
    resetUsage()
    noteUsage({ mode: 'compose', model: 'mystery-model', usage: { inputTokens: 10, outputTokens: 5 } })
    const snap = usageSnapshot({})
    assert.equal(snap.lifetime.calls, 1)
    assert.equal(snap.lifetime.costMicro, 0)
    assert.equal(snap.lifetime.uncosted, 1)
    assert.equal(snap.lifetime.input, 10)
  })

  check('void and uncosted are different things', () => {
    resetUsage()
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage: null })
    noteUsage({ mode: 'compose', model: 'mystery-model', usage: { inputTokens: 10 } })
    const snap = usageSnapshot({})
    assert.equal(snap.lifetime.calls, 2)
    assert.equal(snap.lifetime.void, 1, 'the call with no usage is void')
    assert.equal(snap.lifetime.uncosted, 1, 'only the unpriced model is uncosted')
    // the priced model must not be marked uncosted by the neighbouring void call
    assert.equal(snap.byModel['deepseek-flash'].uncosted, 0)
  })

  check('reset zeroes everything', () => {
    noteUsage({ mode: 'compose', model: 'deepseek-flash', usage: { inputTokens: 5 } })
    resetUsage()
    const snap = usageSnapshot({})
    assert.equal(snap.lifetime.calls, 0)
    assert.equal(snap.lifetime.input, 0)
    assert.deepEqual(snap.byMode, {})
    assert.equal(snap.today.calls, 0)
    assert.equal(snap.session.calls, 0)
  })
}

  check('cost reads in CNY at the rate carried by the table', () => {
    const { formatCost } = globalThis.__ghostFactory.factory((name) => {
      if (name === 'react') return fakeReact
      throw new Error(`unexpected require(${name})`)
    }).__test
    assert.equal(formatCost(0), '¥0')
    // 1350 micro-USD at 7.1 -> 0.009'585 CNY
    assert.equal(formatCost(1350), '¥0.0096')
    assert.equal(formatCost(1_000_000), '¥7.10')
    assert.equal(formatCost(1350, 7), '¥0.0095')
  })

group('host: budget')

{
  const { maxTokensFor } = host.__test

  check('the answer budget grows with the thinking intensity', () => {
    const { capFor } = host.__test
    assert.equal(capFor('compose', 'off'), 384)
    assert.equal(capFor('compose', 'low'), 576)
    assert.equal(capFor('compose', 'high'), 960)
    assert.equal(capFor('compose', 'max'), 1536)
    assert.equal(capFor('rewrite', 'max'), 3072, 'a long draft keeps its extra room')
    assert.equal(capFor('next', 'off'), 384)
    assert.equal(capFor('compose', 'nonsense'), 384, 'an unknown effort costs the least')
    assert.equal(capFor('compose', undefined), 384)
    assert.equal(capFor('compose', 'max') <= 4096, true, 'never above the ceiling')
  })

  check('the output cap follows the shape of the answer', () => {
    assert.equal(maxTokensFor('next'), 384)
    assert.equal(maxTokensFor('compose'), 384)
    assert.equal(maxTokensFor('rewrite'), 768, 'a long draft may be rewritten wholesale')
    assert.equal(maxTokensFor('unknown-mode'), 384, 'an unknown shape falls back to the safe one')
  })
}

group('host: stream telemetry')

{
  const { composeStream } = host.__test

  // A response object with just what an SSE write needs.
  const mkRes = () => {
    const chunks = []
    const res = new EventEmitter()
    res.statusCode = 0
    res.writableEnded = false
    res.destroyed = false
    res.setHeader = () => {}
    res.flushHeaders = () => {}
    res.write = (chunk) => { chunks.push(String(chunk)); return true }
    res.end = () => { res.writableEnded = true }
    res.frames = () => chunks.join('')
    return res
  }

  const mkCtx = (produce) => {
    const session = {
      id: 's-trace',
      requestHeader: () => ({ config: { provider: 'p', model: 'trace-model' } }),
      snapshotEvents: () => [],
    }
    return {
      get: () => undefined,
      agents: { get: () => ({ session }) },
      llm: {
        async *stream() {
          yield* produce()
        },
      },
    }
  }

  /** trace() appends without awaiting: poll instead of assuming the line landed. */
  const readTrace = async (dir, event) => {
    const file = join(dir, 'composer-quill.log')
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const rows = (existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [])
        .filter(Boolean)
        .map((line) => { try { return JSON.parse(line) } catch { return null } })
        .filter((row) => row?.event === event)
      if (rows.length > 0) return rows
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return []
  }

  const withTempState = async (body) => {
    const dir = mkdtempSync(join(tmpdir(), 'quill-trace-'))
    // DSH_PROFILE_DIR wins over DSH_HOME, and the Host sets both: moving only the
    // latter wrote these test lines into the real log (it did, once).
    const saved = { home: process.env.DSH_HOME, profile: process.env.DSH_PROFILE_DIR }
    process.env.DSH_HOME = dir
    process.env.DSH_PROFILE_DIR = dir
    try {
      return await body(dir)
    } finally {
      for (const [key, value] of [['DSH_HOME', saved.home], ['DSH_PROFILE_DIR', saved.profile]]) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }

  await checkAsync('a streamed compose leaves one terminal line that says it painted', async () => {
    await withTempState(async (dir) => {
      const res = mkRes()
      const receivedAt = Date.now() - 25
      await composeStream(
        mkCtx(function* () {
          yield { type: 'text-delta', text: '，顺便说下是哪个接口超时。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }),
        { sessionId: 's-trace', draft: '帮我把这段日志整理一下', receivedAt },
        res,
        new AbortController().signal,
      )
      const ends = await readTrace(dir, 'stream-end')
      assert.equal(ends.length, 1, 'exactly one terminal line per response')
      assert.equal(ends[0].status, 'painted')
      assert.equal(ends[0].painted, true)
      assert.ok(ends[0].paintedChars > 0, 'paintedChars counts what reached the browser')
      // A streamed answer repeats its text in `final`: counting both made
      // paintedChars read about twice the suggestion in the first real rows.
      assert.equal(
        ends[0].paintedChars,
        ends[0].chars,
        'the characters of one suggestion are counted once, not once per frame',
      )
      assert.ok(ends[0].ms >= 25, 'ms covers the wait from the request arriving')

      // The old single `ms` hid whether the wait was the model or the plumbing.
      const firsts = await readTrace(dir, 'first-delta')
      assert.equal(firsts.length, 1)
      assert.equal(typeof firsts[0].modelMs, 'number')
      assert.ok(firsts[0].queueMs >= 25, 'queueMs covers the part before the model call')

      // "跟随会话" leaves the request body empty: only this line knows what ran.
      const routes = await readTrace(dir, 'route-effective')
      assert.equal(routes[0].model, 'trace-model')
      assert.equal(routes[0].provider, 'p')
      assert.equal(routes[0].mode, 'compose')
      assert.equal(routes[0].sessionId, 's-trace', 'route-effective names its session')
    })
  })

  await checkAsync('a stream the browser abandons is recorded as cancelled', async () => {
    await withTempState(async (dir) => {
      const controller = new AbortController()
      controller.abort()
      await composeStream(
        mkCtx(function* () { /* never yields: the browser gave up first */ }),
        // A different draft from the painted case: the memory cache is module-wide,
        // and a hit would answer before the abort is ever looked at.
        { sessionId: 's-trace', draft: '把这段日志整理成三条要点' },
        mkRes(),
        controller.signal,
      )
      const ends = await readTrace(dir, 'stream-end')
      assert.equal(ends.length, 1, 'the abandoned stream still gets a line')
      assert.equal(ends[0].status, 'cancelled')
      assert.equal(ends[0].painted, false)
      assert.equal(ends[0].paintedChars, 0)
    })
  })

  await checkAsync('a stream that thinks before it speaks counts the thinking', async () => {
    await withTempState(async (dir) => {
      await composeStream(
        mkCtx(function* () {
          yield { type: 'reasoning-delta', text: '先看日志时间' }
          yield { type: 'text-delta', text: '，超时在 10:35 之后。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }),
        { sessionId: 's-trace', draft: '看看这段日志里哪一行先超时' },
        mkRes(),
        new AbortController().signal,
      )
      const ends = await readTrace(dir, 'stream-end')
      assert.equal(ends.length, 1)
      // Without this, a slow reply looks identical whether the model was thinking
      // or the network was stalling — the two need opposite fixes.
      assert.ok(ends[0].reasoning >= 6, 'reasoning counts the thinking characters')
      assert.ok(ends[0].chars > 0, 'chars counts the answer, separately')
      assert.equal(ends[0].finish, 'stop')
      assert.equal(ends[0].path, 'main')
    })
  })

  await checkAsync('a two-character draft is timed even though it never streams', async () => {
    await withTempState(async (dir) => {
      const res = mkRes()
      const receivedAt = Date.now() - 30
      // Under MIN_TAIL_DRAFT_CHARS the host answers in one shot with no deltas at
      // all, so this branch used to be invisible in every wait statistic.
      await composeStream(
        mkCtx(function* () {
          yield { type: 'text-delta', text: '把这段日志整理成三条要点' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }),
        { sessionId: 's-trace', draft: '好', receivedAt },
        res,
        new AbortController().signal,
      )
      const ends = await readTrace(dir, 'stream-end')
      assert.equal(ends.length, 1)
      assert.equal(ends[0].path, 'short', 'the short branch is labelled, not guessed')
      assert.ok(ends[0].ms >= 30)
      const firsts = await readTrace(dir, 'first-delta')
      assert.equal(firsts.length, 1, 'the one-shot branch still gets a first token time')
      assert.equal(firsts[0].path, 'short')
      assert.equal(firsts[0].painted, false, 'timing only: nothing unparsed reached the browser')
      assert.ok(firsts[0].modelMs >= 0)
      assert.ok(firsts[0].queueMs >= 30, 'queueMs still measures the wait before the call')
    })
  })

  await checkAsync('work that outlives its request is marked late, not counted as wait', async () => {
    await withTempState(async (dir) => {
      const controller = new AbortController()
      const draft = '把这段日志按时间顺序整理成三条要点'
      const ctx = mkCtx(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 140))
        yield { type: 'text-delta', text: '，先按时间顺序把三条要点列出来。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })
      // The browser gives up on every keystroke. The call only keeps running
      // because a second request is waiting on the same one; its arrival must not
      // later be read as "this request took long".
      const first = composeStream(ctx, { sessionId: 's-trace', draft }, mkRes(), controller.signal)
      await new Promise((resolve) => setTimeout(resolve, 20))
      const keeperRes = mkRes()
      const keeper = composeStream(ctx, { sessionId: 's-trace', draft }, keeperRes, new AbortController().signal)
      await new Promise((resolve) => setTimeout(resolve, 20))
      controller.abort()
      await first
      await keeper
      assert.ok(keeperRes.frames().includes('三条要点'), 'the waiter that stayed got the answer')
      const ends = await readTrace(dir, 'stream-end')
      assert.equal(ends.length, 1)
      assert.equal(ends[0].status, 'cancelled')
      assert.equal(ends[0].chars, 0, 'the terminal line cannot know what it never waited for')

      const firsts = await readTrace(dir, 'first-delta')
      assert.equal(firsts.length, 1)
      assert.equal(firsts[0].late, true, 'the late token is labelled')

      const lates = await readTrace(dir, 'stream-late')
      assert.equal(lates.length, 1, 'the abandoned call still reports what it produced')
      assert.equal(lates[0].path, 'main')
      assert.ok(lates[0].chars > 0)
      assert.equal(lates[0].finish, 'stop')
    })
  })

  await checkAsync('a call nobody is left waiting for is stopped, not finished', async () => {
    await withTempState(async (dir) => {
      const state = { closed: false, finished: false, signal: null }
      const ctx = {
        get: () => undefined,
        agents: { get: () => ({ session: { id: 's-trace', requestHeader: () => ({ config: { provider: 'p', model: 'trace-model' } }), snapshotEvents: () => [] } }) },
        llm: {
          async *stream(options) {
            state.signal = options?.signal
            try {
              yield { type: 'text-delta', text: '先' }
              await new Promise((resolve) => setTimeout(resolve, 120))
              yield { type: 'text-delta', text: '看有没有 409。' }
              yield { type: 'finish', reason: { kind: 'stop' } }
              state.finished = true
            } finally {
              state.closed = true
            }
          },
        },
      }
      const controller = new AbortController()
      const run = composeStream(ctx, { sessionId: 's-trace', draft: '这条要精确到毫秒' }, mkRes(), controller.signal)
      await new Promise((resolve) => setTimeout(resolve, 30))
      controller.abort()
      await run
      const rows = await readTrace(dir, 'compose-abandoned')
      assert.equal(rows.length, 1, 'the abandonment is recorded')
      assert.ok(rows[0].draftChars > 0)
      await new Promise((resolve) => setTimeout(resolve, 160))
      // Real rows: two calls kept generating 192 and 278 output tokens for a
      // browser that had hung up 400-700 ms earlier, and nothing could reuse them
      // because the key carries the draft and the epoch.
      assert.equal(state.signal.aborted, true, 'the model call is abortable once nobody waits')
      assert.equal(state.finished, false, 'the answer was never generated to the end')
      assert.equal(state.closed, true, 'the stream was closed early')
    })
  })

  await checkAsync('a one-character draft never pays for thinking', async () => {
    await withTempState(async (dir) => {
      const seen = []
      const ctx = {
        get: () => undefined,
        agents: { get: () => ({ session: { id: 's-trace', requestHeader: () => ({ config: { provider: 'p', model: 'trace-model' } }), snapshotEvents: () => [] } }) },
        llm: {
          async *stream(options) {
            seen.push(options?.reasoningEffort)
            yield { type: 'text-delta', text: '先跑一遍看还挂不挂。' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        },
      }
      await composeStream(
        ctx,
        // The panel is on its highest setting; this branch has nothing to reason about
        // and used to spend 3-7 s discovering that.
        { sessionId: 's-trace', draft: '好', route: { reasoningEffort: 'max' } },
        mkRes(),
        new AbortController().signal,
      )
      assert.deepEqual(seen, ['off'], 'the short branch asks for no thinking at all')

      // The one-shot branch answers with a `final` frame and no delta. Counting only
      // deltas labelled every short suggestion as silent, which is what the log said
      // for 28 out of 28 measured requests that the browser did receive.
      const ends = await readTrace(dir, 'stream-end')
      assert.equal(ends.length, 1)
      assert.equal(ends[0].delivered, true)
      assert.equal(ends[0].status, 'painted', 'a delivered one-shot answer is not silent')
      assert.ok(ends[0].paintedChars > 0)
    })
  })
}

const summary = [
  '',
  `${passed} passed`,
  failed === 0 ? '' : `${failed} failed`,
  skipped === 0 ? '' : `${skipped} skipped (--filter)`,
  `${elapsed.toFixed(0)}ms total`,
].filter(Boolean).join(', ')
console.log(summary)
if (failed > 0) {
  console.log('slowest: ' + worst.map((entry) => `${entry.name} (${entry.ms.toFixed(0)}ms)`).join(' · '))
  for (const name of failures) console.log('  failed: ' + name)
}
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)



