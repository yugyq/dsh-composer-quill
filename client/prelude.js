// --- prelude.js — concatenated into client.js by dev/tools/build-client.mjs ---
    const React = require('react')
    const h = React.createElement

    const NS = 'composer-quill'
    const BUILD = '0.33.5'
    const ROUTE = '/composer-quill/predict'
    const BEACON = '/composer-quill/beacon'
    /** The browser's own language, used when the Host has no style profile. */
    function browserLocale() {
      try {
        return (typeof navigator !== 'undefined' && typeof navigator.language === 'string') ? navigator.language.slice(0, 24) : ''
      } catch {
        return ''
      }
    }

    const TOKEN_GLOBAL = '__DSH_COMPOSER_QUILL_TOKEN__'
    const TOKEN_HEADER = 'x-composer-quill-token'
    // Forces a CORS preflight from any other origin; the Host relies on it.
    const CLIENT_HEADER = 'x-composer-quill-client'
      const NEXT_DEBOUNCE_MS = 320
    const COMPOSE_DEBOUNCE_MS = 120
    // Consecutive suggestions ignored before rewrites are withheld. Three is the
    // point where the user is clearly not reading them; one accept restores them.
    const IGNORE_STREAK_LIMIT = 2
/** While the draft stays inside the on-screen proposal, wait this long. */
const COVERED_DEBOUNCE_MS = 1200
    /**
     * Safety-net poll for the composer DOM. It has to be slower than the model's
     * first delta (measured median ~1.9 s): firing sooner only cancels the request
     * that was about to paint the ghost. At 700 ms a third of all requests died.
     */
    const RETRIGGER_INTERVAL_MS = 3000
    const MIN_DRAFT_CHARS = 1
    const CLIENT_TIMEOUT_MS = 20000
    /** A stored answer older than this is not worth reusing. */
    const SERVED_TTL_MS = 5000
    /** Two triggers for the same draft inside this window share one call. */
    const DEDUPE_MS = 900

    const zh = {
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
      'hint.keys': 'Tab 采纳 · Esc 关闭 · Ctrl+Shift+Space 手动',
      'hint.busy': '回答中 · 建议暂停',
      'hint.history': '按 Tab 补全（历史）',
      'hint.position': '第 {index}/{total} 条，←/→ 切换',
      'status.prefix': '建议：',
      'nav': '续笔',
      'settings.title': '续笔',
      'settings.description': '回合结束后预测下一句，打字时补写并顺带整理草稿；Tab 采用，发送还是你自己按',
      'settings.section.capability': '能力',
      'settings.section.behaviour': '行为',
      'settings.section.pace': '节奏',
      'settings.section.keys': '键盘',
      'settings.section.learning': '学习',
      'settings.section.usage': '消耗',
  'settings.section.model': '模型',
  'settings.model': '建议用哪个模型',
  'settings.model.follow': '跟随当前会话',
  'settings.model.loading': '读取中…',
  'settings.model.failed': '读取失败，跟随会话',
  'settings.model.empty': '没有可选的模型，跟随会话',
  'settings.model.hint': '下一句、补写、改写都走这里选的模型，不影响会话本身。',
  'settings.reasoning': '思考强度',
  'settings.reasoning.off': '关闭（最快）',
  'settings.reasoning.low': '低',
  'settings.reasoning.high': '高',
  'settings.reasoning.max': '最高',
  'settings.reasoning.hint': '补全用不上深度思考；调高会更慢、更贵，但复杂改写可能更准。',
  'settings.suppress': '忽略两次后暂停整段改写',
  'settings.suppress.hint': '连续忽略两条建议后，只保留在句尾接着写；整段改写暂停，采纳一次即恢复。',
      'usage.today': '今天',
      'usage.session': '本会话',
      'usage.lifetime': '累计',
      'usage.uncosted': '未计价',
      'usage.price': '按价目',
      'usage.holidayNote': '节假日按工作日计价',
      'usage.reset': '重置累计',
      'usage.loading': '读取中…',
      'usage.failed': '读取失败',
      'settings.next': '下一句',
      'settings.compose': '补写',
      'settings.mode': '模式',
      'settings.mode.auto': '自动',
      'settings.mode.manual': '仅手动',
      'settings.debounce': '停顿（毫秒）',
      'settings.timeout': '超时（毫秒）',
      'settings.language': '语言',
      'settings.language.auto': '跟随系统',
      'settings.learning': '采纳反馈',
      'settings.learningEmpty': '还没有样本（Tab 采纳 / Esc 忽略都会计入）',
      'settings.manualHint': '手动触发：Ctrl+Shift+Space',
    }
    const en = {
      'hint.accept': 'Press Tab to accept',
      'hint.complete': 'Press Tab to complete',
      'hint.replace': 'Press Tab to use the rewrite',
      'hint.pending': 'Composing…',
      'hint.error': 'Suggestion failed',
      'hint.empty': 'Nothing to change',
      'hint.accepted': 'Applied',
      'hint.undo': 'Undo',
      'hint.retry': 'Retry',
      'hint.retrying': 'Retrying…',
      'hint.keys': 'Tab accepts · Esc dismisses · Ctrl+Shift+Space manually',
      'hint.busy': 'Replying · suggestions paused',
      'hint.history': 'Press Tab to complete from history',
      'hint.position': 'Suggestion {index}/{total}, ←/→ to switch',
      'status.prefix': 'Completion: ',
      'nav': 'Quill',
      'settings.title': 'Quill — composer completion',
      'settings.description': 'Predicts your next message, and finishes plus tidies the draft while you type; Tab applies; you still press send',
      'settings.section.capability': 'Capabilities',
      'settings.section.behaviour': 'Behaviour',
      'settings.section.pace': 'Timing',
      'settings.section.keys': 'Keyboard',
      'settings.section.learning': 'Learning',
      'settings.section.usage': 'Usage',
  'settings.section.model': 'Model',
  'settings.model': 'Model for suggestions',
  'settings.model.follow': 'Follow the current session',
  'settings.model.loading': 'Loading…',
  'settings.model.failed': 'Could not load; following the session',
  'settings.model.empty': 'No models offered; following the session',
  'settings.model.hint': 'Next message, completion and rewrite all use this model. The session is untouched.',
  'settings.reasoning': 'Thinking',
  'settings.reasoning.off': 'Off (fastest)',
  'settings.reasoning.low': 'Low',
  'settings.reasoning.high': 'High',
  'settings.reasoning.max': 'Max',
  'settings.reasoning.hint': 'Completions rarely need deep thinking; higher is slower and dearer, though a tangled rewrite may land better.',
  'settings.suppress': 'Pause rewrites after two ignores',
  'settings.suppress.hint': 'After two suggestions in a row go unused, only tails keep arriving; rewrites stay off until one is accepted.',
      'usage.today': 'Today',
      'usage.session': 'This Session',
      'usage.lifetime': 'Lifetime',
      'usage.uncosted': 'Not priced',
      'usage.price': 'Priced',
      'usage.holidayNote': 'holidays billed as weekdays',
      'usage.reset': 'Reset',
      'usage.loading': 'Loading…',
      'usage.failed': 'Load failed',
      'settings.next': 'Next message',
      'settings.compose': 'Completion',
      'settings.mode': 'Mode',
      'settings.mode.auto': 'Automatic',
      'settings.mode.manual': 'Manual only',
      'settings.debounce': 'Pause (ms)',
      'settings.timeout': 'Timeout (ms)',
      'settings.language': 'Language',
      'settings.language.auto': 'Follow system',
      'settings.learning': 'Acceptance feedback',
      'settings.learningEmpty': 'no samples yet (Tab accepts, Esc dismisses)',
      'settings.manualHint': 'Trigger manually: Ctrl+Shift+Space',
    }

    /**
     * The page token is injected into the document the Host serves. A reload asks
     * for that document again, and the injected table is not always rebuilt, so the
     * value seen on the first load is kept for the rest of the tab's life: without it
     * every beacon after a reload is rejected and the plugin goes blind.
     */
    function token() {
      const injected = typeof window[TOKEN_GLOBAL] === 'string' ? window[TOKEN_GLOBAL] : ''
      if (injected !== '') {
        try {
          window.sessionStorage.setItem(TOKEN_GLOBAL, injected)
        } catch {
          // Storage can be disabled; the injected value is enough for this load.
        }
        return injected
      }
      try {
        const kept = window.sessionStorage.getItem(TOKEN_GLOBAL)
        return typeof kept === 'string' ? kept : ''
      } catch {
        return ''
      }
    }

    /**
     * A report that cannot be delivered is invisible: the Host writes a line only
     * when the body arrives. Counting them here lets the next ordinary request
     * carry the number to the Host, so "no beacons" and "rejected beacons" stop
     * looking the same.
     */
    const beaconStats = { sent: 0, failed: 0 }

    /** How many stage reports left this page, and how many came back an error. */
    function beaconTally() {
      return { sent: beaconStats.sent, failed: beaconStats.failed }
    }

    /** Fire-and-forget stage report; needs no page token. */
    function report(event, data) {
      const capability = token()
      beaconStats.sent += 1
      /** @type {Record<string, string>} */
      const headers = { 'content-type': 'application/json', [CLIENT_HEADER]: '1' }
      if (capability !== '') headers[TOKEN_HEADER] = capability
      const payload = JSON.stringify({ event, hasToken: capability !== '', build: BUILD, ...data })
      // Resolved through a promise so a synchronous throw and a rejection are the
      // same thing here; real fetch only ever does the latter.
      const send = (keepalive) => Promise.resolve()
        .then(() => fetch(BEACON, { method: 'POST', headers, credentials: 'same-origin', keepalive, body: payload }))
        .then((response) => { if (response.ok !== true) beaconStats.failed += 1 })
      send(true).catch(() => {
        beaconStats.failed += 1
        // A keep-alive request that never completes is dropped when the document is
        // replaced; the same body as an ordinary request still arrives.
        send(false).catch(() => {})
      })
    }

    /**
     * What was asked, in one string: the draft plus the attachments it was asked
     * with. A picture added to the same sentence is a different question, so every
     * place that remembers "already asked for this draft" has to remember the
     * attachments too. The separator cannot occur in a draft, so the two halves
     * stay apart even when the fingerprint itself is empty.
     */
    function requestSignature(draft, attachmentKey) {
      return `${typeof draft === 'string' ? draft : ''}\u0000${typeof attachmentKey === 'string' ? attachmentKey : ''}`
    }

    /** The attachment half of a signature, '' when nothing was attached or nothing was asked. */
    function signatureAttachmentKey(signature) {
      if (typeof signature !== 'string') return ''
      const at = signature.indexOf('\u0000')
      return at === -1 ? '' : signature.slice(at + 1)
    }

    /**
     * An empty composer that just gained, lost or swapped an attachment is a new
     * "what would I say next" question: the candidates on screen were written when
     * the composer held something else. Pure, so the rule can be tested on its own.
     */
    function nextAskForAttachments(input) {
      const prior = typeof input?.priorKey === 'string' ? input.priorKey : null
      const key = typeof input?.attachmentKey === 'string' ? input.attachmentKey : ''
      // null means nothing has been observed yet: mounting is not a change.
      if (prior === null || prior === key) return false
      const live = input?.live ?? {}
      if (live.enabled !== true || live.sessionId === null || live.running === true || live.manual === true) return false
      if (live.nextEnabled === false) return false
      return typeof live.draft === 'string' && live.draft.trim() === ''
    }

    /**
     * Whether the dock may paint the next-message candidates it is holding. The store
     * outlives a Session switch: after the switch it still says kind 'next' with the
     * previous Session's candidates, and the empty composer makes every other condition
     * true — the first sentence of the old Session then appeared in the new one
     * (issue #10). The candidates belong to whoever asked for them.
     */
    /**
     * Whether Escape has anything to do.
     *
     * It used to be `if (visible)`, and `visible` is computed from the current state:
     * a ghost painted by the previous state stays on screen while nothing is
     * visible any more, and Esc then returned without even preventing the default —
     * the key looked broken. A painted layer, or work in flight, is also something
     * to close.
     */
    function closeOnEscape(input) {
      const live = input ?? {}
      if (live.visible === true) return true
      if (live.residue === true) return true
      const phase = typeof live.phase === 'string' ? live.phase : 'idle'
      return phase === 'loading' || phase === 'streaming'
    }

    /** How many layers the document holds, and for whom: two is never correct. */
    function layerStats() {
      if (typeof document?.querySelectorAll !== 'function') return { layers: null, sessions: [] }
      const nodes = Array.from(document.querySelectorAll('[data-composer-quill="layer"]'))
      return {
        layers: nodes.length,
        sessions: nodes.map((node) => (typeof node.getAttribute === 'function' ? node.getAttribute('data-session') : null)),
      }
    }

    // Whether a compose answer sitting in the store belongs to the Session now on
    // screen. The store outlives a switch, so a branch that clears "the old compose
    // answer" must not use it as a verdict about this Session: doing that erased the
    // suggestion the mount effect had just hydrated (measured 08:58:01.727Z, real app).
    function ownsCompose(state, sessionId) {
      return state !== null && typeof state === 'object'
        && state.kind === 'compose'
        && state.sessionId === sessionId
    }

    function nextVisible(input) {
      const live = input ?? {}
      if (live.nextEnabled === false || live.running === true) return false
      if (live.draftEmpty !== true) return false
      if (live.kind !== 'next') return false
      if (live.sessionId === null || live.sessionId === undefined) return false
      if (live.storeSessionId !== live.sessionId) return false
      if (live.alreadyInEditor === true) return false
      return typeof live.current === 'string' && live.current !== ''
    }

    /**
     * The composer this dock lives in. A dock whose chip is no longer in the document
     * is not on screen: it must not paint into whatever composer happens to be first.
     */
    function composerForDock(sessionId) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null
      const all = Array.from(document.querySelectorAll('[data-composer-input]'))
        .filter((node) => node !== null && node.isConnected !== false)
      if (all.length === 0) return null
      const id = typeof sessionId === 'string' ? sessionId : ''
      const chip = id === '' ? null : document.querySelector(`[data-composer-quill="dock"][data-session="${id}"]`)
      // No chip means this dock is not rendering: it has no claim on any field.
      if (chip === null || chip === undefined) return null
      if (typeof chip.closest === 'function') {
        const inside = chip.closest('[data-composer-input]')
        if (inside !== null && inside.isConnected !== false) return inside
      }
      // The slot is a sibling of the composer, not inside it. Structure decides, not
      // distance: the innermost ancestor that holds exactly one composer is the pane
      // this dock belongs to. Floats and layout shifts move pixels; the tree does not.
      let node = typeof chip.parentElement === 'object' ? chip.parentElement : null
      for (let depth = 0; node !== null && node !== undefined && depth < 12; depth += 1) {
        const inside = typeof node.querySelectorAll === 'function'
          ? node.querySelectorAll('[data-composer-input]')
          : []
        const only = inside[0]
        if (inside.length === 1 && only !== undefined && only.isConnected !== false) return only
        node = node.parentElement ?? null
      }
      return null
    }

    /**
     * A compose suggestion is about text that is already there: a tail continues it,
     * a rewrite replaces it. With an empty composer there is nothing to continue, and
     * `followRemainder(full, '')` is the whole suggestion — which is how a leftover
     * from the previous draft ended up painted as if it were the user's opening line.
     */
    function composeVisible(input) {
      const live = input ?? {}
      if (live.composeEnabled === false || live.running === true) return false
      if (live.kind !== 'compose') return false
      if (live.sessionId === null || live.sessionId === undefined) return false
      if (live.storeSessionId !== live.sessionId) return false
      if (typeof live.composed !== 'string' || live.composed === '') return false
      if (typeof live.editorText !== 'string' || live.editorText.trim() === '') return false
      if (live.tail !== '') return true
      return live.fresh === true && live.composed.trim() !== live.draftBase.trim()
    }

    /** Read an SSE compose response, falling back to a whole JSON body. */
    /** Headers every request needs, so the two transports cannot drift apart. */
    function requestHeaders(accept) {
      const capability = token()
      /** @type {Record<string, string>} */
        const headers = { 'content-type': 'application/json', [CLIENT_HEADER]: '1' }
      if (accept !== undefined) headers.accept = accept
      if (capability !== '') headers[TOKEN_HEADER] = capability
      return headers
    }

    async function streamRoute(url, payload, signal, handlers) {
      const headers = requestHeaders('text/event-stream')
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...payload,
          locale: browserLocale(),
          language: currentConfig().language,
          epoch: syncEpoch(payload.sessionId),
          model: currentConfig().modelRoute,
          reasoning: currentConfig().reasoning,
        }),
        signal,
        credentials: 'same-origin',
      })
      if (!response.ok) {
        let message = `request failed (HTTP ${response.status})`
        try {
          const body = await response.json()
          if (typeof body?.error?.message === 'string' && body.error.message !== '') message = body.error.message
        } catch {
          // Non-JSON body: keep the status message.
        }
        throw Object.assign(new Error(message), { status: response.status })
      }
      const type = response.headers?.get?.('content-type') ?? ''
      if (!type.includes('text/event-stream') || response.body === null || response.body === undefined) {
        handlers.json(await response.json())
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let terminal = false
      const dispatch = (frame) => {
        let event = 'message'
        const dataLines = []
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length === 0) return
        let data = {}
        try {
          data = JSON.parse(dataLines.join('\n'))
        } catch {
          return
        }
        // `done` and `error` close a stream. A stream that simply stops without
        // one must not leave a half suggestion on screen.
        if (event === 'done' || event === 'error') terminal = true
        handlers[event]?.(data)
      }
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let cut = buffer.indexOf('\n\n')
          while (cut >= 0) {
            dispatch(buffer.slice(0, cut))
            buffer = buffer.slice(cut + 2)
            cut = buffer.indexOf('\n\n')
          }
        }
        if (buffer.trim() !== '') dispatch(buffer)
        if (!terminal) {
          if (typeof handlers.error === 'function') handlers.error({ message: 'stream ended without a result' })
        }
      } finally {
        try { await reader.cancel() } catch { /* already closed */ }
      }
    }

    /** The usage ledger for the settings panel (no model call). */
    async function fetchUsage(sessionId, signal) {
      const body = await callRoute('/composer-quill/usage', { sessionId }, signal)
      return body !== null && typeof body === 'object' ? body : null
    }

    /** Which providers and models this installation can reach (no model call). */
    async function fetchModels(signal) {
      const body = await callRoute('/composer-quill/models', {}, signal)
      const providers = Array.isArray(body?.providers) ? body.providers : []
      return providers
        .filter((provider) => typeof provider?.id === 'string' && Array.isArray(provider.models))
        .map((provider) => ({
          id: provider.id,
          name: typeof provider.name === 'string' ? provider.name : provider.id,
          models: provider.models.filter((model) => typeof model?.id === 'string'),
        }))
    }

    /** Zero the lifetime totals. */
    async function resetUsageTotals(signal) {
      const body = await callRoute('/composer-quill/usage', { reset: true }, signal)
      return body !== null && typeof body === 'object' ? body : null
    }

    /** The user's own past messages for this Session (no model call). */
    async function fetchHistory(sessionId, signal) {
      const body = await callRoute('/composer-quill/history', { sessionId }, signal)
      return Array.isArray(body?.items) ? body.items : []
    }

    async function callRoute(path, payload, signal) {
      const headers = requestHeaders()
      const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, model: currentConfig().modelRoute, reasoning: currentConfig().reasoning, locale: browserLocale(), language: payload.draft === '' ? currentConfig().language : 'auto' }),
        signal,
        credentials: 'same-origin',
      })
      if (!response.ok) {
        let message = `request failed (HTTP ${response.status})`
        try {
          const body = await response.json()
          if (typeof body?.error?.message === 'string' && body.error.message !== '') message = body.error.message
        } catch {
          // Non-JSON body: keep the status message.
        }
        throw Object.assign(new Error(message), { status: response.status })
      }
      return await response.json()
    }
