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
  // A cancelled request is exactly what the tuning is about. The client cancels by
  // dropping the response body, so the count lives on the stream (see `cancel()`);
  // an aborted signal is counted at the same place, once.
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
    // 'huge' is the shape the two-line cap used to cut with an ellipsis: a tail
    // that needs far more height than the composer shows by default.
    const hugeTail = Array.from({ length: 6 }, (_, i) => `第${i + 1}步：把这一段时间窗里的每一个请求按耗时从高到低排开，标出它属于哪个服务、有没有重试、重试了几次，并把失败的那几次的原始响应贴出来。`).join('')
    const reply = typo
      ? 'REWRITE:\n帮我把这段日志整理一下，找出报错的那几行。'
      : unchanged ? ''
        : composeMode === 'echo' ? echoTail
          : composeMode === 'long' ? longTail
            : composeMode === 'huge' ? hugeTail
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
    let counted = false
    const bumpAbort = () => {
      if (counted) return
      counted = true
      window.__harnessAborts += 1
    }
    if (init && init.signal) {
      if (init.signal.aborted) bumpAbort()
      else init.signal.addEventListener('abort', bumpAbort, { once: true })
    }
    const stream = new ReadableStream({
      // The client stopped reading before the last frame: that is a cancelled call.
      cancel: bumpAbort,
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
  'hint.keys': 'Tab 采纳 · Esc 关闭 · Ctrl+Shift+Space 手动',
  'hint.busy': '回答中 · 建议暂停',
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

  /** Unmount the dock the way a Session switch would, and report what stayed behind. */
  /** Where the visible ghost's own node sits, in screen coordinates. */
  function layerTop() {
    const layer = document.querySelector('[data-composer-quill="layer"]')
    return layer === null ? null : Number(layer.getBoundingClientRect().top.toFixed(1))
  }

  function unmountDock() {
    root.render(null)
    return document.querySelectorAll('[data-composer-quill="layer"]').length
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
  function caretToEnd(target) {
    // Re-read by default: the host replaces the field node on a pane rebuild, and a
    // caret placed on the captured one leaves the new field without a cursor.
    const node = target ?? document.querySelector('[data-composer-input]') ?? editor
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /**
   * The editor moved but the host has not caught up yet: that is the frame between
   * a keystroke and the render that follows it. Nothing here re-renders the dock,
   * so the props still describe the older draft.
   */
  function typeAhead(text) {
    editor.textContent = text
    caretToEnd()
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return editor.textContent ?? ''
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

  /** Press a key wherever the user's focus actually is, without stealing it first. */
  function pressFocused(init) {
    const target = document.activeElement ?? document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    return target === editor
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
    /**
     * The dock that a Session switch replaced still holds a reference to its layer for
     * one more effect run. Ask the layers directly: the old one must not be able to
     * paint into the composer that took its place.
     */
    staleGhost(oldText, newText) {
      const { createGhostLayer } = mod.__test
      const read = () => {
        const node = document.querySelector('[data-composer-quill="text"]')
        return node === null ? null : node.textContent
      }
      const old = createGhostLayer('s-stale-old')
      old.render({ inlineText: oldText, anchor: 'caret' })
      const afterOld = read()
      const fresh = createGhostLayer('s-stale-new')
      fresh.render({ inlineText: newText, anchor: 'caret' })
      const afterNew = read()
      old.render({ inlineText: oldText, anchor: 'caret' })
      const afterStale = read()
      return {
        afterOld,
        afterNew,
        afterStale,
        oldMounted: old.isMounted(),
        freshMounted: fresh.isMounted(),
      }
    },
    /** A layer nobody owns any more: the state that used to be impossible to close. */
    orphanLayer(text) {
      const node = document.createElement('div')
      node.setAttribute('data-composer-quill', 'layer')
      node.setAttribute('data-session', 's-orphan')
      const inner = document.createElement('div')
      inner.setAttribute('data-composer-quill', 'text')
      inner.textContent = text
      node.appendChild(inner)
      editor.appendChild(node)
      return document.querySelectorAll('[data-composer-quill="layer"]').length
    },
    layerCount() {
      return document.querySelectorAll('[data-composer-quill="layer"]').length
    },
    /**
     * Which composer a dock would paint into: its own, not "the first one in the
     * document". A dock with no chip left must not adopt a stranger's field.
     */
    composerProbe() {
      const pick = mod.__test?.composerForDock
      if (typeof pick !== 'function') return { made: false }
      const own = pick('s-harness')
      const first = document.querySelector('[data-composer-input]')
      const stranger = pick('s-nowhere-at-all')
      return {
        made: true,
        ownIsFirst: own === first,
        ownTag: own === null ? null : 'composer',
        stranger: stranger === null ? null : 'composer',
        composers: document.querySelectorAll('[data-composer-input]').length,
      }
    },
    /**
     * The stale dock's layer is still on the composer and the new dock has nothing to
     * say yet: mounting alone must take the old one away.
     */
    staleLayerSweep() {
      const make = mod.__test?.createGhostLayer
      if (typeof make !== 'function') return { made: false, layers: -1 }
      const old = make('s-old-dock')
      old.render({ inlineText: '旧会话的尾巴。', anchor: 'caret' })
      const before = document.querySelectorAll('[data-composer-quill="layer"]').length
      const fresh = make('s-new-dock')
      fresh.claim()
      return { made: true, before, layers: document.querySelectorAll('[data-composer-quill="layer"]').length }
    },
    /**
     * Two docks alive, the second one claims the screen, then the first paints again:
     * the stale one must not put its text on the composer.
     */
    layerClaimDuel(first = 'A', second = 'B') {
      const make = mod.__test?.createGhostLayer
      if (typeof make !== 'function') return { made: false, layers: -1, winner: '' }
      const before = make('s-old-dock')
      before.render({ inlineText: first, anchor: 'caret' })
      const after = make('s-new-dock')
      after.claim()
      before.render({ inlineText: first, anchor: 'caret' })
      after.render({ inlineText: second, anchor: 'caret' })
      const nodes = [...document.querySelectorAll('[data-composer-quill="layer"]')]
      const text = nodes.length === 1 ? (nodes[0].textContent ?? '') : ''
      return { made: true, layers: nodes.length, winner: text.includes(second) ? 'B' : (text.includes(first) ? 'A' : text) }
    },
    /**
     * Two docks alive at once — the shape that drew two ghosts. The second one paints
     * last, then the first paints again: whoever paints last must own the screen.
     */
    layerDuel(first = 'A', second = 'B') {
      const make = mod.__test?.createGhostLayer
      if (typeof make !== 'function') return { made: false, layers: -1, winner: '' }
      const a = make('duel-a')
      const b = make('duel-b')
      a.render({ inlineText: first, anchor: 'box' })
      b.render({ inlineText: second, anchor: 'box' })
      a.render({ inlineText: `${first}2`, anchor: 'box' })
      const layers = document.querySelectorAll('[data-composer-quill="layer"]').length
      const winner = document.querySelector('[data-composer-quill="layer"] [data-composer-quill="text"]')?.textContent ?? ''
      a.clear()
      b.clear()
      for (const node of document.querySelectorAll('[data-composer-quill="layer"]')) node.remove()
      return { made: true, layers, winner }
    },
    /**
     * Replace the composer node the way the host does on a pane rebuild. The replacement
     * sits lower on the screen, so a paint that still holds the old node shows up as a
     * ghost left behind at the old height.
     */
    swapComposer() {
      const old = document.querySelector('[data-composer-input]')
      if (old === null || old.parentElement === null) return { swapped: false }
      const before = layerTop()
      const fresh = document.createElement(old.tagName.toLowerCase())
      for (const attr of Array.from(old.attributes)) fresh.setAttribute(attr.name, attr.value)
      // Copy the draft only: the ghost lives inside the field too, and copying it would
      // make the replacement look as if the suggestion were already typed.
      fresh.textContent = Array.from(old.childNodes)
        .filter((node) => !(node.nodeType === 1 && node.hasAttribute('data-composer-quill')))
        .map((node) => node.textContent ?? '')
        .join('')
      old.replaceWith(fresh)
      // The host puts the caret back after it rebuilds the field; without that the ghost
      // has no caret to follow and would vanish for a reason that has nothing to do
      // with rebinding.
      fresh.focus()
      caretToEnd()
      // A pane rebuild throws away whatever was drawn into it, the ghost included. Only
      // a repaint can bring it back, which is the part the observer is there for.
      for (const layer of document.querySelectorAll('[data-composer-quill="layer"]')) layer.remove()
      return { swapped: true, before, composerTop: fresh.getBoundingClientRect().top }
    },
    /** Where the visible ghost sits, and what it says. */
    ghostHome() {
      const layer = document.querySelector('[data-composer-quill="layer"]')
      const node = document.querySelector('[data-composer-input]')
      if (layer === null || node === null) return { composer: true, text: null, top: null, composerTop: node.getBoundingClientRect().top }
      const text = layer.querySelector('[data-composer-quill="text"]') ?? layer
      return {
        composer: true,
        text: text === null ? null : (text.textContent ?? ''),
        top: Number(layer.getBoundingClientRect().top.toFixed(1)),
        composerTop: Number(node.getBoundingClientRect().top.toFixed(1)),
      }
    },
    layerTop,
    orphanCount() {
      return document.querySelectorAll('[data-composer-quill="layer"][data-session="s-orphan"]').length
    },
    /** Two composers in the document, focus in the second: the shape that killed shortcuts. */
    secondComposer(text) {
      let node = document.getElementById('second-composer')
      if (node === null) {
        node = document.createElement('div')
        node.id = 'second-composer'
        node.setAttribute('data-composer-input', '')
        node.setAttribute('contenteditable', 'true')
        document.body.appendChild(node)
      }
      node.textContent = text
      node.focus()
      return document.activeElement === node
    },
    /** Does a fresh layer land inside the composer that has focus? */
    layerUsesFocused() {
      const make = mod.__test?.createGhostLayer
      const second = document.getElementById('second-composer')
      if (typeof make !== 'function' || second === null) return { ok: false, why: 'missing' }
      const layer = make('focus-test')
      layer.render({ inlineText: '焦点在哪就画在哪', anchor: 'box' })
      const node = document.querySelector('[data-session="focus-test"]')
      // The layer is an overlay: it lives on <body> and positions itself over the
      // composer it belongs to. "Follows the focused composer" therefore means
      // "lands on the focused composer's rectangle", not "is a child of it".
      const a = node?.getBoundingClientRect?.() ?? null
      const b = second.getBoundingClientRect()
      const inside = a !== null && Math.abs(a.left - b.left) < 8 && Math.abs(a.top - b.top) < 8
      const why = a === null ? 'no-layer' : `layer=${Math.round(a.left)},${Math.round(a.top)} second=${Math.round(b.left)},${Math.round(b.top)}`
      layer.clear()
      if (node !== null) node.remove()
      return { ok: inside, why }
    },
    type,
    typeAhead,
    /** Put text in the DOM without telling the host, then press Tab. */
    typeSilentAccept(text) {
      editor.textContent = text
      caretToEnd()
      editor.focus()
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      return editor.textContent ?? ''
    },
    /** Put text in the DOM and press Tab in the same tick: no host render in between. */
    typeAheadAccept(text) {
      const out = typeAhead(text)
      editor.focus()
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      return out
    },
    render,
    unmountDock,
    typeLive,
    key,
    press,
    pressFocused,
    rec,
    calls,
    draft: () => editor.textContent ?? '',
    store: () => (face && face.ghost ? face.ghost.getSnapshot() : null),
    suppress: () => (face && face.ghost && face.ghost.suppressState ? face.ghost.suppressState() : null),
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
    /** What the row says and what the ghost shows, read in the same instant. */
    readGhostChip() {
      const ghost = document.querySelector('[data-composer-quill="text"]')
      const chip = document.querySelector('[data-composer-quill="dock-suggestion"]')
      return {
        draft: editor.textContent ?? '',
        ghost: ghost && getComputedStyle(ghost).display !== 'none' ? ghost.textContent ?? '' : '',
        chip: chip ? chip.textContent ?? '' : '',
      }
    },
    /**
     * Type ahead and watch what the row and the ghost say during every DOM change
     * the keystroke causes. Read at each mutation, not on a timer: the disagreement
     * only exists until the next paint, so a sampler usually misses it.
     */
    /**
     * Type ahead and read what the row and the ghost say at each frame boundary —
     * the moment before the browser paints. A mutation-level read is too early to
     * matter (both settle inside one task); a timer read is too late (it misses
     * the frame that showed the disagreement). The first callback is registered
     * before the keystroke so it runs before any repaint the keystroke schedules.
     */
    async typeAheadWatched(text) {
      const read = () => {
        const ghost = document.querySelector('[data-composer-quill="text"]')
        const chip = document.querySelector('[data-composer-quill="dock-suggestion"]')
        return {
          ghost: ghost && getComputedStyle(ghost).display !== 'none' ? ghost.textContent ?? '' : '',
          chip: chip ? chip.textContent ?? '' : '',
        }
      }
      const frames = []
      // Registered before the keystroke, so it runs before any repaint the
      // keystroke schedules in this frame: that frame is what the user sees.
      let next = new Promise((resolve) => requestAnimationFrame(() => { frames.push(read()); resolve() }))
      this.typeAhead(text)
      const atTask = read()
      for (let i = 0; i < 5; i += 1) {
        await next
        next = new Promise((resolve) => requestAnimationFrame(() => { frames.push(read()); resolve() }))
      }
      await next
      return { atTask, frames }
    },
    /** What the ghost painted and whether the composer had to grow for it. */
    ghostFit() {
      const text = document.querySelector('[data-composer-quill="text"]')
      const card = document.querySelector('.scroll')
      const chip = document.querySelector('[data-composer-quill="dock-suggestion"]')
      const painted = text === null ? '' : text.textContent ?? ''
      return {
        painted,
        chars: Array.from(painted).length,
        truncated: painted.endsWith('…'),
        cardHeight: card === null ? null : Math.round(card.getBoundingClientRect().height),
        cardMaxHeight: card === null ? null : getComputedStyle(card).maxHeight,
        chip: chip === null ? null : (chip.textContent ?? ''),
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






