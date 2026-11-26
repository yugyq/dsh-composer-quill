import React from 'react'
import { createRoot } from 'react-dom/client'

const calls = []
window.__harnessCalls = calls
let composeMode = 'ok'
let composeFailures = 0
// A real model needs ~1.9 s to its first delta. The scenarios that check what the
// client does while it waits have to be able to make the fake model that slow.
let composeTiming = { first: 0, step: 220 }
window.__harnessAborts = 0

window.fetch = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : {}
  // A cancelled request is exactly what the tuning is about, so count aborts.
  if (init && init.signal && String(url).includes('compose')) {
    if (init.signal.aborted) window.__harnessAborts += 1
    else init.signal.addEventListener('abort', () => { window.__harnessAborts += 1 }, { once: true })
  }
  calls.push({ url: String(url), model: body.model ?? null, reasoning: body.reasoning ?? null, mode: body.mode ?? (String(url).includes('beacon') ? 'beacon' : String(url).includes('history') ? 'history' : 'next'), draft: body.draft ?? '', event: body.event ?? '', detail: body.detail ?? '', sessionId: body.sessionId ?? '' })
  if (String(url).includes('/composer-quill/usage')) {
    const zero = { calls: 0, void: 0, input: 0, output: 0, cacheRead: 0, costMicro: 0, uncosted: 0 }
    const snapshot = {
      lifetime: { ...zero, calls: 147, input: 118000, output: 7000, costMicro: 42000 },
      today: { ...zero, calls: 12, input: 9600, output: 600, costMicro: 3400 },
      session: { ...zero, calls: 3, input: 2400, output: 150, costMicro: 900 },
      byMode: {},
      byModel: {},
      retentionDays: 30,
      price: { asOf: '2026-11-23', currency: 'USD' },
    }
    if (body.reset === true) return { ok: true, status: 200, json: async () => ({ ok: true, ...snapshot, lifetime: zero, today: zero, session: zero }) }
    return { ok: true, status: 200, json: async () => snapshot }
  }
  if (String(url).includes('/composer-quill/models')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        providers: [
          { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'v4-flash', name: 'V4 Flash' }] },
          { id: 'local', name: 'Local', models: [{ id: 'small', name: 'Small' }] },
        ],
      }),
    }
  }
  if (String(url).includes('/composer-quill/history')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { text: '帮我把这段日志按时间排好，并标出错误行' },
          { text: '帮我把这段日志整理一下，找出报错的那几行' },
          { text: '完全无关的一句话' },
        ],
      }),
    }
  }
  if (!String(url).includes('beacon') && body.mode === 'compose') {
    if ((composeMode === 'fail-once' && composeFailures === 0) || composeMode === 'fail-always') {
      composeFailures += 1
      return { ok: false, status: 500, json: async () => ({ error: { message: 'model call failed' } }) }
    }
    const draft = String(body.draft)
    const typo = draft.includes('曰')
    const unchanged = composeMode === 'unchanged'
    // New protocol: Case A streams only the tail; Case B starts with REWRITE:.
    // 'long' returns a tail long enough to wrap past the composer box: that is the
    // shape that caught the ghost layer painting outside its editor.
    const longTail = '，并按时间顺序把每一步的耗时、失败原因和重试次数都列出来，最后给一个可以直接执行的修复步骤，再补一句风险说明；如果日志里还带着堆栈，就先把最外层调用和最先失败的那一帧标出来，其余可以折叠。'
    // 'echo' makes the tail depend on the draft, so a scenario can tell the answer
    // for this draft from the answer for the previous one — which is exactly what
    // a prefill would blur together.
    const echoTail = `，接着查「${Array.from(draft).slice(-4).join('')}」那几条 409。`
    const reply = typo
      ? 'REWRITE:\n帮我把这段日志整理一下，找出报错的那几行。'
      : unchanged ? ''
        : composeMode === 'echo' ? echoTail
          : composeMode === 'long' ? longTail
            : '，找出报错的那几行。'
    const encoder = new TextEncoder()
    const frame = (event, data) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const pieces = []
    if (unchanged) {
      pieces.push(frame('start', { mode: 'append' }))
      pieces.push(frame('done', { reason: 'unchanged' }))
    } else {
      const isRewrite = reply.startsWith('REWRITE:')
      pieces.push(frame('start', { mode: isRewrite ? 'full' : 'append' }))
      const body3 = isRewrite ? reply.replace(/^REWRITE:\s*/, '') : reply
      const step = Math.max(1, Math.ceil(body3.length / 3))
      for (let i = 0; i < body3.length; i += step) pieces.push(frame('delta', { text: body3.slice(i, i + step) }))
      pieces.push(frame('final', { text: isRewrite ? body3 : body3 }))
      pieces.push(frame('done', { mode: isRewrite ? 'full' : 'append' }))
    }
    const stream = new ReadableStream({
      async start(controller) {
        // The first frame is the long wait in a real call; the rest are cheap.
        await new Promise((resolve) => setTimeout(resolve, composeTiming.first))
        for (const piece of pieces) {
          try {
            controller.enqueue(piece)
          } catch {
            return // the client cancelled: stop producing frames
          }
          await new Promise((resolve) => setTimeout(resolve, composeTiming.step))
        }
        try {
          controller.close()
        } catch {
          // already cancelled
        }
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
  }
  let payload = { ok: true }
  if (!String(url).includes('beacon')) {
    payload = { kind: 'next', candidates: ['看一下', '把刚才那段报错的完整堆栈从头到尾贴出来，并标出最先失败的一行，这样我才好判断是版本问题还是代码本身的问题'] }
  }
  return { ok: true, status: 200, json: async () => payload }
}
window.__DSH_COMPOSER_QUILL_TOKEN__ = 'harness-token'

const labels = {
  'settings.section.model': '模型',
  'settings.model': '建议用哪个模型',
  'settings.model.follow': '跟随当前会话',
  'settings.model.loading': '读取中…',
  'settings.model.failed': '读取失败，跟随会话',
  'settings.model.empty': '没有可选的模型，跟随会话',
  'settings.reasoning': '思考强度',
  'settings.reasoning.off': '关闭（最快）',
  'settings.reasoning.low': '低',
  'settings.reasoning.high': '高',
  'settings.reasoning.max': '最高',
  'settings.reasoning.hint': '补全用不上深度思考。',
  'settings.model.hint': '下一句、补写、改写都走这里选的模型，不影响会话本身。',
  'hint.accept': '按 Tab 采纳',
  'hint.complete': '按 Tab 补全',
  'hint.replace': '按 Tab 采用改写',
  'hint.pending': '补写中…',
  'hint.error': '建议失败',
  'hint.empty': '已补写 · 无待改项',
  'hint.accepted': '已采纳',
  'hint.undo': '撤销',
  'hint.retry': '重试',
  'hint.retrying': '重试中…',
  'hint.history': '按 Tab 补全（历史）',
  'hint.position': '第 {index}/{total} 条，←/→ 切换',
  'status.prefix': '建议：',
  'settings.title': '续笔',
  'settings.description': '…',
}
const t = (key) => labels[key] ?? key

async function main() {
  let captured = null
  window.__ModuleLoader__ = { load(entry) { captured = entry } }

  await import('../../client.js')

  const mod = captured.factory((name) => (name === 'react' ? React : undefined))
  const registered = []
  const ctx = {
    effect: (fn) => { const off = fn(); return typeof off === 'function' ? off : () => {} },
    locale: { register: () => () => {} },
    slots: {
      inject: (name, factory) => { factory(); return () => {} },
      register: (options, component) => { registered.push({ options, component }); return () => {} },
    },
  }
  await mod.apply(ctx)

  const dockEntry = registered.find((entry) => entry.options.name === 'conversation.input.dock')
  const face = dockEntry.options.inject ? dockEntry.options.inject() : {}

  const editor = document.querySelector('[data-composer-input]')
  const root = createRoot(document.getElementById('dock'))

  // The settings row is registered on its own slot: mount it on demand.
  function showSettings() {
    const entry = registered.find((item) => item.options.name === 'settings.section')
    if (!entry) return false
    let host = document.getElementById('settings-host')
    if (!host) {
      host = document.createElement('div')
      host.id = 'settings-host'
      document.body.appendChild(host)
    }
    const face = entry.options.inject ? entry.options.inject() : {}
    createRoot(host).render(React.createElement(entry.component, { ...face, t }))
    return true
  }

  function render(draft, sessionId = 's-harness') {
    root.render(React.createElement(dockEntry.component, {
      session: { sessionId, running: false, blank: false },
      input: { draft },
      inputActions: {
        insertText: (text) => {
        window.__harnessInserted = text
        const next = (editor.textContent || '') + text
        editor.textContent = next
        caretToEnd()
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
        render(next)
        return true
      },
        setDraft: (text) => {
          window.__harnessSetDraft = text
          // The host really replaces the draft; the harness must too, or a scenario that
          // reads the draft back cannot tell whether the plugin worked.
          editor.textContent = text
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
          return true
        },
        captureInsertion: () => ({ draftRev: 0 }),
      },
      t,
      ...face,
    }))
  }

  function type(text) {
    editor.textContent = text
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    render(text)
  }

  /** Put the caret at the end of the editor. */
  function caretToEnd() {
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /** One keystroke: DOM text, selection, input event, and the host re-render. */
  function key(char, inputType = 'insertText') {
    const before = editor.textContent ?? ''
    const after = inputType === 'deleteContentBackward' ? before.slice(0, -1) : `${before}${char}`
    editor.textContent = after
    caretToEnd()
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: char }))
    render(after)
    return after
  }

  /** Type like a person: one character at a time with a realistic delay. */
  function typeLive(text, { delay = 90 } = {}) {
    return new Promise((resolve) => {
      const chars = [...text]
      let index = 0
      const step = () => {
        if (index >= chars.length) {
          resolve(editor.textContent ?? '')
          return
        }
        key(chars[index])
        index += 1
        setTimeout(step, delay)
      }
      step()
    })
  }

  function press(init) {
    const target = editor
    target.focus()
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  }

  const rec = {
    samples: [],
    timer: null,
    start(interval = 50) {
      this.samples = []
      const tick = () => {
        const dock = document.querySelector('[data-composer-quill="dock"]')
        const proposal = document.querySelector('[data-composer-quill="dock-suggestion"]')
        const pending = document.querySelector('[data-composer-quill="dock-pending"]')
        const hint = document.querySelector('[data-composer-quill="dock-hint"]')
        const ghost = document.querySelector('[data-composer-quill="text"]')
        this.samples.push({
          t: Math.round(performance.now()),
          draft: editor.textContent ?? '',
          dock: dock ? dock.textContent ?? '' : '',
          // The row is always present now: sample the states, not its existence.
          proposal: proposal ? proposal.textContent ?? '' : '',
          pending: Boolean(pending),
          hint: hint ? hint.textContent ?? '' : '',
          chip: proposal ? proposal.textContent ?? '' : '',
          ghost: ghost && getComputedStyle(ghost).display !== 'none' ? ghost.textContent ?? '' : '',
        })
      }
      this.timer = setInterval(tick, interval)
      tick()
    },
    stop() {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      return this.samples
    },
  }

  window.__harness = {
    type,
    render,
    typeLive,
    key,
    press,
    rec,
    calls,
    draft: () => editor.textContent ?? '',
    store: () => (face && face.ghost ? face.ghost.getSnapshot() : null),
    setSession(id) {
      render(editor.textContent ?? '', id)
    },
    /** Seed the acceptance-learning counters (plugin key) for a scenario. */
    setLearning(map) {
      window.localStorage.setItem('dsh.composer-quill.learning', JSON.stringify(map))
    },
    showSettings,
    clearSuggestions() {
      window.localStorage.removeItem('dsh.composer-quill.suggestions')
    },
    resetLearning() {
      window.localStorage.removeItem('dsh.composer-quill.learning')
    },
    setComposeMode(mode) {
      composeMode = mode
      composeFailures = 0
    },
    /** {first, step} in ms: how long the fake model takes to answer. */
    setComposeTiming(timing) {
      composeTiming = { first: Number(timing?.first ?? 0), step: Number(timing?.step ?? 220) }
    },
    aborts: () => window.__harnessAborts,
    resetMetrics() {
      window.__harnessAborts = 0
    },
    accept(shift = false) {
      editor.focus()
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }))
    },
    clickChip() {
      const chip = document.querySelector('[data-composer-quill="dock-suggestion"]')
      if (chip) chip.click()
      return Boolean(chip)
    },
    /** Presence + text of the inline ghost, sampled while a request is in flight. */
    /** Vertical alignment of the ghost against the last character's line box. */
    align() {
      const editor = document.querySelector('[data-composer-input]')
      const ghost = document.querySelector('[data-composer-quill="text"]')
      if (!editor || !ghost) return null
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      let textNode = null
      while (walker.nextNode()) {
        if (walker.currentNode.length > 0) textNode = walker.currentNode
      }
      let charRect = null
      if (textNode) {
        const probe = document.createRange()
        probe.setStart(textNode, textNode.length - 1)
        probe.setEnd(textNode, textNode.length)
        charRect = probe.getClientRects()[0] ?? null
      }
      const ghostStyle = getComputedStyle(ghost)
      const lineHeight = Number.parseFloat(ghostStyle.lineHeight) || 0
      const ghostRect = ghost.getBoundingClientRect()
      const leading = charRect && lineHeight ? Math.max(0, (lineHeight - charRect.height) / 2) : 0
      return {
        ghostTop: Math.round(ghostRect.y),
        charTop: charRect ? Math.round(charRect.y) : null,
        leading: Math.round(leading * 10) / 10,
        delta: charRect ? Math.round((ghostRect.y - (charRect.y - leading)) * 10) / 10 : null,
      }
    },
    ghostNow() {
      const text = document.querySelector('[data-composer-quill="text"]')
      return text ? { text: text.textContent, display: getComputedStyle(text).display } : null
    },
    snapshot() {
      const rect = (node) => {
        if (node === null) return null
        const r = node.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      }
      const text = document.querySelector('[data-composer-quill="text"]')
      const chip = document.querySelector('[data-composer-quill="chip"]')
      const dock = document.querySelector('[data-composer-quill="dock"]')
      const sel = window.getSelection()
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
      let caretProbe = null
      if (range) {
        const node = range.endContainer
        const offset = range.endOffset
        let probeRect = null
        if (node.nodeType === 3 && offset > 0) {
          const pr = document.createRange()
          pr.setStart(node, offset - 1)
          pr.setEnd(node, offset)
          const rects = pr.getClientRects()
          probeRect = rects.length ? rects[rects.length - 1] : null
        } else if (node.nodeType === 1) {
          const child = node.childNodes[Math.min(offset, node.childNodes.length) - 1]
          if (child && child.nodeType === 3 && child.length > 0) {
            const pr = document.createRange()
            pr.setStart(child, child.length - 1)
            pr.setEnd(child, child.length)
            const rects = pr.getClientRects()
            probeRect = rects.length ? rects[rects.length - 1] : null
          }
        }
        caretProbe = {
          nodeType: node.nodeType,
          nodeName: node.nodeName,
          offset,
          childCount: node.childNodes.length,
          collapsedRects: range.getClientRects().length,
          probe: probeRect ? { left: Math.round(probeRect.left), right: Math.round(probeRect.right), top: Math.round(probeRect.top) } : null,
        }
      }
      return {
        caretProbe,
        layers: document.querySelectorAll('[data-composer-quill="layer"]').length,
        allTexts: [...document.querySelectorAll('[data-composer-quill="text"]')].map((node) => ({ text: node.textContent, display: getComputedStyle(node).display, rect: rect(node) })),
        text: text ? { text: text.textContent, display: getComputedStyle(text).display, color: getComputedStyle(text).color, rect: rect(text) } : null,
        chip: chip ? { text: chip.textContent, rect: rect(chip) } : null,
        dock: dock ? { text: dock.textContent, rect: rect(dock) } : null,
        proposal: (() => {
          const node = document.querySelector('[data-composer-quill="dock-suggestion"]')
          return node ? { text: node.textContent, rect: rect(node) } : null
        })(),
        pendingChip: Boolean(document.querySelector('[data-composer-quill="dock-pending"]')),
        hint: (() => {
          const node = document.querySelector('[data-composer-quill="dock-hint"]')
          return node ? { text: node.textContent, rect: rect(node) } : null
        })(),
        inserted: window.__harnessInserted ?? null,
        calls: calls.map((call) => call.mode),
      }
    },  }
  render('')
  window.__harnessReady = true
}

main().catch((error) => {
  window.__harnessError = String((error && error.stack) || error)
  console.error(error)
})






