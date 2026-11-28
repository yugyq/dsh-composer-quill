/**
 * dsh-composer-quill — Client half.
 *
 * Two capabilities, one entry each, both optional (Settings → General toggle):
 *  1. next message — after a turn settles, up to three likely next messages are
 *     painted as inline ghost text in the empty composer; Tab inserts one, ←/→ cycle;
 *  2. compose — while typing, a pause asks for ONE message that both finishes the
 *     draft and tidies it (typos, punctuation, structure). Tab takes it: the
 *     missing tail is inserted when the rewrite merely extends the draft, and the
 *     whole draft is replaced when the rewrite also changes what is already there.
 *
 * Completion and cleanup are therefore a single entry rather than two. Nothing
 * mutates the draft without an explicit accept.
 *
 * The inline ghost is an absolutely positioned layer inside the composer, so the
 * host's own overflow clips it and dialogs cover it. Hints live in the composer dock
 * row in normal flow, so a suggestion stays reachable even without the inline layer.
 *
 * A beacon is posted once per mount and one `paint` report records the real
 * rects, so a silent failure leaves a trace in the Host's composer-quill.log.
 */
window.__ModuleLoader__.load({
  id: 'dsh-composer-quill',
  factory(require) {
// --- prelude.js — concatenated into client.js by dev/tools/build-client.mjs ---
    const React = require('react')
    const h = React.createElement

    const NS = 'composer-quill'
    const BUILD = '0.33.11'
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
    // Consecutive suggestions ignored before rewrites are withheld. One ignore is
    // already a decision — in real traffic the streak almost never reached two
    // (237 sessions: 17 reached one, none reached two), so the rule needs the
    // first ignore; one accept restores rewrites.
    const IGNORE_STREAK_LIMIT = 1
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
  'settings.suppress': '忽略一次后暂停整段改写',
  'settings.suppress.hint': '忽略一条建议后，只保留在句尾接着写；整段改写暂停，采纳一次即恢复。',
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
  'settings.suppress': 'Pause rewrites after one ignore',
  'settings.suppress.hint': 'After one suggestion goes unused, only tails keep arriving; rewrites stay off until one is accepted.',
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
// --- attachments.js — concatenated into client.js by dev/tools/build-client.mjs ---
    /** A composer rarely holds more than a screenshot and a file at once. */
    const MAX_DESCRIBED_ATTACHMENTS = 8

    /**
     * What the composer is holding, in the only shape this plugin is allowed to send.
     *
     * The browser uploads every attachment before the message is sent, so by the time
     * a suggestion is asked for the Host already holds the bytes and has handed back a
     * receipt per file. We forward that receipt and nothing else: the request body
     * stays a few hundred bytes, and the plugin never becomes a second way to move a
     * file. An attachment that is still uploading is described without a receipt —
     * the Host then tells the model the picture is not visible yet, which is true.
     */
    function attachmentPort(ctx) {
      const conversationOf = () => {
        // The runtime gates direct service access on the plugin's declared inject and
        // throws for the rest, so a plain `ctx.conversation` can be a denial rather
        // than a value. The declared path is tried first, the lookup is the fallback.
        try {
          const declared = ctx?.conversation
          if (declared !== undefined && declared !== null) return declared
        } catch {}
        try {
          return ctx?.get?.('conversation') ?? null
        } catch {
          return null
        }
      }
      const uploadsOf = (conversation) => {
        try {
          const store = conversation?.fileUploads
          return typeof store?.getSnapshot === 'function' ? (store.getSnapshot() ?? {}) : {}
        } catch {
          return {}
        }
      }
      // Why the last describe() came back the way it did. The dock reports it, so a
      // silent empty list can be told apart from an empty composer in the log.
      let lastNote = ''
      // How many the composer actually holds. Past MAX_DESCRIBED_ATTACHMENTS the rest
      // are not described, and the Host is told how many it is not being shown.
      let lastTotal = 0
      const describe = (input) => {
        const ids = Array.isArray(input?.attachmentIds) ? input.attachmentIds : []
        lastTotal = ids.length
        lastNote = ids.length === 0 ? 'none' : ''
        if (ids.length === 0) return []
        const conversation = conversationOf()
        if (conversation === null) lastNote = 'no-conversation'
        let drafted = []
        try {
          drafted = typeof conversation?.resolveDraftAttachments === 'function'
            ? (conversation.resolveDraftAttachments(ids) ?? [])
            : []
        } catch {
          drafted = []
        }
        if (drafted.length === 0) lastNote = conversation?.resolveDraftAttachments === undefined ? 'no-resolver' : 'unresolved'
        const uploads = uploadsOf(conversation)
        const described = []
        for (const item of drafted) {
          const name = typeof item?.file?.name === 'string' ? item.file.name : ''
          const bytes = Number.isFinite(item?.file?.size) ? item.file.size : 0
          const upload = uploads[typeof item?.id === 'string' ? item.id : '']
          const receiptId = upload?.status === 'ready' && typeof upload.receiptId === 'string' ? upload.receiptId : ''
          // Why the receipt is missing changes what the model should say: an upload
          // still running is a wait, one the Host refused is a dead end.
          const status = upload?.status === 'ready' || upload?.status === 'uploading' || upload?.status === 'error'
            ? upload.status
            : 'missing'
          described.push({ kind: item?.kind === 'image' ? 'image' : 'file', name, bytes, receiptId, status })
          if (described.length >= MAX_DESCRIBED_ATTACHMENTS) break
        }
        lastNote = lastNote === '' ? `ok:${described.length}:${described.filter(item => item.receiptId !== '').length}` : lastNote
        return described
      }
      const probe = () => lastNote
      const total = () => lastTotal
      /**
       * The same shape the Host stamps into its request trace, so a log line from
       * either side reads identically. An unready attachment has no receipt: its
       * name stands in, which still changes when a different file is picked.
       */
      const key = (described, count = 0) => {
        const list = Array.isArray(described) ? described : []
        const stamp = list
          .map((item) => `${item?.kind === 'image' ? 'image' : 'file'}:${item?.receiptId ? item.receiptId : (item?.name ?? '')}:${Number.isFinite(item?.bytes) ? item.bytes : 0}`)
          .join(',')
        // Same convention as the Host's stamp: dropping the tenth file must read as a
        // different question than dropping none.
        const total = Number.isFinite(count) ? Math.floor(count) : 0
        return total > list.length ? `${stamp}+${total}` : stamp
      }
      return { describe, probe, total, key }
    }
// --- store.js — concatenated into client.js by dev/tools/build-client.mjs ---

    function createSnapshotStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set: (next) => {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    const IDLE = Object.freeze({
      sessionId: null, phase: 'idle', kind: 'next', items: [], index: 0, error: null, request: null, itemsRequest: null,
    })

    /**
     * Which gate stops this request, and what to do about it. Pure: every input is
     * passed in, so the ORDER of the decisions is testable without React, timers or a
     * network. Mirrors request() exactly — see docs/REQUEST_STATE_MACHINE.md.
     */
    function gateFor(input) {
      const live = input?.live ?? {}
      const mode = input?.mode === 'next' ? 'next' : 'compose'
      const now = Number.isFinite(input?.now) ? input.now : Date.now()
      const force = input?.force === true
      // "||" not "??": an empty forDraft means "use whatever is in the composer now".
      const draftNow = mode === 'next' ? '' : (input?.forDraft || live.draft || '')
      // The attachments belong in the key: the same draft with a different picture is
      // a different question, and every dedupe below compares keys.
      const attachmentKey = typeof input?.attachmentKey === 'string' ? input.attachmentKey : ''
      // Only appended when there is something to append: the key of a plain
      // draft stays exactly what it always was.
      const key = mode + "|" + draftNow + (attachmentKey === '' ? '' : "|" + attachmentKey)
      const effects = []
      const stop = (gate) => ({ verdict: 'stop', gate, draftNow, key, effects })
      const send = (gate) => ({ verdict: 'send', gate, draftNow, key, effects })

      if (!live.enabled || live.sessionId === null) return stop('G1')
      // Per-feature switches: the mode itself may be off while the other one runs.
      if (mode === 'next' && live.nextEnabled === false) return stop('G0')
      if (mode === 'compose' && live.composeEnabled === false) return stop('G0')
      if (now < (input?.blockedUntil ?? 0)) return stop('G2')

      const served = input?.served ?? { key: '', at: 0 }
      if (served.key === key && now - served.at < SERVED_TTL_MS) {
        effects.push({ type: 'report', name: 'reuse', detail: 'store' })
        return stop('G3')
      }

      if (!force) {
        const lastCall = input?.lastCall ?? { key: '', at: 0 }
        if (lastCall.key === key && now - lastCall.at < DEDUPE_MS) {
          effects.push({ type: 'report', name: 'dedupe', detail: mode })
          effects.push({ type: 'reschedule', wait: Math.max(80, DEDUPE_MS - (now - lastCall.at)) })
          return stop('G4a')
        }
        const stored = input?.stored ?? null
        if (mode === 'compose'
          && attachmentKey === ''
          && stored !== null
          && stored.sessionId === live.sessionId
          && stored.kind === 'compose'
          && stored.request !== null
          && stored.request !== null && stored.request !== undefined && stored.request.draft === draftNow
          && (stored.phase === 'ready' || stored.phase === 'empty')) {
          effects.push({ type: 'report', name: 'reuse', detail: stored.phase })
          effects.push({ type: 'mark-last-call' })
          return stop('G4b')
        }
        // Passed the dedupe: the call is claimed even if a later gate stops it —
        // request() writes lastCall before the running/short/dismissed checks.
        effects.push({ type: 'mark-last-call' })
      }

      if (mode === 'next') {
        if (live.running === true || live.draftEmpty !== true) return stop('G5ad')
      } else {
        if (live.running === true) return stop('G5a')
        if (draftNow.trim().length < MIN_DRAFT_CHARS) return stop('G5b')
        if (input?.dismissed != null && input.dismissed === draftNow) return stop('G5c')
        const stored = input?.stored ?? null
        if (stored !== null && stored.phase === 'loading' && stored.request !== null && stored.request !== undefined && inFlightCovers(stored.request.draft, draftNow)) {
          effects.push({ type: 'report', name: 'reuse', detail: 'in-flight' })
          return stop('G6')
        }
      }

      return send('G7')
    }

    /**
     * What the dock remembers about the draft in the composer. Pure, so the one-shot
     * guards ("already painted", "already covered", "has typed here") can be tested
     * without React.
     */
    function createDockBooking() {
      return { painted: '', covered: '', hadDraft: false, dismissed: null, switched: null }
    }

    function dockReducer(booking, action) {
      switch (action?.type) {
        case 'painted':
          return booking.painted === action.key ? booking : { ...booking, painted: action.key }
        case 'covered':
          return booking.covered === action.draft ? booking : { ...booking, covered: action.draft }
        case 'not-covered':
          return booking.covered === '' ? booking : { ...booking, covered: '' }
        case 'typed':
          return booking.hadDraft ? booking : { ...booking, hadDraft: true }
        case 'cleared':
          return booking.hadDraft ? { ...booking, hadDraft: false } : booking
          case 'dismissed':
            return booking.dismissed === action.draft ? booking : { ...booking, dismissed: action.draft }
          case 'undismissed':
            return booking.dismissed === null ? booking : { ...booking, dismissed: null }
          case 'switch-started':
            return booking.switched === action.draft ? booking : { ...booking, switched: action.draft }
          case 'switch-settled':
            return booking.switched === null ? booking : { ...booking, switched: null }
          case 'composer-empty':
            // Emptied on purpose: forget the dismissal and the "has typed here" flag,
            // keep the paint/cover bookkeeping.
            return booking.dismissed === null && booking.hadDraft === false
              ? booking
              : { ...booking, dismissed: null, hadDraft: false }
        default:
          return booking
      }
    }

    /**
     * True while a request for this exact draft is already scheduled but has not gone
     * out. The typing path schedules on a short delay; the safety net polls on a slow
     * one; without this the two can both fire for the same draft.
     */
    function claimBlocksRetrigger(claim, text, now) {
      if (claim === null || typeof claim !== 'object') return false
      if (typeof claim.key !== 'string' || typeof claim.until !== 'number') return false
      if (now >= claim.until) return false
      return claim.key === `compose|${text}`
    }

    /**
     * Tab accepts, but only the bare key: Shift+Tab, Alt+Tab and any Ctrl/Meta combo
     * belong to the host's focus navigation. Without an escape hatch a keyboard user
     * would have to dismiss the suggestion to move focus at all.
     */
    function isAcceptKey(event) {
      if (event === null || typeof event !== 'object') return false
      if (event.key !== 'Tab') return false
      return event.shiftKey !== true && event.altKey !== true && event.ctrlKey !== true && event.metaKey !== true
    }

    /** 1234 -> "1.2k", 1200000 -> "1.2M". Below 1000 stays exact. */
    function formatTokens(value) {
      const number = Number(value) || 0
      if (number < 1000) return String(number)
      if (number < 1_000_000) return `${(number / 1000).toFixed(number < 10_000 ? 1 : 0)}k`
      return `${(number / 1_000_000).toFixed(1)}M`
    }

    /** Micro-USD -> "$0.0042". Sub-cent values keep four decimals. */
    /** Micro-USD in the ledger -> CNY for display. The rate travels with the table. */
    function formatCost(micro, cnyPerUsd = 7.1) {
      const cny = ((Number(micro) || 0) / 1_000_000) * (Number(cnyPerUsd) || 7.1)
      if (cny === 0) return '¥0'
      if (cny < 0.01) return `¥${cny.toFixed(4)}`
      if (cny < 1) return `¥${cny.toFixed(3)}`
      return `¥${cny.toFixed(2)}`
    }

    /**
     * Which state the one-line row shows. Pure, so the precedence is testable: a
     * failure outranks an undo offer, which outranks a suggestion.
     */
    function statusChipKind(input) {
      if (input?.pending === true) return 'pending'
      if (typeof input?.failure === 'string' && input.failure !== '') return 'error'
      if (input?.empty === true) return 'empty'
      if (input?.undo === true) return 'undo'
      if (typeof input?.suggestion === 'string' && input.suggestion !== '') return 'suggestion'
      return 'hint'
    }

    /**
     * What a screen reader should hear. Pure, so the transitions are testable:
     * failure first, then a settled suggestion, then "working".
     */
    function describeAnnouncement(input) {
      const t = input?.t ?? ((key) => key)
      const failure = typeof input?.failure === 'string' ? input.failure : ''
      const status = typeof input?.status === 'string' ? input.status : ''
      if (failure !== '') return `${t('hint.error')}：${failure.slice(0, 80)}`
      if (status !== '') return `${t('status.prefix')}${status.slice(0, 60)}`
      if (input?.busy === true) return t('hint.pending')
      return ''
    }

    /**
     * A suggestion is a non-empty string or it is nothing. Both transports go through
     * this: a malformed JSON answer used to reach the renderer and throw there.
     */
    function usableItems(value) {
      return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item !== '') : []
    }

    function createGhostStore() {
      const store = createSnapshotStore(IDLE)
      let controller = null
      // Which request the controller above belongs to. A controller outlives a
      // session switch, so "is this still the current request" must be asked of the
      // snapshot, not of the variable.
      let controllerId = null
      let acc = ''
      let streamMode = 'full'
      // After a few suggestions ignored in a row, the rewrite is the expensive kind
      // the user keeps throwing away. Suppression withholds those while tails keep
      // arriving; the flag lives here because every paint path goes through it.
      let suppressRewrites = false
      // The streak lives here too: the ignore sites are spread across sibling hooks
      // that share nothing but this store.
      let allowSuppress = true
      let ignoredStreak = 0
      const recomputeSuppress = () => {
        suppressRewrites = allowSuppress && ignoredStreak >= IGNORE_STREAK_LIMIT
      }
      // True while the current stream is buffered instead of painted: the mode only
      // arrives with the `start` frame, and half a rewrite on screen is worse than a
      // suggestion that shows up whole.
      let holding = false
      let lastSuppressed = false
      // True while a streamed proposal is on screen and its request is still open: a
      // cancel then means the text must go, not just the request.
      let streaming = false
      // The draft this stream was requested for. A retained proposal may belong
      // to an older draft, so the base must come from the request, not the store.
      let streamBase = ''
      // Every request gets a number, and every write has to quote it. Two keystrokes
      // and two answers used to be distinguishable only by draft text, which is the
      // same string in all the interesting races.
      let requestEpoch = 0
      // Frames that arrived for a request the user had already moved past. Counting
      // them turns a silent race into something the log can show.
      let droppedFrames = 0

      /**
       * The identity of one question: which Session, which draft, which attachment,
       * which attempt. `epoch` is local and monotonic; the Host's cache epoch is a
       * separate thing and never reaches this store.
       */
      const newRequest = (sessionId, draft, attachmentKey) => {
        requestEpoch += 1
        return {
          sessionId: typeof sessionId === 'string' ? sessionId : '',
          draft: typeof draft === 'string' ? draft : '',
          attachmentKey: typeof attachmentKey === 'string' ? attachmentKey : '',
          epoch: requestEpoch,
        }
      }

      // The ONE writer. Every state change names the request it belongs to, and
      // `sessionId` is a denormalised copy of that identity -- nothing else may
      // assign it. Starting a request is always allowed (that is the whole point of
      // switching identity); a FRAME from an older request is not, and goes through
      // frame() below instead of re-checking the same condition at eight call sites.
      const commit = (id, patch) => {
        const current = store.getSnapshot()
        store.set({
          ...current,
          ...patch,
          request: id,
          sessionId: id === null ? null : id.sessionId,
        })
        return true
      }

      /** Write a frame only if it still belongs to the request on screen. */
      const frame = (id, patch) => {
        if (id === undefined || store.getSnapshot().request !== id) {
          droppedFrames += 1
          return false
        }
        return commit(id, patch)
      }

      const cancel = () => {
        const cancelled = controllerId
        if (controller !== null) {
          controller.abort()
          controller = null
        }
        controllerId = null
        // Without this the dock keeps showing "补写中…" after a cancel (switching
        // Sessions, starting a turn) and nothing ever clears it.
        const current = store.getSnapshot()
        if (current.phase === 'loading' && current.request === cancelled) commit(null, { phase: 'idle' })
      }
      const proposalOf = () => (streamMode === 'append' ? `${streamBase.replace(/\s+$/, '')}${acc}` : acc)
      return {
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        /** The identity of the question about to be asked. */
        newRequest,
        setSuppressRewrites: (flag) => {
          allowSuppress = flag !== false
          recomputeSuppress()
        },
        /** A suggestion was shown and thrown away. */
        noteIgnored: () => {
          ignoredStreak += 1
          recomputeSuppress()
          return ignoredStreak
        },
        /** One accept earns rewrites back. */
        noteAccepted: () => {
          ignoredStreak = 0
          recomputeSuppress()
        },
        /** A Session switch starts over. */
        resetStreak: () => {
          ignoredStreak = 0
          recomputeSuppress()
        },
        /** What the suppression rule is currently doing, for the dock-state beacon. */
        suppressState: () => ({ on: suppressRewrites, streak: ignoredStreak, allow: allowSuppress }),
        /** True once, if the last finished stream was withheld on purpose. */
        takeSuppressed: () => {
          const was = lastSuppressed
          lastSuppressed = false
          return was
        },
        /** How many frames were dropped because their request was no longer live. */
        streamDropped: () => droppedFrames,
        cancel: () => {
          cancel()
          if (!streaming) return
          streaming = false
          acc = ''
          streamMode = 'full'
          streamBase = ''
          commit(null, { phase: 'idle', items: [], index: 0, error: null, itemsRequest: null })
        },
        /** Streaming compose: same snapshot shape, filled in as deltas arrive. */
        streamStart: (request, kind) => {
          cancel()
          streaming = true
          controller = new AbortController()
          controllerId = request
          acc = ''
          streamMode = 'full'
          streamBase = request.draft
          lastSuppressed = false
          // A compose answer may still turn out to be a rewrite, so nothing is
          // painted until the `start` frame says which case it is.
          holding = suppressRewrites && kind === 'compose'
          const previous = store.getSnapshot()
          // Keep the proposal that is already on screen; the first delta of this
          // request replaces it. Otherwise every keystroke blanks the composer.
          const keep = !holding
            && previous.sessionId === request.sessionId
            && previous.kind === kind
            && previous.items.length > 0
          commit(request, {
            phase: 'loading',
            kind,
            items: keep ? previous.items : [],
            itemsRequest: keep ? (previous.itemsRequest ?? previous.request) : null,
            index: keep ? Math.min(previous.index, previous.items.length - 1) : 0,
            error: null,
          })
          return controller
        },
        /** Switch proposal mode without clearing what is already on screen. */
        streamModeSet: (mode) => {
          streamMode = mode === 'append' ? 'append' : 'full'
          // A tail is welcome even while suppressed: release the hold so the deltas
          // that follow paint as usual.
          if (mode === 'append') holding = false
        },
        streamRetract: (mode, request) => {
          if (store.getSnapshot().request !== request) {
            frame(request, {})
            return
          }
          acc = ''
          streamMode = mode === 'append' ? 'append' : 'full'
          if (streamMode === 'append') holding = false
          frame(request, { items: [], itemsRequest: null })
        },
        streamDelta: (text, request) => {
          if (typeof text !== 'string' || text === '') return
          if (store.getSnapshot().request !== request) {
            frame(request, {})
            return
          }
          acc += text
          // Withheld: keep the scratch text, leave the composer alone.
          if (holding) return
          // The store may still carry the proposal of an older draft (retention):
          // this result belongs to the draft the stream was requested for.
          frame(request, { phase: 'ready', items: [proposalOf()], itemsRequest: request })
        },
        streamFinal: (text, mode, request) => {
          if (store.getSnapshot().request !== request) {
            frame(request, {})
            return
          }
          streaming = false
          if (mode === 'append' || mode === 'full') streamMode = mode
          if (holding && streamMode === 'full') {
            // Suppressed rewrite: better silent than covering the draft the user is
            // still typing.
            holding = false
            lastSuppressed = true
            acc = ''
            frame(request, { phase: 'empty', items: [], itemsRequest: null })
            return
          }
          holding = false
          if (typeof text === 'string') {
            // The Host sends the whole proposal; rebasing it here keeps the
            // spacing and trailing punctuation that the tail alone would lose.
            const base = streamBase.replace(/\s+$/, '')
            acc = streamMode === 'append' && base !== '' && text.startsWith(base)
              ? text.slice(base.length)
              : text
          }
          frame(request, { phase: 'ready', items: [proposalOf()], itemsRequest: request })
        },
        streamDone: (meta, request) => {
          if (store.getSnapshot().request !== request) {
            frame(request, {})
            return
          }
          streaming = false
          controller = null
          controllerId = null
          const current = store.getSnapshot()
          const items = usableItems(current.items)
          const unchanged = meta !== null && typeof meta === 'object' && meta.reason === 'unchanged'
          // An error for this draft outranks a later "nothing to add": the user asked
          // once, it failed, and a quiet empty answer must not erase that fact.
          if (unchanged && current.phase === 'error') return
          frame(request, {
            phase: unchanged || items.length === 0 ? 'empty' : 'ready',
            // The Host said "nothing to change" for this draft: keeping the older
            // proposal would offer a suggestion it just rejected.
            items: unchanged ? [] : items,
            itemsRequest: unchanged ? null : request,
            error: null,
          })
        },
        streamFail: (message, request) => {
          if (store.getSnapshot().request !== request) {
            frame(request, {})
            return
          }
          streaming = false
          controller = null
          controllerId = null
          // The identity is what keeps the retry budget pointed at the right draft:
          // a failure for an older request cannot overwrite this one's state.
          frame(request, { phase: 'error', items: [], error: message, itemsRequest: null })
        },
        clear: (sessionId) => {
          const current = store.getSnapshot()
          if (sessionId !== undefined && current.sessionId !== null && current.sessionId !== sessionId) return
          cancel()
          // The streaming scratch space outlives the snapshot: without this the next
          // result is composed onto the draft that was cleared ("old draft + new tail").
          acc = ''
          streamMode = 'full'
          streamBase = ''
          commit(null, { phase: 'idle', kind: 'next', items: [], index: 0, error: null, itemsRequest: null })
        },
        /**
         * Show a suggestion that was computed earlier (from localStorage) without
         * asking the Host again. A live result always wins over a stored one.
         */
        hydrate: (request, kind, items) => {
          if (!Array.isArray(items) || items.length === 0) return false
          // A stored compose answer may be a rewrite and carries no mode: while
          // suppressed, keep the store quiet and let a live request decide.
          if (suppressRewrites && kind === 'compose') return false
          const current = store.getSnapshot()
          if (current.sessionId === request.sessionId && current.items.length > 0) return false
          if (current.sessionId === request.sessionId && current.phase === 'loading') return false
          commit(request, { phase: 'ready', kind, items, index: 0, error: null })
          return true
        },
        cycle: (step) => {
          const current = store.getSnapshot()
          const total = current.items.length
          if (total < 2) return
          commit(current.request, { index: (current.index + step + total) % total })
        },
        /**
         * Mark a request as started at schedule time (before the debounce fires)
         * so the UI can show a busy affordance immediately, while keeping the
         * proposal that is already on screen.
         */
        begin: (request, kind) => {
          cancel()
          controller = new AbortController()
          controllerId = request
          const previous = store.getSnapshot()
          // Keep the proposal that is already on screen: a new request must not
          // blank the composer for a second. A retained proposal keeps its own
          // identity, so the prefix arithmetic still matches what it was built from.
          const keep = previous.sessionId === request.sessionId
            && previous.kind === kind
            && previous.items.length > 0
          commit(request, {
            phase: 'loading',
            kind,
            items: keep ? previous.items : [],
            itemsRequest: keep ? (previous.itemsRequest ?? previous.request) : null,
            index: keep ? Math.min(previous.index, previous.items.length - 1) : 0,
            error: null,
          })
          return controller
        },
        settle: (request, active, kind, rawItems) => {
          if (controller !== active || active.signal.aborted) return
          controller = null
          controllerId = null
          // The streaming path already drops anything that is not a non-empty string;
          // a malformed JSON answer used to reach the renderer instead.
          const items = usableItems(rawItems)
          commit(request, {
            // 'empty' is a settled answer ("nothing to add"), not a pending state.
            phase: items.length === 0 ? 'empty' : 'ready',
            kind,
            items,
            index: 0,
            error: null,
          })
        },
        fail: (request, active, kind, message) => {
          if (controller !== active || active.signal.aborted) return
          controller = null
          controllerId = null
          commit(request, { phase: 'error', kind, items: [], index: 0, error: message, itemsRequest: null })
        },
      }
    }
// --- config.js — concatenated into client.js by dev/tools/build-client.mjs ---
    const CONFIG_KEY = 'dsh.composer-quill.config'
    const LEGACY_KEY = 'dsh.composer-quill.enabled'
    const DEFAULT_CONFIG = Object.freeze({
      nextEnabled: true,     // prediction for an empty composer
      composeEnabled: true,  // completion while typing
      mode: 'auto',        // 'auto' | 'manual'
    language: 'auto',    // 'auto' (follow the system) | 'zh' | 'en'
      debounceMs: COMPOSE_DEBOUNCE_MS,
      timeoutMs: 20000,
      modelRoute: null,   // { provider, model } or null: follow the session
      reasoning: 'off',   // 'off' | 'low' | 'high' | 'max'
      suppressRewrites: true, // pause rewrites after IGNORE_STREAK_LIMIT ignores
    })

    /** Coerce anything we find in storage into a usable configuration. */
    function normalizeConfig(raw) {
      const clamp = (value, min, max, fallback) => {
        const number = Number(value)
        if (!Number.isFinite(number)) return fallback
        return Math.min(max, Math.max(min, Math.round(number)))
      }
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      // Migration: older builds stored a single flag. It meant "both were on".
      const legacyOn = source.enabled !== false
      return {
        nextEnabled: source.nextEnabled !== undefined ? source.nextEnabled !== false : legacyOn,
        composeEnabled: source.composeEnabled !== undefined ? source.composeEnabled !== false : legacyOn,
        mode: source.mode === 'manual' ? 'manual' : 'auto',
      language: source.language === 'zh' || source.language === 'en' ? source.language : 'auto',
        debounceMs: clamp(source.debounceMs, 80, 2000, DEFAULT_CONFIG.debounceMs),
        timeoutMs: clamp(source.timeoutMs, 3000, 60000, DEFAULT_CONFIG.timeoutMs),
        modelRoute: normalizeModelRoute(source.modelRoute),
        reasoning: normalizeReasoning(source.reasoning),
        suppressRewrites: source.suppressRewrites !== false,
      }
    }

    /**
     * A stored model route, or null to follow the session. Anything malformed is
     * dropped rather than repaired: a bad value must not break completion.
     */
    function normalizeModelRoute(value) {
      if (value === null || typeof value !== 'object') return null
      const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
      const model = typeof value.model === 'string' ? value.model.trim() : ''
      return provider !== '' && model !== '' ? { provider, model } : null
    }

    /** A thinking intensity this plugin can ask for; anything else means off. */
    function normalizeReasoning(value) {
      const effort = typeof value === 'string' ? value.trim().toLowerCase() : ''
      return ['off', 'low', 'high', 'max'].includes(effort) ? effort : 'off'
    }

    /** The configuration in force right now (storage is the source of truth). */
    function currentConfig() {
      try {
        return readConfig()
      } catch {
        return { ...DEFAULT_CONFIG }
      }
    }

    function readConfig() {
      try {
        const stored = window.localStorage.getItem(CONFIG_KEY)
        if (stored !== null && stored !== '') return normalizeConfig(JSON.parse(stored))
        const legacy = window.localStorage.getItem(LEGACY_KEY)
        if (legacy === '0') return { ...DEFAULT_CONFIG, nextEnabled: false, composeEnabled: false }
      } catch {
        // Corrupt or unavailable storage: defaults.
      }
      return { ...DEFAULT_CONFIG }
    }

    /**
     * Suggestions survive a reload: the last answer for a Session is kept in
     * localStorage, so entering the Session shows it immediately instead of
     * re-asking the model for something it already produced.
     */
    const SUGGEST_KEY = 'dsh.composer-quill.suggestions'
    // The key carries the Session and the turn counter, so "unchanged" is decidable
    // without a clock. Expiry only guards storage; the 40-entry cap bounds it.
    const SUGGEST_TTL_MS = 24 * 60 * 60_000
    // A rolling list of the most recent results: three kinds per draft (a tail, a
    // rewrite, a next message) across a handful of drafts.
    const SUGGEST_MAX = 60
    /** Records are only meaningful while the same build is writing and reading them. */
    const BUILD_TAG = typeof BUILD === 'string' ? BUILD : ''

    // Parsing this map on every keystroke was measurable; comparing the raw
    // string keeps the parse rare while still noticing another tab's writes.
    let suggestionRaw = null
    let suggestionMemo = {}

    function readSuggestions() {
      try {
        const raw = window.localStorage.getItem(SUGGEST_KEY)
        if (raw === suggestionRaw) return suggestionMemo
        suggestionRaw = raw
        if (raw === null || raw === '') {
          suggestionMemo = {}
          return suggestionMemo
        }
        const parsed = JSON.parse(raw)
        suggestionMemo = parsed !== null && typeof parsed === 'object' ? parsed : {}
        return suggestionMemo
      } catch {
        suggestionRaw = null
        suggestionMemo = {}
        return suggestionMemo
      }
    }

    function writeSuggestions(map) {
      try {
        const raw = JSON.stringify(map)
        window.localStorage.setItem(SUGGEST_KEY, raw)
        suggestionRaw = raw
        suggestionMemo = map
      } catch {
        // Storage full or unavailable: suggestions just become ephemeral.
      }
    }

    /**
     * A suggestion is only reusable while the conversation it was computed from is
     * unchanged: a message count plus the last sequence number is enough.
     */
    function transcriptVersion(events) {
      if (!Array.isArray(events) || events.length === 0) return '0'
      const last = events[events.length - 1]
      const seq = Number(last?.seq ?? events.length)
      return `${events.length}:${Number.isFinite(seq) ? seq : ''}`
    }

    /**
     * A stored suggestion belongs to one conversation state: the turn it was
     * computed in. Bumping the epoch on every finished turn means nothing survives
     * a turn, so an answer about an older topic can never come back.
     */
    function suggestionKey(sessionId, kind, draft, epoch = 0) {
      return `${sessionId ?? ''}|${kind}|${draft ?? ''}|${epoch}`
    }

    function saveSuggestion(sessionId, kind, draft, items, version = '', mode = '') {
      if (sessionId === null || !Array.isArray(items) || items.length === 0) return
      const map = readSuggestions()
      delete map[suggestionKey(sessionId, `none-${kind}`, draft, syncEpoch(sessionId))]
      map[suggestionKey(sessionId, kind, draft, syncEpoch(sessionId))] = {
        items,
        at: Date.now(),
        version: String(version ?? ''),
        // 'append' for a tail, 'full' for a rewrite or a next message: the display
        // derives it anyway, but storing it keeps the record self-describing.
        mode: mode === 'append' || mode === 'full' ? mode : '',
        build: BUILD_TAG,
      }
      const keys = Object.keys(map)
      if (keys.length > SUGGEST_MAX) {
        keys
          .sort((left, right) => (map[left]?.at ?? 0) - (map[right]?.at ?? 0))
          .slice(0, keys.length - SUGGEST_MAX)
          .forEach((stale) => { delete map[stale] })
      }
      writeSuggestions(map)
    }

    /**
     * "Nothing to suggest" is an answer, and it outranks anything stored earlier:
     * the record is kept under the current turn so the next turn can still be
     * asked afresh, and a real answer clears it again (see saveSuggestion).
     */
    function markNoSuggestion(sessionId, kind, draft) {
      if (sessionId === null) return
      const map = readSuggestions()
      map[suggestionKey(sessionId, `none-${kind}`, draft, syncEpoch(sessionId))] = {
        items: [],
        at: Date.now(),
        version: '',
        mode: '',
        build: BUILD_TAG,
      }
      writeSuggestions(map)
    }

    function saidNothing(sessionId, kind, draft) {
      if (sessionId === null) return false
      const map = readSuggestions()
      const entry = map[suggestionKey(sessionId, `none-${kind}`, draft, syncEpoch(sessionId))]
      return entry !== undefined && entry.build === BUILD_TAG
    }

    function loadSuggestion(sessionId, kind, draft) {
      if (sessionId === null) return null
      const entry = readSuggestions()[suggestionKey(sessionId, kind, draft, syncEpoch(sessionId))]
      if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.items)) return null
      // A suggestion written by another build was written by other rules: the
      // prompt, the trimming and the shape of a candidate all change between
      // releases, so replaying one is replaying a stranger's answer. Records
      // without a build predate this check and are treated the same way.
      if (entry.build !== BUILD_TAG) return null
      if (Date.now() - Number(entry.at ?? 0) > SUGGEST_TTL_MS) return null
      // The key already carries the Session and the turn counter, so "the
      // conversation has not advanced" is decided there. Comparing the raw message
      // count as well refused perfectly good results right after a Session switch
      // (that count is fetched asynchronously and lags), which is what made
      // switching Sessions re-sample everything.
      return entry.items.filter((item) => typeof item === 'string' && item !== '')
    }

    /** A finished turn makes every stored suggestion for that Session stale. */
    function clearSessionSuggestions(sessionId) {
      if (sessionId === null) return
      const map = readSuggestions()
      let changed = false
      for (const key of Object.keys(map)) {
        if (key.startsWith(`${sessionId}|`)) {
          delete map[key]
          changed = true
        }
      }
      if (changed) writeSuggestions(map)
    }

    function createConfigStore() {
      const store = createSnapshotStore(readConfig())
      return {
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        set: (patch) => {
          const next = normalizeConfig({ ...store.getSnapshot(), ...patch })
          try {
            window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
          } catch {
            // Best-effort.
          }
          store.set(next)
        },
      }
    }

    /** Tail of `full` the user has not typed yet, or '' when it diverged. */
    function followRemainder(full, draft) {
      if (typeof full !== 'string' || full === '') return ''
      if (typeof draft !== 'string' || draft === '') return ''
      return full.toLowerCase().startsWith(draft.toLowerCase()) ? full.slice(draft.length) : ''
    }

    /**
     * Acceptance learning. Every suggestion that reached the screen is described
     * by a few cheap features; each explicit accept (Tab / click) or reject (Esc,
     * or sending the message without accepting) updates that feature's counters.
     * The counters only reorder candidates — they never invent one.
     */
    const LEARN_KEY = 'dsh.composer-quill.learning'
    const LEARN_MAX_KEYS = 400

    function scriptOfClient(text) {
      const value = String(text ?? '')
      const cjk = value.match(/[\u3000-\u9fff]/g)?.length ?? 0
      const latin = value.match(/[A-Za-z]/g)?.length ?? 0
      if (cjk === 0 && latin === 0) return 'none'
      if (cjk > latin * 2) return 'zh'
      if (latin > cjk * 2) return 'en'
      return 'mixed'
    }

    function featuresOf(text, kind) {
      const value = String(text ?? '')
      const length = Array.from(value).length
      return {
        kind: `kind:${kind}`,
        length: `len:${length < 8 ? 'xs' : length < 24 ? 's' : length < 48 ? 'm' : 'l'}`,
        opener: `open:${/^[，。、,.!?！？;；:]/.test(value) ? 'punct' : 'word'}`,
        greeting: `greet:${/^(好的|好[，,！!]|嗯|收到|没问题|ok|okay|sure|thanks)(?:[，,。.!！?：:\s]|$)/i.test(value) ? 'yes' : 'no'}`,
        ending: `end:${/[。.!?！？]$/.test(value) ? 'period' : 'open'}`,
        script: `script:${scriptOfClient(value)}`,
      }
    }

    /**
     * The number of turns the conversation has seen. It is the decidable part of
     * "exactly the same situation": a stored result may only be reused while this
     * number is unchanged, so it is persisted per Session and only ever grows.
     */
    const EPOCH_KEY = 'dsh.composer-quill.epoch'
    const turnEpoch = { sessionId: null, current: 0 }

    function readEpochMap() {
      try {
        const raw = window.localStorage.getItem(EPOCH_KEY)
        const parsed = raw === null || raw === '' ? {} : JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function epochOf(sessionId) {
      if (sessionId === null || sessionId === undefined) return 0
      const value = Number(readEpochMap()[sessionId] ?? 0)
      return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
    }

    function bumpEpoch(sessionId) {
      if (sessionId === null || sessionId === undefined) return 0
      const map = readEpochMap()
      const next = epochOf(sessionId) + 1
      map[sessionId] = next
      try {
        window.localStorage.setItem(EPOCH_KEY, JSON.stringify(map))
      } catch {
        // Storage unavailable: the in-memory value still invalidates this session.
      }
      turnEpoch.sessionId = sessionId
      turnEpoch.current = next
      return next
    }

    /** Adopt the stored counter when the Session changes. */
    function syncEpoch(sessionId) {
      if (turnEpoch.sessionId === sessionId) return turnEpoch.current
      turnEpoch.sessionId = sessionId
      turnEpoch.current = epochOf(sessionId)
      return turnEpoch.current
    }

    /** @type {{ raw: string | null, data: Record<string, any> }} */
    let learnMemo = { raw: null, data: {} }

    function readLearning() {
      try {
        const raw = window.localStorage.getItem(LEARN_KEY)
        if (raw === learnMemo.raw) return learnMemo.data
        learnMemo = { raw, data: raw === null || raw === '' ? {} : JSON.parse(raw) }
        return learnMemo.data
      } catch {
        learnMemo = { raw: null, data: {} }
        return learnMemo.data
      }
    }

    function writeLearning(data) {
      const keys = Object.keys(data)
      for (const key of keys.slice(0, Math.max(0, keys.length - LEARN_MAX_KEYS))) delete data[key]
      try {
        const raw = JSON.stringify(data)
        window.localStorage.setItem(LEARN_KEY, raw)
        learnMemo = { raw, data }
      } catch {
        // Storage full: learning degrades to in-memory for this session.
        learnMemo = { raw: null, data }
      }
    }

    /** Laplace-smoothed acceptance rate for one feature value. */
    function rateOf(entry) {
      const shown = Number(entry?.shown ?? 0)
      const accepted = Number(entry?.accepted ?? 0)
      return (accepted + 1) / (shown + 2)
    }

    function recordOutcome(features, accepted) {
      const data = readLearning()
      for (const value of Object.values(features ?? {})) {
        const entry = data[value] ?? { shown: 0, accepted: 0 }
        entry.shown += 1
        if (accepted) entry.accepted += 1
        data[value] = entry
      }
      writeLearning(data)
    }

    /** Reorder candidates by learned preference; stable for equal scores. */
    function rankByLearning(items, kind) {
      if (!Array.isArray(items) || items.length < 2) return items
      const data = readLearning()
      const scored = items.map((text, index) => {
        const features = featuresOf(text, kind)
        let score = 0
        for (const value of Object.values(features)) score += rateOf(data[value]) - 0.5
        return { text, index, score }
      })
      scored.sort((left, right) => (right.score - left.score) || (left.index - right.index))
      return scored.map((entry) => entry.text)
    }

    /** One line for the settings card: how much has been learned. */
    function learningSummary() {
      const data = readLearning()
      let shown = 0
      let accepted = 0
      for (const [key, entry] of Object.entries(data)) {
        if (!key.startsWith('kind:')) continue
        shown += Number(entry?.shown ?? 0)
        accepted += Number(entry?.accepted ?? 0)
      }
      return { shown, accepted, rate: shown === 0 ? null : accepted / shown }
    }

    /**
     * A proposal that already sits in the editor is stale. Right after Tab the
     * tracked draft lags a frame, so the dock used to show the just-inserted text
     * again as if it were a suggestion.
     */
// --- geometry.js — concatenated into client.js by dev/tools/build-client.mjs ---
    function proposalIsStale(proposal, editorText) {
      const left = String(proposal ?? '').replace(/\s+/g, '')
      const right = String(editorText ?? '').replace(/\s+/g, '')
      return left !== '' && right !== '' && left === right
    }

    /**
     * Does a request already in flight still cover this draft?
     *
     * The tail it is producing is appended to `requested`, so a draft that only
     * grew keeps that tail valid — cancelling it and starting over is what made
     * the ghost flicker on every keystroke. A draft that shrank or diverged is
     * not covered: that request can no longer be pasted anywhere.
     */
    function inFlightCovers(requested, draft) {
      if (typeof requested !== 'string' || requested === '') return false
      if (typeof draft !== 'string') return false
      return draft.length >= requested.length && draft.startsWith(requested)
    }

    /**
     * The Host joins on a trimmed base. A reply that echoes the untrimmed draft
     * must not put a stray newline into the proposal.
     */
    function rebaseItems(items, draft) {
      const raw = typeof draft === 'string' ? draft : ''
      const base = raw.replace(/\s+$/, '')
      if (raw === '' || base === raw) return items
      return items.map((item) => (typeof item === 'string' && item.startsWith(raw) ? base + item.slice(raw.length) : item))
    }

    /**
     * Best instant completion from the user's own past messages (zsh-style):
     * newest and most repeated first, slight preference for a shorter tail.
     * Pure and model-free — it is what fills the gap before the model answers.
     */
    function bestHistoryMatch(items, draft) {
      if (!Array.isArray(items) || items.length === 0) return null
      const base = typeof draft === 'string' ? draft.replace(/\s+$/, '') : ''
      if (base.length < 1) return null
      const counts = new Map()
      for (const item of items) {
        const text = typeof item === 'string' ? item : item?.text
        if (typeof text === 'string' && text !== '') counts.set(text, (counts.get(text) ?? 0) + 1)
      }
      /** @type {{ text: string, tail: string, score: number } | null} */
      let best = null
      items.forEach((item, index) => {
        const text = typeof item === 'string' ? item : item?.text
        if (typeof text !== 'string' || text === '') return
        if (!text.startsWith(base) || text.length <= base.length) return
        const tail = text.slice(base.length)
        const score = (index + 1) * 3 + (counts.get(text) ?? 1) * 8 - Math.min(20, tail.length / 4)
        if (best === null || score > best.score) best = { text, tail, score }
      })
      return best
    }

    /**
     * Which composer this plugin speaks for.
     *
     * `querySelector` returns the first one in the document, and a Session switch
     * briefly leaves two of them: the one being torn down and the one the user is
     * typing in. Picking the first meant every keystroke handler looked at the wrong
     * field and gave up — Tab moved focus, Esc did nothing. The focused composer
     * wins; without focus, the first one that is actually laid out.
     */
    const pickEditor = (nodes, active) => {
      const list = Array.isArray(nodes) ? nodes.filter((node) => node !== null && node !== undefined) : []
      if (list.length === 0) return null
      const owner = typeof active?.closest === 'function' ? active.closest('[data-composer-input]') : null
      if (owner !== null && list.includes(owner)) return owner
      for (const node of list) {
        try {
          const rect = node.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) return node
        } catch {
          // A node without layout cannot be the one being typed in.
        }
      }
      return list[0]
    }

    const editorEl = () => {
      if (typeof document.querySelectorAll !== 'function') return document.querySelector('[data-composer-input]')
      const nodes = Array.from(document.querySelectorAll('[data-composer-input]'))
      if (nodes.length === 0) return null
      return pickEditor(nodes, document.activeElement)
    }

    /** Draft text read straight from the composer, independent of prop updates. */
    /**
     * The draft as the DOM holds it. `textContent` drops `<br>` line breaks, so
     * the safety net would ask about a different draft than the user sees;
     * walking the nodes keeps the line structure.
     */
    const domDraft = () => {
      const editor = editorEl()
      if (editor === null) return ''
      let out = ''
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeName === 'BR') { out += '\n'; continue }
          if (child.nodeType === Node.TEXT_NODE) { out += child.nodeValue ?? ''; continue }
          walk(child)
        }
      }
      walk(editor)
      // Lexical keeps a trailing <br> as an empty-line placeholder; it is not
      // a character the user typed.
      return out.replace(/\u200b/g, '').replace(/\n$/, '')
    }

    /** Rect at the right edge of a text node's last character (a stable caret box). */
    function edgeOfText(textNode) {
      if (textNode === null || textNode.length === 0) return null
      const probe = document.createRange()
      try {
        probe.setStart(textNode, textNode.length - 1)
        probe.setEnd(textNode, textNode.length)
      } catch {
        return null
      }
      const rects = probe.getClientRects()
      if (rects.length === 0) return null
      const last = rects[rects.length - 1]
      if (last === undefined) return null
      return { left: last.right, right: last.right, top: last.top, bottom: last.bottom, width: 0, height: last.height }
    }

    /** Last non-empty text node inside `node`, depth-first. */
    function lastTextNodeOf(node) {
      if (node === null) return null
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let found = null
      while (walker.nextNode()) {
        const text = /** @type {Text} */ (walker.currentNode)
        if (text.length > 0) found = text
      }
      return found
    }

    /**
     * Caret box in viewport coordinates. A collapsed range often reports a
     * zero-size or line-start rect, so the caret is measured as the right edge
     * of the character before it, which is stable across browsers.
     */
    /**
     * A caret or glyph box in viewport coordinates. `fromBlock` marks a caret that
     * legitimately starts a line (after a trailing <br>).
     * @typedef {{ left: number, right?: number, top: number, bottom: number, width: number, height: number, fromBlock?: boolean }} CaretRect
     */

    /** @returns {CaretRect | null} */
    function caretRect() {
      const selection = window.getSelection?.()
      if (selection === null || selection === undefined || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      const root = editorEl()
      if (root === null || !root.contains(range.endContainer)) return null
      if (!range.collapsed) {
        const rects = range.getClientRects()
        const only = rects[rects.length - 1]
        return only === undefined
          ? null
          : { left: only.left, right: only.right, top: only.top, bottom: only.bottom, width: only.width, height: only.height }
      }
      const node = range.endContainer
      const offset = range.endOffset

      if (node.nodeType === Node.TEXT_NODE && offset > 0) {
        const probe = document.createRange()
        try {
          probe.setStart(node, offset - 1)
          probe.setEnd(node, offset)
        } catch {
          return null
        }
        const rects = probe.getClientRects()
        if (rects.length > 0) {
          const last = rects[rects.length - 1]
          if (last === undefined) return null
          return { left: last.right, right: last.right, top: last.top, bottom: last.bottom, width: 0, height: last.height }
        }
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        for (let index = Math.min(offset, node.childNodes.length) - 1; index >= 0; index -= 1) {
          const child = node.childNodes[index]
          if (child === undefined) continue
          // A <br> between the caret and the previous text means that text sits
          // on an earlier line: stop and anchor to the caret's own (empty) line.
          if (child.nodeName === 'BR') break
          if (child.nodeType === Node.ELEMENT_NODE) {
            const edge = edgeOfText(lastTextNodeOf(child))
            if (edge !== null) return edge
            continue
          }
          const edge = edgeOfText(child)
          if (edge !== null) return edge
        }
        // Caret after a trailing <br> (Chromium reports no rects at all here):
        // anchor to the empty line at the bottom of the caret's block.
        const element = /** @type {Element} */ (node)
        const box = element.getBoundingClientRect?.()
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 0
        if (box !== undefined && lineHeight > 2 && box.height >= lineHeight * 2) {
          // `fromBlock` marks a caret that legitimately starts a line, so the
          // caller must not "fix" its x with the previous character's edge.
          return { left: box.left, top: box.bottom - lineHeight, bottom: box.bottom, width: 0, height: lineHeight, fromBlock: true }
        }
      }

      const collapsed = range.getClientRects()
      if (collapsed.length > 0) {
        const last = collapsed[collapsed.length - 1]
        if (last !== undefined && (last.width > 0 || last.height > 0)) return last
      }
      if (node.nodeType === Node.ELEMENT_NODE && typeof /** @type {Element} */ (node).getBoundingClientRect === 'function') {
        const box = /** @type {Element} */ (node).getBoundingClientRect()
        if (box.width > 0 || box.height > 0) return box
      }
      const box = range.getBoundingClientRect()
      return box.width > 0 || box.height > 0 ? box : null
    }

    function caretAtEnd() {
      const root = editorEl()
      const selection = window.getSelection?.()
      if (root === null || selection === null || selection === undefined || selection.rangeCount === 0) return false
      const range = selection.getRangeAt(0)
      if (!range.collapsed) return false
      const probe = range.cloneRange()
      try {
        probe.selectNodeContents(root)
        probe.setStart(range.endContainer, range.endOffset)
      } catch {
        return false
      }
      return probe.toString().trim() === ''
    }

      /**
       * Where the caret sits relative to the text: 'end' when nothing follows it,
       * 'inside' when the user parked it mid-sentence, 'unknown' when it cannot be
       * measured. 'unknown' behaves like 'end' — a measurement failure must never
       * disable Tab.
       */
      function caretPlacement() {
        const root = editorEl()
        const selection = window.getSelection?.()
        if (root === null || selection === null || selection === undefined || selection.rangeCount === 0) return 'unknown'
        const range = selection.getRangeAt(0)
        if (!range.collapsed) return 'unknown'
        const rest = range.cloneRange()
        try {
          rest.selectNodeContents(root)
          rest.setStart(range.endContainer, range.endOffset)
        } catch {
          return 'unknown'
        }
        return rest.toString().trim() === '' ? 'end' : 'inside'
      }

// --- ghost-layer.js — concatenated into client.js by dev/tools/build-client.mjs ---
    /**
     * View-only inline ghost layer. It lives on <body> as a fixed layer, so the
     * composer's own overflow and stacking cannot clip it.
     */
    // The dock that owns the screen. A Session switch may leave the previous dock
    // mounted (the host keeps both panes alive), and two docks each with their own
    // layer will both paint into the one composer the user is typing in. Whoever
    // claimed last is the one on screen; everyone else goes quiet.
    let liveLayer = null


    function createGhostLayer(owner = '') {
      // The Session this layer belongs to. A dock that has been unmounted keeps a
      // reference to its layer for one more effect run, and mount() used to adopt
      // whatever composer was on screen at that moment: the old session's tail then
      // appeared in the new one (issue #10). Ownership is the fix, not timing.
      const ownSession = typeof owner === 'string' ? owner : ''
      const token = { session: ownSession }
      let host = null
      let textEl = null
      // 宿主自己管输入框高度：我们把 min-height 抬上去，让卡片跟着灰字长。
      // 抬过多少要记住，清理时还回去；宿主若把高度钉死，抬一次不长就收手。
      let restoreMinHeight = ''
      let grownFor = -1
      let growBlocked = false
      let growBudget = 200
      // 上一次 render 给的完整文本：截断会改写文本节点，量高度前必须先还原，
      // 否则下一帧量到的是「已经截断过的那一行」，永远长不高。
      let fullText = ''
      let textNode = null
      // Floats on the first line only: wrapped lines then start at the content edge.
      let spacerEl = null
      // 编辑框自己的 min-height，提案撑高之前先存下来。
      // Parent we made positioned, so its own style can be put back.
      let target = null
      let placeholderEl = null
      let placeholderDisplay = ''

      const restorePlaceholder = () => {
        if (placeholderEl !== null) {
          placeholderEl.style.display = placeholderDisplay
          placeholderEl = null
          placeholderDisplay = ''
        }
      }

      const hidePlaceholder = () => {
        const next = document.querySelector('[data-composer-placeholder]')
        if (next === null) return
        if (next !== placeholderEl) {
          restorePlaceholder()
          placeholderEl = next
          const placeholder = /** @type {HTMLElement} */ (next)
          placeholderDisplay = placeholder.style.display
          placeholder.style.display = 'none'
        }
      }

      const copyFont = (style) => {
        Object.assign(textEl.style, {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          direction: style.direction,
        })
      }

      /**
       * @param {number} left
       * @param {number} top
       * @param {number | null} width
       * @param {number | null} maxWidth
       * @param {string} align
       * @param {number | null} [maxHeight]
       */
      const place = (left, top, width, maxWidth, align, maxHeight = null) => {
        Object.assign(textEl.style, {
          // Sub-pixel precision: the origin is fractional, so rounding adds up.
            left: `${Math.round(left * 10) / 10}px`,
          top: `${Math.round(top * 10) / 10}px`,
          width: width === null ? 'auto' : `${Math.round(width)}px`,
          maxWidth: maxWidth === null ? 'none' : `${Math.round(maxWidth)}px`,
          // A fixed layer is not clipped by the editor: without a height limit a long
          // tail wrapped below the composer and painted over the page instead.
          maxHeight: maxHeight === null ? 'none' : `${Math.round(Math.max(18, maxHeight))}px`,
          textAlign: align,
        })
      }

      /**
       * Clip has to look like punctuation, not like a broken glyph: when the
       * composer shows one line and the tail needs two, cut the text and append an
       * ellipsis. Tab still inserts the whole proposal — only the preview shortens.
       */
      const fitToHeight = (limit) => {
        if (textEl === null || !(limit > 0)) return
        const full = textNode === null ? '' : textNode.nodeValue ?? ''
        if (full === '' || textEl.scrollHeight <= limit + 1) return
        const chars = Array.from(full)
        let low = 0
        let high = chars.length
        while (low < high) {
          const mid = Math.ceil((low + high) / 2)
          if (textNode !== null) textNode.nodeValue = `${chars.slice(0, mid).join('')}…`
          if (textEl.scrollHeight <= limit + 1) low = mid
          else high = mid - 1
        }
        if (textNode !== null) textNode.nodeValue = `${chars.slice(0, Math.max(1, low)).join('')}…`
      }

      /** The host's own origin: caret coordinates are viewport-relative. */
      const hostOrigin = () => {
        const rect = host === null ? null : host.getBoundingClientRect()
        return rect === null ? { left: 0, top: 0 } : { left: rect.left, top: rect.top }
      }
      const px = (value) => Number.parseFloat(value) || 0

      /**
       * 让输入框长到装得下灰字：只改 min-height，宿主自己的高度规则不动。
       * 抬了一次没长（宿主把高度钉死）就不再试，退回按可见框截断。
       */
      const growEditor = (wanted) => {
        if (target === null || target === undefined) return false
        const want = Math.ceil(wanted)
        if (!(want > 0)) return false
        const style = getComputedStyle(target)
        const box = target.getBoundingClientRect()
        const chrome = px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth)
        const have = Math.max(0, box.height - chrome)
        // 只差几个像素不算「装不下」：这时候去抬 min-height 只会把卡片越撑越大。
        if (want <= have + 2) {
          // 只在我们确实撑大过、而且这次真的小了一截时才还回去：否则
          // 「刚撑到刚好」的下一帧会被判成「不需要撑」，卡片就会来回跳。
          if (grownFor !== -1 && want < have - 16) {
            try {
              target.style.minHeight = restoreMinHeight
            } catch {}
            grownFor = -1
          }
          return false
        }
        if (growBlocked || growBudget <= 0) return false
        if (grownFor === want) return true
        const before = box.height
        try {
          target.style.minHeight = `${want + chrome}px`
        } catch {
          growBlocked = true
          return false
        }
        grownFor = want
        growBudget -= 1
        // 差一大截还没长，说明宿主把高度钉死了：这一次以后不再试，退回按可见框截断。
        if (want - have > 8 && target.getBoundingClientRect().height <= before + 1) {
          growBlocked = true
          try {
            target.style.minHeight = restoreMinHeight
          } catch {}
          grownFor = -1
          return false
        }
        return true
      }

      const layoutBox = () => {
        if (target === null || target === undefined) return false
        restoreFullText()
        const style = getComputedStyle(target)
        const rect = target.getBoundingClientRect()
        const clip = clipBox()
        const px = (value) => Number.parseFloat(value) || 0
        const left = Math.max(rect.left + px(style.borderLeftWidth) + px(style.paddingLeft), clip.left)
        const top = Math.max(rect.top + px(style.borderTopWidth) + px(style.paddingTop), clip.top)
        const origin = hostOrigin()
        const limit = viewportAllowance(top)
        place(
          left - origin.left,
          top - origin.top,
          Math.max(0, Math.min(rect.width - px(style.paddingLeft) - px(style.paddingRight), clip.right - left)),
          null,
          style.textAlign,
          limit,
        )
        copyFont(style)
        const padBox = px(style.paddingBottom) + px(style.borderBottomWidth)
        const grewBox = growEditor(top - rect.top + (textEl === null ? 0 : textEl.scrollHeight) + padBox)
        fitToHeight(grewBox ? limit : Math.max(24, Math.round(clip.bottom - top)))
      }

      /**
       * The box the ghost may paint inside: the nearest ancestor that really clips
       * (overflow) or draws the composer card. The editor itself is not a limit —
       * it grows taller than the visible card and scrolls.
       */
      const clipBox = () => {
        // 测试桩里可能还没有编辑器：没有目标就没有裁切框。
        if (target === null || target === undefined) return { left: 0, right: 0, top: 0, bottom: 0 }
        const targetRect = target.getBoundingClientRect()
        let node = target.parentElement
        for (let depth = 0; node !== null && depth < 8; depth += 1) {
          const style = getComputedStyle(node)
          const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible'
          const radius = Number.parseFloat(style.borderRadius) || 0
          if (clips || radius >= 8) {
            const rect = node.getBoundingClientRect()
            const px = (value) => Number.parseFloat(value) || 0
            return {
              left: rect.left + px(style.borderLeftWidth) + px(style.paddingLeft),
              right: rect.right - px(style.borderRightWidth) - px(style.paddingRight),
              top: rect.top + px(style.borderTopWidth) + px(style.paddingTop),
              bottom: rect.bottom - px(style.borderBottomWidth) - px(style.paddingBottom),
            }
          }
          node = node.parentElement
        }
        return { left: targetRect.left, right: targetRect.right, top: targetRect.top, bottom: targetRect.bottom }
      }

      /**
       * 灰字是宿主之外的一层浮层：真正限制它的不该是输入框的可见高度，而是屏幕。
       * 给「从这一行往下到视口底部」的余量，但不超过半屏——否则一条长建议会把
       * 后面的内容整块盖住。装不下时仍然用省略号收尾。
       */
      const viewportAllowance = (topPx) => {
        const viewport = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800
        const room = Math.max(24, viewport - 12 - topPx)
        return Math.max(24, Math.min(room, Math.round(viewport * 0.6)))
      }

      const layoutCaret = () => {
        if (target === null || target === undefined) return false
        restoreFullText()
        const style = getComputedStyle(target)
        const px = (value) => Number.parseFloat(value) || 0
        const box = target.getBoundingClientRect()
        const clip = clipBox()
        // A fixed layer is not clipped by the editor. The composer's visible box still
        // decides the wrapping width, but the height budget comes from the viewport.
        const contentLeft = Math.max(box.left + px(style.borderLeftWidth) + px(style.paddingLeft), clip.left)
        const contentRight = Math.min(box.right - px(style.borderRightWidth) - px(style.paddingRight), clip.right)

        let rect = caretRect()
        // A collapsed-range rect at the line start is a measurement failure, not a caret
        // at the start: fall back to the last character's right edge — unless the caret
        // really does start a line (empty line after a <br>).
        if (rect === null || (rect.fromBlock !== true && rect.left <= contentLeft + 2)) {
          const edge = edgeOfText(lastTextNodeOf(target))
          if (edge !== null) rect = edge
        }
        if (rect === null) return false
        // A character rect is the font box, not the line box, and the extra leading is
        // not split evenly (fonts carry more space below).
        const lineHeight = px(style.lineHeight) || rect.height
        const glyphHeight = rect.height || lineHeight
        const leading = Math.max(0, Math.round((lineHeight - glyphHeight) / 2))
        const origin = hostOrigin()
        const lineTop = rect.top - leading - origin.top
        const indentWidth = Math.max(0, rect.left - contentLeft)
        const blockWidth = Math.max(120, contentRight - contentLeft)
        // A full-width block starting at the content edge, with the caret offset carried
        // by a one-line float: wrapped lines fall back to the left edge instead of keeping
        // the caret's indent.
        // 可用高度只跟视口有关：灰字这一层本来就不在输入框里。
        const limit = viewportAllowance(rect.top - leading)
        place(contentLeft - origin.left, lineTop, blockWidth, null, 'left', limit)
        if (spacerEl !== null) {
          const line = Number.parseFloat(style.lineHeight) || rect.height || 24
          spacerEl.style.width = `${Math.round(indentWidth)}px`
          spacerEl.style.height = `${Math.round(line)}px`
        }
        copyFont(style)
        // 先把输入框撑到装得下灰字：灰字留在输入区里，不再另铺一层底板。
        const startTop = lineTop + origin.top
        const padBottom = px(style.paddingBottom) + px(style.borderBottomWidth)
        const grew = growEditor(startTop - box.top + (textEl === null ? 0 : textEl.scrollHeight) + padBottom)
        fitToHeight(grew ? limit : Math.max(24, Math.round(clip.bottom - startTop)))
        return true
      }

      // Only one layer may exist in the document: two docks on the same composer
      // each draw their own, and the one that mounted first leaves its node behind.
      // Mount was the only sweep, so a dock that never mounted again left a ghost
      // nothing could remove — not Esc, not a Session switch.
      const sweepOthers = () => {
        if (typeof document.querySelectorAll !== 'function') return
        for (const node of document.querySelectorAll('[data-composer-quill="layer"]')) {
          if (node !== host) node.remove()
        }
      }

      const restoreFullText = () => {
        if (textNode !== null && fullText !== '' && textNode.nodeValue !== fullText) {
          textNode.nodeValue = fullText
        }
      }

      const clear = () => {
        if (liveLayer === token) liveLayer = null
        if (host !== null) {
          host.remove()
          host = null
        }
        textEl = null
        fullText = ''
        if (target !== null && target !== undefined && target.style !== undefined) {
          // 输入框是我们撑高的：还回去，否则空会话会留一张高卡片。
          target.style.minHeight = restoreMinHeight
        }
        restorePlaceholder()
        target = null
      }

      const mount = () => {
        const editor = mine !== null && mine.isConnected ? mine : editorEl()
        if (editor === null) return false
        // A layer that is still attached belongs to some composer right now. If it is
        // not ours, this dock has been swapped out: painting here would put another
        // Session's suggestion into the field the user is typing in.
        // A previous mount can survive a body re-render as a detached node, and a
        // second dock instance would draw a second ghost: start clean.
        sweepOthers()
        target = editor
        restoreMinHeight = editor.style.minHeight || ''
        grownFor = -1
        growBlocked = false
        growBudget = 200
        host = document.createElement('div')
        host.setAttribute('data-composer-quill', 'layer')
        host.setAttribute('data-session', ownSession)
        host.setAttribute('aria-hidden', 'true')
        // On <body>, fixed: the composer's own overflow clipped the tail after two lines
        // no matter how much height the text wanted. A viewport-anchored layer cannot be
        // clipped by an ancestor, and `place()` already works in viewport coordinates.
        host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483000;pointer-events:none;'
        textEl = document.createElement('div')
        textEl.setAttribute('data-composer-quill', 'text')
        spacerEl = document.createElement('i')
        spacerEl.setAttribute('data-composer-quill', 'spacer')
        spacerEl.style.cssText = 'float:left;width:0;height:0;pointer-events:none;'
        textNode = document.createTextNode('')
        textEl.appendChild(spacerEl)
        textEl.appendChild(textNode)
        textEl.style.cssText = [
          'position:absolute',
          'white-space:pre-wrap',
          'word-break:break-word',
          'overflow-wrap:anywhere',
          'color:var(--dsw-alias-label-tertiary, #8a8f98)',
          'opacity:.9',
          'pointer-events:none',
          'user-select:none',
          'overflow:hidden',
          'display:none',
        ].join(';')
        host.appendChild(textEl)
        document.body.appendChild(host)
        return true
      }

      /** Facts about what landed in the DOM, for the paint diagnostic. */
      const debug = () => {
        const editor = editorEl()
        const style = textEl === null ? null : getComputedStyle(textEl)
        const textRect = textEl === null ? null : textEl.getBoundingClientRect()
        const editorRect = editor === null ? null : editor.getBoundingClientRect()
        return {
          editorFound: editor !== null,
          mounted: host !== null && host.isConnected,
          editorRect: editorRect === null ? null : {
            x: Math.round(editorRect.x), y: Math.round(editorRect.y),
            w: Math.round(editorRect.width), h: Math.round(editorRect.height),
          },
          textRect: textRect === null ? null : {
            x: Math.round(textRect.x), y: Math.round(textRect.y),
            w: Math.round(textRect.width), h: Math.round(textRect.height),
          },
          clip: (() => {
            const box = clipBox()
            return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) }
            })(),
          maxHeight: style === null ? null : style.maxHeight,
          minHeight: (() => { const editor = editorEl(); return editor === null ? null : editor.style.minHeight || '(none)' })(),
          ghostHeight: textEl === null ? null : textEl.scrollHeight,
          grownTo: (() => { const editor = editorEl(); return editor === null ? null : editor.style.minHeight || '(none)' })(),
          growBlocked,
          overflow: style === null ? null : style.overflow,
          color: style === null ? null : style.color,
          opacity: style === null ? null : style.opacity,
          display: style === null ? null : style.display,
          caret: (() => {
            const rect = caretRect()
            return rect === null ? null : { left: Math.round(rect.left), top: Math.round(rect.top), h: Math.round(rect.height) }
          })(),
        }
      }

      /**
       * Paint one frame. `anchor: 'box'` puts the text at the editor's content
       * box, `'caret'` at the caret, otherwise nothing is painted.
       */
      const render = ({ inlineText, anchor }) => {
        const text = typeof inlineText === 'string' ? inlineText : ''
        if (text === '') {
          clear()
          return
        }
        // A layer that was taken away must not come back. Whichever dock mounts first
        // after a Session switch removes the other's node; without this the replaced
        // dock's next paint adopted the new composer and put the old Session's tail
        // into the field the user is typing in (issue #10). A fresh mount is still
        // allowed: that is a layer that was never attached, or one that was cleared.
        if (host !== null && !host.isConnected) {
          clear()
          return
        }
        // Another dock claimed the screen after this one mounted: this layer belongs
        // to a Session that is no longer on display, so it has nothing to say here.
        if (liveLayer !== null && liveLayer !== token) {
          clear()
          return
        }
        if (host === null) {
          if (!mount()) return
        }
        if ((mine !== null && mine.isConnected ? mine : editorEl()) !== target) {
          clear()
          if (!mount()) return
        }
        const changed = text !== fullText
        fullText = text
        if (changed) {
          growBlocked = false
          growBudget = 200
        }
        if (textNode !== null && textNode.nodeValue !== text) textNode.nodeValue = text
        textEl.style.display = ''
        hidePlaceholder()
        if (anchor === 'caret' && layoutCaret()) return
        layoutBox()
      }

      /** Remove every layer in the document, including ones this instance never made. */
      const sweep = () => {
        if (typeof document.querySelectorAll !== 'function') return
        for (const node of document.querySelectorAll('[data-composer-quill="layer"]')) node.remove()
        host = null
        textEl = null
        target = null
      }

      // The composer this dock belongs to. Set at paint time from the dock's own chip,
      // so a dock the host kept alive cannot paint into a different Session's field.
      let mine = null

      /** Point this layer at the composer it belongs to (null = none on screen). */
      const bind = (composer) => {
        mine = composer !== null && composer !== undefined && composer.isConnected !== false ? composer : null
        return mine !== null
      }

      /** Take the screen: drop every layer in the document, including our own. */
      const claim = () => {
        // Idempotent on purpose: StrictMode runs mount effects twice, and a second claim
        // by the same owner must not look like a takeover to the callers above.
        const took = liveLayer !== token
        liveLayer = token
        sweep()
        return took
      }

      /** Give the screen back when this dock goes away. */
      const release = () => {
        if (liveLayer === token) liveLayer = null
        return true
      }

      return { render, clear, sweep, claim, release, bind, isMounted: () => host !== null && host.isConnected, debug }
    }

// --- hooks.js — concatenated into client.js by dev/tools/build-client.mjs ---
    let idleGhostStore = null
    let defaultConfigStore = null
    const idleGhost = () => (idleGhostStore ??= {
      getSnapshot: () => IDLE,
      subscribe: () => () => {},
      cancel: () => {},
      clear: () => {},
      cycle: () => {},
      begin: () => new AbortController(),
      streamStart: () => new AbortController(),
      streamModeSet: () => {},
      streamRetract: () => {},
      streamDelta: () => {},
      streamFinal: () => {},
      streamDone: () => {},
      streamFail: () => {},
      settle: () => {},
      fail: () => {},
    })
    const defaultConfig = () => (defaultConfigStore ??= createConfigStore())

    /** Composer-dock entry. */
      /**
       * The one-line status row: pending, failure, a suggestion, or the key hints.
       * Pure, so the dock render stays a layout description.
       */
      function renderStatusChip(input) {
        const { t, hintKey, statusText, failureText, position, running, chipStyle } = input
        const kind = statusChipKind({ pending: input.pendingAny, failure: failureText, empty: input.emptyReady === true, undo: input.undoReady === true, suggestion: statusText })
        if (kind === 'pending') {
          return h('span', {
            'data-composer-quill': 'dock-pending',
            style: { ...chipStyle, borderStyle: 'dotted', opacity: 0.7 },
          }, t('hint.pending'))
        }
        if (kind === 'error') {
          return h('button', {
            type: 'button',
            'data-composer-quill': 'dock-error',
            title: failureText,
            disabled: running,
            onClick: () => input.onRetry(),
            style: { ...chipStyle, borderStyle: 'dashed', opacity: running ? 0.6 : 0.85, cursor: running ? 'default' : 'pointer' },
          }, `${t('hint.error')}：${failureText.length > 60 ? `${failureText.slice(0, 60)}…` : failureText} · ${t(running ? 'hint.retrying' : 'hint.retry')}`)
        }
        if (kind === 'empty') {
          return h('span', {
            'data-composer-quill': 'dock-empty',
            style: { ...chipStyle, borderStyle: 'none', opacity: 0.8 },
          }, t('hint.empty'))
        }
        if (kind === 'undo') {
          return h('button', {
            type: 'button',
            'data-composer-quill': 'dock-undo',
            title: t('hint.undo'),
            onClick: () => input.onUndo(),
            style: { ...chipStyle, cursor: 'pointer' },
          }, `${t('hint.accepted')} · ${t('hint.undo')}`)
        }
        if (kind === 'suggestion') {
          return h('button', {
            type: 'button',
            'data-composer-quill': 'dock-suggestion',
            title: t(hintKey),
            onClick: () => input.onAccept(),
            style: { ...chipStyle, cursor: 'pointer' },
          }, `${t(hintKey)}：${statusText.length > 72 ? `${statusText.slice(0, 72)}…` : statusText}${position}`)
        }
        return h('span', {
          'data-composer-quill': 'dock-hint',
          style: { ...chipStyle, borderStyle: 'none', color: 'var(--dsw-alias-label-tertiary, #8a8f98)', opacity: 0.75 },
        }, t(running ? 'hint.busy' : 'hint.keys'))
      }

    /** The dock's booking, kept in a ref: it drives effects, not layout. */
    function useDockBooking() {
      const [booking, send] = React.useReducer(dockReducer, undefined, createDockBooking)
      const current = React.useRef(booking)
      current.current = booking
      // Apply locally as well: a caller reads the booking immediately after sending,
      // and the next render is too late for that.
      const dispatch = React.useCallback((action) => {
        current.current = dockReducer(current.current, action)
        send(action)
      }, [send])
      return { booking: current, send: dispatch }
    }

    /**
     * What a screen reader hears, and when. A 500ms tail means the text has settled
     * before it is announced: a streamed delta must not interrupt the last sentence.
     */
    function useDockAnnouncement(input) {
      const [announcement, setAnnouncement] = React.useState('')
      const timer = React.useRef(null)
      React.useEffect(() => {
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          timer.current = null
          setAnnouncement(describeAnnouncement({
            t: input.t,
            status: input.status,
            failure: input.failure,
            busy: input.busy,
          }))
        }, 500)
        return () => {
          if (timer.current !== null) {
            clearTimeout(timer.current)
            timer.current = null
          }
        }
      }, [input.status, input.failure, input.busy])
      return announcement
    }

    /**
     * One trace line per decided state, so a silent row has a record of the exact
     * inputs that produced it. Also remembers what reached the screen, so a later
     * accept or reject can be attributed to it.
     */
    function useDockStateReport(input) {
      const last = React.useRef('')
      React.useEffect(() => {
        if (last.current === input.decisionKey) return
        last.current = input.decisionKey
        input.report('dock-state', {
          sessionId: input.sessionId,
          hasSession: input.session !== undefined && input.session !== null,
          running: input.running,
          draftLength: input.draft.length,
          detail: JSON.stringify({
            phase: input.state.phase,
            kind: input.state.kind,
            items: input.state.items.length,
            index: input.state.index,
            forDraftLength: input.state.request !== null && input.state.request !== undefined ? input.state.request.draft.length : null,
            nextActive: input.nextActive,
            composeActive: input.composeActive,
            pendingCompose: input.pendingCompose,
            pendingNext: input.pendingNext,
            statusLength: input.statusText.length,
          attachments: input.attachmentCount,
          attachmentIds: input.attachmentIds,
          attachmentNote: input.attachmentNote,
            // A frame whose session had moved on is dropped; if this is ever
            // non-zero the race is real and worth chasing in the log.
            droppedFrames: input.droppedFrames ?? 0,
            suppressRewrites: input.suppress?.on === true,
            ignoredStreak: input.suppress?.streak ?? 0,
            historyActive: input.historyActive,
            historyItems: input.history.items.length,
            draftEmpty: input.draftEmpty,
            sameSession: input.state.sessionId === input.sessionId,
            layers: layerStats().layers,
            enabled: input.enabled,
          }),
        })
        // Remember what reached the screen so an accept/reject can be attributed.
        if (input.shown !== '') {
          input.learnedShown.current = {
            features: featuresOf(input.shown, input.nextActive ? 'next' : 'compose'),
            at: Date.now(),
            consumed: false,
          }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [input.decisionKey])
    }

    /**
     * Local history is what makes the composer feel instant: one cheap read per
     * Session, then every keystroke is matched without a model in the loop. A Session
     * the Host has not loaded yet answers 409, so the read retries quietly.
     */
    function useComposerHistory(sessionId) {
      const [history, setHistory] = React.useState({ sessionId: null, items: [] })
      const historyRef = React.useRef(history)
      historyRef.current = history
      // Bumped when a turn finishes, so the history matrix picks up new messages.
      const [epoch, setEpoch] = React.useState(0)
      React.useEffect(() => {
        if (sessionId === null) return undefined
        const controller = new AbortController()
        let cancelled = false
        let attempt = 0
        let retry = null
        const load = () => {
          fetchHistory(sessionId, controller.signal)
            .then((items) => {
              if (cancelled) return
              setHistory({ sessionId, items })
            })
            .catch((error) => {
              if (cancelled || controller.signal.aborted) return
              if (error?.status !== 409 || attempt >= 3) return
              attempt += 1
              // Three tries over ~17s: a session that is about to become live does so
              // quickly, and six tries per mount turned into dozens of 409s a day.
              retry = setTimeout(load, [1000, 4000, 12000][attempt - 1] ?? 12000)
            })
        }
        load()
        return () => {
          cancelled = true
          if (retry !== null) clearTimeout(retry)
          controller.abort()
        }
      }, [sessionId, epoch])
      return { history, historyRef, bumpHistoryEpoch: () => setEpoch((value) => value + 1) }
    }

    /**
     * Paints the inline ghost and keeps it in sync with the composer: streamed text,
     * resizes, caret moves, and dialogs that cover it.
     */
    function useGhostPaint(input) {
      const { visible, ghost, ghostLayer, paintData, dockBooking, sendDock, report, sessionId } = input
    // Paint the inline ghost while something is visible.
    // Painting belongs to one Session: a switch must not leave the previous ghost on
    // screen while the new composer is being filled in.
    const paintedSession = React.useRef(sessionId)
    // A dock that has just mounted is the one on screen: it takes the layer from any
    // dock the host left alive behind it, so a stale Session cannot paint here.
    React.useEffect(() => {
      if (typeof ghostLayer.claim === 'function') ghostLayer.claim()
      return () => { if (typeof ghostLayer.release === 'function') ghostLayer.release() }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ghostLayer])
    React.useEffect(() => {
      if (paintedSession.current !== sessionId) {
        paintedSession.current = sessionId
        // The pane showing this Session is now the one on screen: take the layer
        // ownership away from whichever dock was drawing before it (issue #10).
        if (typeof ghostLayer.claim === 'function') ghostLayer.claim()
        ghostLayer.clear()
        return undefined
      }
      if (!visible) {
        ghostLayer.clear()
        return undefined
      }
    const overlayBlocking = () => {
      // The layer is fixed with a high z-index: without this it painted grey text
      // over dialogs opened from the sidebar. A dialog that contains the composer
      // itself (some hosts nest it) must not count.
      const editor = editorEl()
      const dialogs = typeof document.querySelectorAll === 'function'
  ? document.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')
  : []
      for (const node of dialogs) {
        if (editor !== null && node.contains(editor)) continue
        const rect = node.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) return true
      }
      return false
    }
      // Not a hook: this lives in an effect closure, where hooks are illegal.
      let skippedFor = null
      // Which composer this dock last bound to. The host rebuilds the pane on a
      // Session switch, so the node can be replaced under us; the observer below
      // repaints only when the answer to "where do I paint" really changed.
      const paint = () => {
        if (overlayBlocking()) {
          ghostLayer.clear()
          return
        }
        const data = paintData.current
        // Only the composer holding this dock's own chip may receive a ghost. The host
        // keeps a replaced dock mounted, and `editorEl()` would hand it whatever
        // composer is first in the document — that is how one Session's tail showed up
        // in another Session's empty field.
        const mine = composerForDock(data.sessionId)
        if (typeof ghostLayer.bind === 'function' && !ghostLayer.bind(mine)) {
          ghostLayer.clear()
          // Say so once per Session instead of going quiet: a dock that cannot find
          // its composer would otherwise look exactly like "no suggestion right now".
          if (skippedFor !== data.sessionId) {
            skippedFor = data.sessionId
            report('paint-skip', { sessionId: data.sessionId, reason: 'no-composer' })
          }
          return
        }
        skippedFor = null
        let anchor = 'none'
        // The host reports the draft from its own state, and the editor keeps the
        // previous Session's text until the swap lands: believing the prop alone paints
        // the ghost over text that is still there. Read the editor too.
        const editorText = (() => {
          const editor = mine ?? editorEl()
          if (editor === null) return ''
          return typeof editor.value === 'string' ? editor.value : (editor.textContent ?? '')
        })()
        const editorEmpty = editorText.trim() === ''
        if (data.nextActive && editorEmpty) {
          anchor = 'box'
          ghostLayer.render({ inlineText: data.current, anchor: 'box' })
        } else if (data.composeActive && data.proposalIsTail && caretAtEnd()) {
          // Trim at paint time against the text that is really in the editor.
          // Between a keystroke and the render that follows it this data is one
          // draft behind, and painting it would put the character the user just
          // typed on screen a second time.
          anchor = 'caret'
          ghostLayer.render({ inlineText: followRemainder(data.fullText, editorText.replace(/\s+$/, '')), anchor: 'caret' })
        } else if (data.historyActive && caretAtEnd()) {
          anchor = 'caret'
          ghostLayer.render({ inlineText: data.proposal, anchor: 'caret' })
        } else {
          // A rewrite of existing text has no single insertion point: it is
          // previewed in the dock row and applied as a whole draft.
          ghostLayer.render({ inlineText: '' })
        }
        // Structural only: the proposal text changes on every streamed delta.
        // Keying on the text meant one POST and one log line per frame.
        const paintKey = `${data.kind}|${data.forDraft}|${anchor}`
        if (dockBooking.current.painted !== paintKey) {
          sendDock({ type: 'painted', key: paintKey })
          report('paint', {
            sessionId: data.sessionId,
            draftLength: data.draftLength,
            // The proposal is the user's own text; a length cannot leak a draft.
            detail: JSON.stringify({
              anchor,
              proposalChars: String(data.proposal).length,
              layers: layerStats().layers,
              layerSessions: layerStats().sessions.join(','),
              ...ghostLayer.debug(),
            }),
          })
        }
      }
      // A keystroke has to reach the screen in the same task that changes the row,
      // or the row and the ghost disagree for a frame about which tail they describe.
      paintData.paintNow = paint
      paint()
    const onFocusChange = () => {
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(paint)
      else paint()
    }
    document.addEventListener('focusin', onFocusChange, true)
    document.addEventListener('focusout', onFocusChange, true)
      if (typeof ResizeObserver !== 'function' || typeof MutationObserver !== 'function') return undefined
      let frame = null
      const schedulePaint = () => {
        if (frame !== null) return
        frame = window.requestAnimationFrame(() => {
          frame = null
          paint()
        })
      }
      // Streamed text changes the proposal without changing visibility: without
      // this subscription the ghost stopped at its first delta.
      const unsubscribe = typeof ghost.subscribe === 'function' ? ghost.subscribe(schedulePaint) : () => {}
      const resize = new ResizeObserver(schedulePaint)
      const editor = editorEl()
      if (editor !== null) {
        resize.observe(editor)
        if (editor.parentElement !== null) resize.observe(editor.parentElement)
      }
      // Only the composer can move the caret: watching the whole document woke
      // this up for every streamed token elsewhere on the page.
      const mutations = new MutationObserver(schedulePaint)
      if (editor !== null) mutations.observe(editor, { childList: true, subtree: true, characterData: true })
      // No tree observer here on purpose: the slow DOM poll below already notices a
      // rebuilt field and re-queues the request, so a second mechanism would only
      // add mutations to react to without a case of its own to prove it.
      window.addEventListener('resize', schedulePaint)
      window.addEventListener('scroll', schedulePaint, true)
      document.addEventListener('selectionchange', schedulePaint)
      return () => {
        unsubscribe()
        mutations.disconnect()
        resize.disconnect()
        window.removeEventListener('resize', schedulePaint)
        window.removeEventListener('scroll', schedulePaint, true)
        document.removeEventListener('selectionchange', schedulePaint)
        document.removeEventListener('focusin', onFocusChange, true)
        document.removeEventListener('focusout', onFocusChange, true)
        if (frame !== null) window.cancelAnimationFrame(frame)
        if (paintData.paintNow === paint) paintData.paintNow = null
        // The layer lives exactly as long as this effect: when the Session pane goes
        // away the dock is unmounted, and a layer left behind keeps painting the old
        // suggestion into whatever composer takes its place (issue #10, third report).
        ghostLayer.clear()
      }
    }, [visible, ghost, ghostLayer, sessionId])
    }

    /**
     * Shortcuts and edit events, restricted to the composer: Tab accepts, Esc dismisses,
     * arrows cycle, Ctrl+Shift+Space asks by hand. IME composition suppresses all of it.
     */
    function useComposerKeys(input) {
      const { visible, nextActive, items, ghost, ghostLayer, dismissAll, acceptRef, composing, latest, lastRequested, request, sendDock } = input
    // Shortcuts and edit events, restricted to the composer.
    React.useEffect(() => {
      const inEditor = (node) => {
        const root = editorEl()
        return root !== null && (node === root || root.contains(node))
      }
      const onEdit = (event) => {
        // Only the composer's own IME session may suppress Tab: a composition
        // anywhere else on the page must not disarm this plugin.
        if (!inEditor(event.target)) return
        if (event.type === 'compositionstart') {
          composing.current = true
          ghostLayer.clear()
        }
      }
      const onCompositionEnd = () => { composing.current = false }
      const onKeyDown = (event) => {
        if (event.defaultPrevented || composing.current || event.isComposing || event.keyCode === 229) return
        if (!inEditor(document.activeElement)) return
        // Manual trigger: works even when automatic suggestions are off.
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.code === 'Space' || event.key === ' ')) {
          const live = latest.current
          if (!live.enabled || live.sessionId === null || live.draft.trim().length < MIN_DRAFT_CHARS) return
          event.preventDefault()
          event.stopPropagation()
          // Claim this draft: leaving it null lets the 700 ms safety net
          // cancel and restart the request we just started.
          lastRequested.current = requestSignature(live.draft, live.attachmentKey)
          request('compose', live.draft)
          return
        }
        if (event.key === 'Enter') { dismissAll(); return }
        if (event.key === 'Escape') {
          const residue = typeof document.querySelector === 'function'
            && document.querySelector('[data-composer-quill="layer"]') !== null
          const phase = typeof ghost.getSnapshot === 'function' ? ghost.getSnapshot().phase : 'idle'
          if (closeOnEscape({ visible, residue, phase })) {
            event.preventDefault()
            event.stopPropagation()
            if (visible && latest.current.draft.trim() !== '') sendDock({ type: 'dismissed', draft: latest.current.draft })
            dismissAll()
          }
          return
        }
        if (!visible) return
        if (isAcceptKey(event)) {
          if (acceptRef.current(true)) {
            event.preventDefault()
            event.stopPropagation()
          }
          return
        }
        if (nextActive && items.length > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault()
          event.stopPropagation()
          ghost.cycle(event.key === 'ArrowRight' ? 1 : -1)
        }
      }
      const editEvents = ['beforeinput', 'input', 'paste', 'drop', 'compositionstart']
      for (const type of editEvents) window.addEventListener(type, onEdit, true)
      window.addEventListener('compositionend', onCompositionEnd, true)
      window.addEventListener('keydown', onKeyDown, true)
      return () => {
        for (const type of editEvents) window.removeEventListener(type, onEdit, true)
        window.removeEventListener('compositionend', onCompositionEnd, true)
        window.removeEventListener('keydown', onKeyDown, true)
      }
    }, [visible, nextActive, items.length, ghost, ghostLayer, dismissAll])
    }

    /**
     * The request machinery: who may ask the Host for a prediction, and how. Owns the
     * timers, the 409 backoff, the one-retry-per-draft budget and the unmount cleanup;
     * the bookkeeping refs stay with the caller, so nothing is created twice.
     */
    function useGhostRequests(input) {
      const {
        ghost, ghostLayer, latest, state, draft, enabled, composeEnabled, running, sessionId,
        dockBooking, sendDock, report, stopTimer, domDraft, refs,
      } = input
      // The caller owns every one of these: the Session effect, the typing effect and
      // the keys hook read and write them too. One object, one owner, no second copy.
      const {
        timer, lastRequested, retriedFor, composing, notLive, servedFromStore, lastCall, historyRef,
      } = refs
      const requestRef = React.useRef(null)
      const liveBlocked = () => Date.now() < notLive.current.until
      const markNotLive = () => {
        const state = notLive.current
        state.attempts = Math.min(state.attempts + 1, 6)
        const delay = Math.min(15000, 700 * 2 ** (state.attempts - 1))
        state.until = Date.now() + delay
        if (state.timer !== null) clearTimeout(state.timer)
        // Clear the claim so the safety net re-asks once the backoff expires.
        state.timer = setTimeout(() => {
          state.timer = null
          lastRequested.current = null
          const live = latest.current
          if (!live.enabled || live.running || live.manual || live.sessionId === null) return
          // The safety net only asks about non-empty drafts, so an empty composer
          // would never recover without this explicit retry.
          if (live.draftEmpty) requestRef.current?.('next', '', true)
        }, delay + 50)
      }
      const markLive = () => {
        const state = notLive.current
        if (state.timer !== null) clearTimeout(state.timer)
        state.timer = null
        state.until = 0
        state.attempts = 0
      }
  
      // A request that was just answered for the same draft is reused instead of
      // repeated, and two triggers aimed at the same draft within a moment share
      // one network call.
        // Set when the store answered: nothing may be re-sampled for that key.
      // Compose streams: deltas land as they arrive and are repainted once per frame,
      // so the ghost starts growing immediately. Split out of request().
      const composeStream = React.useCallback((live, draftNow) => {
          lastRequested.current = requestSignature(draftNow, live.attachmentKey)
          const request = ghost.newRequest(live.sessionId, draftNow, live.attachmentKey)
          const active = ghost.streamStart(request, 'compose')
          let idle = null
          let buffer = ''
          let frame = null
          const flush = () => {
            if (frame !== null) {
              if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
              else clearTimeout(frame)
              frame = null
            }
            if (buffer !== '') {
              const text = buffer
              buffer = ''
              ghost.streamDelta(text, request)
            }
          }
          const queue = (text) => {
            buffer += text
            if (frame !== null) return
            frame = typeof window.requestAnimationFrame === 'function'
              ? window.requestAnimationFrame(() => { frame = null; flush() })
              : setTimeout(() => { frame = null; flush() }, 16)
          }
          const bump = () => {
            if (idle !== null) clearTimeout(idle)
            idle = setTimeout(() => {
              active.abort()
              ghost.streamFail('timed out', request)
            }, live.timeoutMs || CLIENT_TIMEOUT_MS)
          }
          bump()
          streamRoute(ROUTE, { sessionId: live.sessionId, draft: draftNow, mode: 'compose', attachments: live.attachments ?? [], attachmentTotal: live.attachmentTotal ?? 0, beacons: beaconTally() }, active.signal, {
            start: (data) => {
              bump()
              // Keep whatever is on screen: the first delta replaces it.
              ghost.streamModeSet?.(data?.mode)
            },
            retract: (data) => {
              bump()
              flush()
              ghost.streamRetract(data?.mode === 'append' ? 'append' : 'full', request)
            },
            delta: (data) => {
              bump()
              if (typeof data?.text === 'string') queue(data.text)
            },
            final: (data) => {
              bump()
              flush()
              if (typeof data?.text === 'string') ghost.streamFinal(data.text, data?.mode, request)
              if (ghost.takeSuppressed?.() === true) report('suppressed', { sessionId: live.sessionId, detail: 'rewrite' })
            },
            done: (data) => {
              flush()
              markLive()
              ghost.streamDone(data ?? {}, request)
              // Most compose suggestions arrive over SSE: persist them too, or
              // only the JSON fallback would ever be reused.
              const settled = ghost.getSnapshot()
              if (settled.kind === 'compose' && settled.items.length > 0) {
                const settledDraft = settled.request !== null && settled.request !== undefined ? settled.request.draft : ''
                saveSuggestion(settled.sessionId, 'compose', settledDraft, settled.items, `${historyRef.current.items.length}`, settled.mode)
              }
            },
            error: (data) => {
              const message = typeof data?.message === 'string' ? data.message : 'stream failed'
              ghost.streamFail(message, request)
              report('compose-failed', { sessionId: live.sessionId, draftLength: draftNow.length, detail: message.slice(0, 300) })
            },
            json: (body) => {
              const items = rebaseItems(typeof body?.text === 'string' && body.text !== '' ? [body.text] : [], draftNow)
              ghost.settle(request, active, 'compose', items)
              saveSuggestion(live.sessionId, 'compose', draftNow, items, `${historyRef.current.items.length}`, typeof body?.mode === 'string' ? body.mode : '')
            },
          }).catch((error) => {
            if (active.signal.aborted) return
            // The Host has not loaded this Session yet: not a failure.
            if (error?.status === 409) {
              ghost.clear(live.sessionId ?? undefined)
              markNotLive()
              report('not-live', { sessionId: live.sessionId, detail: 'compose' })
              return
            }
            const message = error instanceof Error ? error.message : String(error)
            ghost.streamFail(message, request)
            report('compose-failed', { sessionId: live.sessionId, draftLength: draftNow.length, detail: message.slice(0, 300) })
          }).finally(() => {
            if (idle !== null) clearTimeout(idle)
            if (frame !== null) {
              if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
              else clearTimeout(frame)
              frame = null
            }
          })
          return
      }, [ghost])   // only refs and stable helpers are touched: a first-render capture is safe
  
      // The JSON path: one call, one settled answer. Split out of request().
      const nextJson = React.useCallback((live, draftNow, mode, kind) => {
        const request = ghost.newRequest(live.sessionId, draftNow, live.attachmentKey)
        const active = ghost.begin(request, kind)
        const deadline = setTimeout(() => {
          active.abort()
          ghost.fail(request, active, kind, 'timed out')
        }, live.timeoutMs || CLIENT_TIMEOUT_MS)
        active.signal.addEventListener('abort', () => clearTimeout(deadline), { once: true })
        Promise.resolve()
          .then(() => callRoute(ROUTE, { sessionId: live.sessionId, draft: draftNow, mode, attachments: live.attachments ?? [], attachmentTotal: live.attachmentTotal ?? 0, beacons: beaconTally() }, active.signal))
          .then((body) => {
            if (active.signal.aborted) return
            markLive()
            const items = mode === 'next'
              ? (Array.isArray(body?.candidates) ? body.candidates : [])
              : rebaseItems(typeof body?.text === 'string' && body.text !== '' ? [body.text] : [], draftNow)
            // "Nothing to suggest" is an answer too: a stored line from an older
            // turn must not outlive it, or the next mount would hand it back.
            if (mode === 'next' && items.length === 0) {
              // Remember that this question has no answer: the next mount must not
              // resurrect an older line from storage.
              clearSessionSuggestions(live.sessionId)
              markNoSuggestion(live.sessionId, kind, draftNow)
            }
            ghost.settle(request, active, kind, items)
            saveSuggestion(live.sessionId, kind, draftNow, items, `${historyRef.current.items.length}`, kind === 'next' ? 'full' : '')
          }, (error) => {
            if (active.signal.aborted) return
            if (error?.status === 409) {
              ghost.clear(live.sessionId ?? undefined)
              markNotLive()
              report('not-live', { sessionId: live.sessionId, detail: mode })
              return
            }
            const message = error instanceof Error ? error.message : String(error)
            ghost.fail(request, active, kind, message)
            report('compose-failed', { sessionId: live.sessionId, draftLength: draftNow.length, detail: `${mode}: ${message}`.slice(0, 300) })
            try { console.warn('[composer-quill] request failed:', mode, message) } catch { /* no console */ }
          })
          .finally(() => clearTimeout(deadline))
      }, [ghost])   // only refs and stable helpers are touched: a first-render capture is safe
  
      /** The draft a scheduled request is about to ask for, and until when. */
      const claim = React.useRef({ key: '', until: 0 })

      const request = React.useCallback((mode, forDraft, force = false, delayOverride = null) => {
        stopTimer()
        // Claim the draft now, not when the call actually starts: the safety net polls
        // on its own clock and must see the pending request even before it fires.
        const claimDraft = mode === 'next' ? '' : (forDraft || latest.current.draft)
        const claimDelay = delayOverride ?? (mode === 'next' ? NEXT_DEBOUNCE_MS : latest.current.debounceMs)
        claim.current = { key: `${mode}|${claimDraft}`, until: Date.now() + claimDelay + 400 }
        timer.current = setTimeout(() => {
          timer.current = null
          claim.current = { key: '', until: 0 }
          const live = latest.current
          // One snapshot, read once: the gates below share it, exactly as the
          // hand-written chain did (two reads could disagree mid-flight).
          const stored = ghost.getSnapshot()
          const now = Date.now()
          const verdict = gateFor({
            mode,
            forDraft,
            force,
            now,
            live: {
              enabled: live.enabled,
              nextEnabled: live.nextEnabled,
              composeEnabled: live.composeEnabled,
              sessionId: live.sessionId,
              running: live.running,
              draftEmpty: live.draftEmpty,
              draft: live.draft,
            },
            blockedUntil: notLive.current.until,
            served: servedFromStore.current,
            lastCall: lastCall.current,
            stored: {
              sessionId: stored.sessionId,
              kind: stored.kind,
              request: stored.request,
              phase: stored.phase,
            },
            dismissed: dockBooking.current.dismissed,
            attachmentKey: live.attachmentKey ?? '',
          })
          const draftNow = verdict.draftNow
          for (const effect of verdict.effects) {
            if (effect.type === 'report') {
              report(effect.name, { sessionId: live.sessionId, draftLength: draftNow.length, detail: effect.detail })
              continue
            }
            if (effect.type === 'mark-last-call') {
              lastCall.current = { key: verdict.key, at: now }
              continue
            }
            if (effect.type === 'reschedule') {
              timer.current = setTimeout(() => {
                timer.current = null
                request(mode, forDraft, force)
              }, effect.wait)
            }
          }
          if (verdict.verdict !== 'send') return
          const kind = mode === 'next' ? 'next' : 'compose'
  
          // Compose streams: deltas land as they arrive and are repainted once
          // per frame, so the ghost starts growing immediately.
          if (mode === 'compose') {
            composeStream(live, draftNow)
            return
          }
  
          nextJson(live, draftNow, mode, kind)
        }, delayOverride ?? (mode === 'next' ? NEXT_DEBOUNCE_MS : latest.current.debounceMs))
      }, [stopTimer, ghost, composeStream, nextJson])
      requestRef.current = request
  
      const retryTimer = React.useRef(null)
      React.useEffect(() => {
        if (!composeEnabled || running || sessionId === null) return undefined
        if (state.phase !== 'error' || state.kind !== 'compose') return undefined
        const failedFor = state.request !== null && state.request !== undefined ? state.request.draft : ''
        if (failedFor !== draft || retriedFor.current === draft) return undefined
        retriedFor.current = draft
        // The timer lives in a ref: a deps change (the store moving, the draft
        // growing) must not silently swallow the one retry this draft gets.
        if (retryTimer.current !== null) clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null
          request('compose', draft)
        }, 1200)
        return () => {
          if (retryTimer.current !== null) {
            clearTimeout(retryTimer.current)
            retryTimer.current = null
          }
        }
      }, [state.phase, state.kind, state.request, draft, enabled, running, sessionId, request])
      React.useEffect(() => () => {
        stopTimer()
        if (retryTimer.current !== null) clearTimeout(retryTimer.current)
        if (notLive.current.timer !== null) clearTimeout(notLive.current.timer)
        ghost.cancel()
        ghost.clear()
        ghostLayer.clear()
      }, [stopTimer, ghost, ghostLayer])
  // Safety net: read the draft straight from the DOM on a slow interval. The dock can
  // be remounted or skip a prop update while the host streams a turn.
        React.useEffect(() => {
          if (typeof window.setInterval !== 'function') return undefined
          const interval = window.setInterval(() => {
            const live = latest.current
            if (!live.composeEnabled || live.running || live.sessionId === null || live.manual) return
            if (composing.current) return
            const text = domDraft()
            if (text.trim().length < MIN_DRAFT_CHARS) return
            if (dockBooking.current.switched !== null) {
              if (text === dockBooking.current.switched) return
              sendDock({ type: 'switch-settled' })
            }
            // A debounced request for this draft is already scheduled: that is a fact,
            // not a heuristic, so the poll must not queue a second one.
            if (claimBlocksRetrigger(claim.current, text, Date.now())) {
              report('retrigger-skipped', { sessionId: live.sessionId, draftLength: text.length, detail: 'claim' })
              return
            }
            if (requestSignature(text, live.attachmentKey) === lastRequested.current) return
            if (dockBooking.current.dismissed === text) return
            const pending = ghost.getSnapshot()
            const pendingDraft = pending.request !== null && pending.request !== undefined ? pending.request.draft : ''
            if (pending.phase !== 'idle' && pendingDraft === text) return
            // The draft still sits inside the proposal on screen: the draft effect has
            // already scheduled a debounced request for it, so the safety net must not
            // fire an immediate second one (S18 measured that as a wasted call).
            if (pending.phase === 'ready' && pending.items.length > 0) {
              const shown = pending.items[pending.index] ?? ''
              if (shown.startsWith(text)) return
            }
            report('retrigger', { sessionId: live.sessionId, draftLength: text.length, detail: 'interval' })
            // request() records the draft once a call actually starts: recording it
            // here marked suppressed drafts as answered and stalled the ghost.
            request('compose', text)
          }, RETRIGGER_INTERVAL_MS)
          return () => window.clearInterval(interval)
        }, [ghost, request])

      return { request }
    }

    /** Turn boundaries and Session switches. */
    function useSessionBoundary(passed) {
      const {
        sessionId, running, nextEnabled, draftEmpty, settings, request, dismissAll, latest,
        ghost, ghostLayer, sendDock, hydrateStored, bumpHistoryEpoch, refs, stopTimer,
      } = passed
      const { previous, composing, hydratedFor, lastRequested, lastCall, retriedFor, notLive, learnedShown } = refs
        React.useEffect(() => {
          const prior = previous.current
          previous.current = { sessionId, running }
          if (prior === null) {
            if (hydrateStored('next', '')) return
            if (!running && sessionId !== null && nextEnabled && draftEmpty && settings.mode !== 'manual') request('next', '', true)
            return
          }
          if (prior.sessionId !== sessionId) {
            ghost.resetStreak()
            composing.current = false
            sendDock({ type: 'undismissed' })
            hydratedFor.current = ''
            // Claims belong to the previous Session: with them in place the first
            // draft here would be skipped as "already requested".
            lastRequested.current = null
            lastCall.current = { key: '', at: 0 }
            // A fresh Session gets a fresh retry budget: a backoff from the previous
            // Session must not silence this one.
            retriedFor.current = null
            notLive.current = { until: 0, attempts: 0, timer: notLive.current.timer }
            sendDock({ type: 'cleared' })
            // The composer still carries the previous Session's draft until the
            // host swaps it: never ask for a proposal on someone else's text.
            sendDock({ type: 'switch-started', draft: latest.current.draft })
            // Hydrate first, while the store is untouched: coming back to a Session
            // whose conversation has not moved is not a new question, and asking the
            // model again would show "补写中…" for something already known.
            const wantNext = !running && sessionId !== null && nextEnabled && draftEmpty && settings.mode !== 'manual'
            const hydrated = wantNext ? hydrateStored('next', '') : false
            report('dock-decision', { sessionId, detail: `switch want=${wantNext} hydrated=${hydrated}` })
            if (wantNext && hydrated) {
              // A stored suggestion answers this Session, but the previous Session's
              // request and debounce timer must still stop: their results would otherwise
              // land on the composer that now shows a different conversation.
              stopTimer()
              ghost.cancel()
              ghostLayer.clear()
              return
            }
            dismissAll()
            if (!running && sessionId !== null && nextEnabled && draftEmpty && settings.mode !== 'manual') {
              // Nothing stored: this Session genuinely has no answer yet.
              const shown = ghost.getSnapshot()
              const alreadyShown = shown.sessionId === sessionId && shown.items.length > 0
              if (!alreadyShown) request('next', '', true)
            }
            return
          }
          if (prior.running && !running) {
            bumpEpoch(sessionId)
            // A finished turn adds messages this Session's history did not have.
            bumpHistoryEpoch()
            // New turn, new transcript: stored suggestions for it are stale.
            clearSessionSuggestions(sessionId)
            // A retry that was armed for a failed draft is obsolete now.
            retriedFor.current = null
            if (nextEnabled && draftEmpty && settings.mode !== 'manual') {
              if (!hydrateStored('next', '')) request('next', '', true)
            }
          }
          if (running) {
            const shown = learnedShown.current
            if (shown !== null && shown.consumed !== true && Date.now() - shown.at < 120_000) {
              shown.consumed = true
              recordOutcome(shown.features, false)
              ghost.noteIgnored()
            }
            // A turn started: stop any in-flight request and hide the ghost, but
            // keep the proposal. The row is hidden by `running` anyway, and keeping
            // it means a suggestion is already on screen the instant the turn ends
            // instead of after another model round trip.
            ghost.cancel()
            ghostLayer.clear()
          }
        }, [sessionId, running, nextEnabled, draftEmpty, request, dismissAll])
    }

    /** Typing drives the compose request: debounced on the settled draft. */
    function useTypingRequest(passed) {
      const {
        draft, composeEnabled, sessionId, running, settings, state, dockBooking, sendDock, attachmentKey, latest,
        ghost, hydrateStored, report, request, composing, refs,
      } = passed
      const { lastRequested } = refs
      // The draft alone is not the question: the same sentence with a picture
      // attached asks something else. Every "already asked" test below uses this.
      const signature = requestSignature(draft, attachmentKey)
      // What the composer held when this hook last looked. The Session effect asks
      // on mount; only a later change is a new question.
      const seenAttachmentKey = React.useRef(attachmentKey)
      React.useEffect(() => {
        const prior = seenAttachmentKey.current
        seenAttachmentKey.current = attachmentKey
        if (!nextAskForAttachments({ priorKey: prior, attachmentKey, live: latest.current })) return
        // Candidates on screen were written for the old contents of the composer.
        ghost.clear(latest.current.sessionId ?? undefined)
        request('next', '', true)
      }, [attachmentKey, ghost, request])
      // The attachments the request in flight was sent with. A different set means
      // its answer was written without them, so it can no longer apply.
      const askedKey = signatureAttachmentKey(lastRequested.current)
      const sameAttachments = askedKey === (attachmentKey ?? '')
        React.useEffect(() => {
          if (draft.trim() !== '') sendDock({ type: 'typed' })
          if (!composeEnabled || sessionId === null || running || settings.mode === 'manual') return
          if (draft.trim().length < MIN_DRAFT_CHARS) {
            // Only this Session's compose answer may be dropped here: right after a switch
            // the store still describes the Session we left, and clearing on that view
            // wiped the suggestion that had just been hydrated for this one.
            if (ownsCompose(state, sessionId)) ghost.clear(sessionId)
            // Clearing the composer (after accepting, or by hand) must re-arm the
            // next-message prediction instead of leaving the composer silent.
            if (draft === '' && dockBooking.current.hadDraft) {
              sendDock({ type: 'cleared' })
              sendDock({ type: 'undismissed' })
              lastRequested.current = null
              // Drop the accepted proposal before asking for a fresh prediction.
              ghost.clear(sessionId)
              // This effect runs before the Session-switch effect, so on a switch the
              // "draft became empty" case fires first: consult the store before
              // spending a call, or switching Sessions re-samples everything.
              if (!hydrateStored('next', '')) request('next', '', true)
            }
            return
          }
          if (dockBooking.current.dismissed === draft) return
          // Right after an accept the draft is exactly what was just applied: it was
          // already answered, so do not pay for another model call on it. Any other
          // text is a new draft and must be requested.
          if (lastRequested.current === signature) return
          if (dockBooking.current.switched !== null) {
            if (draft === dockBooking.current.switched) return
            sendDock({ type: 'switch-settled' })
          }
          if (composing.current) return
          // A response for an older draft is already useless: drop it now instead
          // of letting it land after the new request starts.
          // Cancelling is only right when the reply can no longer apply. A draft that
          // merely grew (the usual case while typing) keeps the in-flight request
          // alive: its tail still continues this text, and cancelling meant the user
          // saw no suggestion at all until they stopped typing.
          const inFlightFor = state.requested
          const stillApplies = sameAttachments
            && typeof inFlightFor === 'string' && inFlightFor !== '' && draft.startsWith(inFlightFor)
          if (state.phase === 'loading' && inFlightFor !== null && inFlightFor !== draft && !stillApplies) ghost.cancel()
          // Attachments changed after something was already asked: that answer was
          // written without them, so drop it rather than show a guess. A settled
          // reply has to leave the screen too — cancel() only stops a stream.
          if (!sameAttachments && lastRequested.current !== null) {
            ghost.cancel()
            if (ownsCompose(state, sessionId)) ghost.clear(sessionId)
          }
            // Not claimed here: request() records the draft only when a call really
            // starts. Marking a suppressed draft as answered stalled the ghost — the
            // retrigger then skipped it forever.
          // The draft still lies inside the proposal already on screen: keep using
          // its tail and wait much longer before paying for a new call.
          const stored = ghost.getSnapshot()
          const storedText = stored.sessionId === sessionId && stored.kind === 'compose' && stored.items.length > 0
            ? stored.items[stored.index] ?? ''
            : ''
          // Candidates cover the draft that produced them; a store that has moved
          // on to a longer draft still holds the older ones.
          const itemsFrom = stored.itemsRequest !== null && stored.itemsRequest !== undefined
            ? stored.itemsRequest
            : (stored.request !== null && stored.request !== undefined ? stored.request : null)
          const storedDraft = itemsFrom !== null ? itemsFrom.draft : ''
          const covered = sameAttachments
            && storedText !== ''
            && storedDraft !== draft
            && draft.replace(/\s+$/, '').startsWith(storedDraft.replace(/\s+$/, ''))
            && followRemainder(storedText, draft.replace(/\s+$/, '')) !== ''
          if (covered && dockBooking.current.covered !== draft) {
            sendDock({ type: 'covered', draft })
            report('covered', { sessionId, draftLength: draft.length, detail: 'prefix-extension' })
          }
          if (!covered) sendDock({ type: 'not-covered' })
          // A stored answer for this exact draft is better than a fresh call — but
          // only when nothing is attached: suggestions saved earlier carry no
          // attachment context, and replaying one would hide the picture again.
          if (attachmentKey === '' && hydrateStored('compose', draft)) return
          request('compose', draft, false, covered ? COVERED_DEBOUNCE_MS : undefined)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [draft, attachmentKey, composeEnabled, sessionId, running])
    }

    /** One diagnostic line at mount: which props arrived, and whether the Session exists. */
    function useMountBeacon(passed) {
      const { beaconSent, sessionId, session, report, running, draft, props, inputActions, input } = passed
          if (beaconSent.current) return
          beaconSent.current = true
          if (sessionId === null) {
            try { console.warn('[composer-quill] composer dock has no Session identity; keys =', Object.keys(session ?? {}).join(',')) } catch { /* no console */ }
          }
          report('dock', {
            sessionId,
            hasSession: session !== undefined && session !== null,
            running,
            draftLength: draft.length,
            keys: Object.keys(session ?? {}).join(','),
            detail: JSON.stringify({
              ghost: props.ghost !== undefined,
              config: props.config !== undefined,
              inputActions: inputActions !== undefined && inputActions !== null,
              input: input !== undefined && input !== null,
            }),
          })
          // eslint-disable-next-line react-hooks/exhaustive-deps
    }

// --- dock.js — concatenated into client.js by dev/tools/build-client.mjs ---
    function GhostDock(props) {
      const { session, input, inputActions, t, attachments } = props
      const ghost = props.ghost ?? idleGhost()
      const config = props.config ?? defaultConfig()
      const settings = React.useSyncExternalStore(config.subscribe, config.getSnapshot)
      const nextEnabled = settings.nextEnabled === true
      const composeEnabled = settings.composeEnabled === true
      const enabled = nextEnabled || composeEnabled
      const state = React.useSyncExternalStore(ghost.subscribe, ghost.getSnapshot)

      const sessionId = typeof session?.sessionId === 'string'
        ? session.sessionId
        : (typeof session?.id === 'string' ? session.id : null)
      const running = session?.running === true
      // The composer can hold invisible characters (Lexical inserts zero-width
      // spaces around widgets): they must not make an empty composer look
      // non-empty, or the next-message prediction is suppressed forever.
      const draft = (typeof input?.draft === 'string' ? input.draft : '').replace(/\u200b/g, '')
      const draftEmpty = draft.trim() === ''

      /**
       * Reuse a suggestion produced earlier (before a reload) instead of asking
       * the model the same question again.
       */
      const hydratedFor = React.useRef('')
      const hydrateStored = (kind, forDraft) => {
        if (!enabled || sessionId === null) return false
        // A saved suggestion was written without the composer's attachments: with
        // something attached it would answer an older question.
        if (kind === 'next' && (latest.current.attachmentKey ?? '') !== '') return false
        // The Host has the last word: once it says this Session has nothing to
        // open with, storage must not hand an older line back.
        if (kind === 'next' && forDraft === '' && saidNothing(sessionId, kind, forDraft)) return false
        const marker = `${kind}|${forDraft}`
        if (hydratedFor.current === marker) return false
        const items = loadSuggestion(sessionId, kind, forDraft)
        if (items === null || items.length === 0) return false
        const shown = ghost.hydrate(ghost.newRequest(sessionId, forDraft, ''), kind, items)
        // Only a suggestion that reached the screen may claim the marker: a
        // rejected hydrate (live result, in-flight request) must stay retryable.
        if (shown) {
          hydratedFor.current = marker
            // The store answered this exact question: a request for it would be pure
            // waste, so the request path consults this before spending a call.
            servedFromStore.current = { key: `${kind}|${forDraft}`, at: Date.now() }
          report('hydrated', { sessionId, draftLength: forDraft.length, detail: kind })
        }
        return shown
      }
      const previous = React.useRef(null)
      const timer = React.useRef(null)
      const composing = React.useRef(false)
      const beaconSent = React.useRef(false)
      const lastRequested = React.useRef(null)
      const retriedFor = React.useRef(null)
      const { booking: dockBooking, send: sendDock } = useDockBooking()
      const latest = React.useRef({})
      // Described once per render, from the composer's own attachment list: the
      // request path must not read a store that may have moved on since.
      const attached = typeof attachments?.describe === 'function' ? attachments.describe(input) : []
      // Attachments are part of the question, not decoration: swapping a picture
      // must reach the same request path a keystroke does.
      const attachmentTotal = typeof attachments?.total === 'function' ? attachments.total() : attached.length
      const attachmentKey = typeof attachments?.key === 'function' ? attachments.key(attached, attachmentTotal) : ''
      latest.current = { sessionId, running, enabled, nextEnabled, composeEnabled, draft, draftEmpty, attachments: attached, attachmentTotal, attachmentKey, debounceMs: settings.debounceMs, timeoutMs: settings.timeoutMs, manual: settings.mode === 'manual' }
      const layer = React.useRef(null)
      if (layer.current === null) layer.current = createGhostLayer(sessionId ?? '')
      const ghostLayer = layer.current
      const { history, historyRef, bumpHistoryEpoch } = useComposerHistory(sessionId)
      // The switch is a preference; the streak is the store's own count.
      const suppressRewritesOn = settings.suppressRewrites !== false
      React.useEffect(() => {
        ghost.setSuppressRewrites?.(suppressRewritesOn)
      }, [ghost, suppressRewritesOn])

      useMountBeacon({ beaconSent, sessionId, session, report, running, draft, props, inputActions, input })

      const stopTimer = React.useCallback(() => {
        if (timer.current !== null) {
          clearTimeout(timer.current)
          timer.current = null
        }
      }, [])

      const dismissAll = React.useCallback(() => {
        const shown = learnedShown.current
        if (shown !== null && shown.consumed !== true) {
          shown.consumed = true
          recordOutcome(shown.features, false)
          ghost.noteIgnored()
        }
        stopTimer()
        ghost.cancel()
        ghost.clear(sessionId ?? undefined)
        ghostLayer.clear()
        // The store only clears its own Session, and a layer from a dock that never
        // mounts again belongs to nobody: Esc has to take the screen back anyway.
        if (typeof ghostLayer.sweep === 'function') ghostLayer.sweep()
      }, [stopTimer, ghost, ghostLayer, sessionId])

      /**
       * A Session that the Host has not loaded yet answers 409 ("not live"). That
       * is the normal state right after opening DSH or an old conversation, not a
       * failure: back off quietly and let the safety net retry, instead of firing
       * a request on every keystroke.
       */
      // Shared with the hook: it reads and writes these, the component resets them
      // on a Session switch, so exactly one copy exists.
      const notLive = React.useRef({ until: 0, attempts: 0, timer: null })
      const lastCall = React.useRef({ key: '', at: 0 })
      const servedFromStore = React.useRef({ key: '', at: 0 })
      const learnedShown = React.useRef(null)
      const dockRefs = { timer, lastRequested, retriedFor, composing, notLive, servedFromStore, lastCall, historyRef }
      const { request } = useGhostRequests({
        ghost, ghostLayer, latest, state, draft, enabled, composeEnabled, running, sessionId,
        dockBooking, sendDock, report, stopTimer, domDraft, refs: dockRefs,
      })

      // Turn boundary and Session switch drive the next-message prediction.
      useSessionBoundary({
        sessionId, running, nextEnabled, draftEmpty, settings, request, dismissAll, latest,
        ghost, ghostLayer, sendDock, hydrateStored, bumpHistoryEpoch, stopTimer,
        refs: { previous, composing, hydratedFor, lastRequested, lastCall, retriedFor, notLive, learnedShown },
      })

      // Typing drives the compose request (debounced on the settled draft).
      useTypingRequest({
        draft, enabled, sessionId, running, settings, state, dockBooking, sendDock, attachmentKey, latest,
        ghost, hydrateStored, report, request, composing, composeEnabled, refs: { lastRequested },
      })

      /**
       * Safety net: read the draft straight from the composer DOM on a slow
       * interval. The dock can be remounted or skip a prop update while the host
       * streams a turn, and a suggestion feature must not depend on that.
       */

      /**
       * One retry per draft after a failed request. A dropped model call should
       * not leave the composer waiting forever on a chip that never resolves.
       */

      const items = state.sessionId === sessionId ? state.items : []
      // Learning only reorders: the candidate set itself still comes from the Host.
      const ordered = state.kind === 'next' ? rankByLearning(items, 'next') : items
      const current = ordered[state.index] ?? ''
      const composed = state.kind === 'compose' ? current : ''
      // The Host trims trailing whitespace when it joins a tail, so a draft that
      // ends with a newline (caret on an empty line) must be compared trimmed —
      // otherwise the tail looks like a full rewrite and no inline ghost paints.
      const draftBase = draft.replace(/\s+$/, '')
      // A proposal that is already sitting in the editor is stale: this happens
      // right after Tab inserted it, while the tracked draft still lags a frame.
      const liveText = (() => {
        try {
          const node = editorEl()
          if (node === null || node === undefined) return draftBase
          return typeof node.value === 'string' ? node.value : String(node.textContent ?? '')
        } catch {
          return draftBase
        }
      })()
      // The ghost trims at paint time, the row can only trim at render time, and the
      // draft this render was handed can still be a keystroke behind the editor. A
      // keystroke therefore has to re-render the row itself, or the two disagree for
      // as long as the prop takes to arrive.
      const seenEditor = React.useRef(liveText)
      const [, bumpEditorText] = React.useReducer((n) => n + 1, 0)
      React.useEffect(() => {
        seenEditor.current = liveText
      }, [liveText])
      React.useEffect(() => {
        const node = editorEl()
        if (node === null || node === undefined) return undefined
        const onInput = () => {
          const now = typeof node.value === 'string' ? node.value : String(node.textContent ?? '')
          if (now === seenEditor.current) return
          // Same task as the keystroke: repaint the ghost now, then let the row
          // re-render behind it, so the two never describe different tails.
          paintData.paintNow?.()
          bumpEditorText()
        }
        node.addEventListener('input', onInput)
        return () => node.removeEventListener('input', onInput)
      }, [])
      // Trim against what is actually in the editor, not against the draft state
      // that this render was handed. Between a keystroke and the state that
      // follows it the two disagree for a frame, and trimming against the older
      // one paints the character the user just typed a second time.
      const remainder = followRemainder(composed, liveText.replace(/\s+$/, ''))
      // The draft these candidates answer is the one that produced them — not the
      // request currently in flight. While a longer draft is being answered the
      // store keeps the older candidates, and they belong to the older draft.
      const itemsFrom = state.itemsRequest !== null && state.itemsRequest !== undefined
        ? state.itemsRequest
        : (state.request !== null && state.request !== undefined ? state.request : null)
      const forDraft = itemsFrom !== null ? itemsFrom.draft : ''
      const fresh = forDraft === draft || forDraft === draftBase
      const alreadyInEditor = proposalIsStale(current, liveText)
      // The candidates belong to the Session that asked for them: after a switch the
      // store still holds the previous one's, and an empty composer makes every other
      // condition true (issue #10).
      const nextActive = nextVisible({
        nextEnabled, running, draftEmpty, kind: state.kind, sessionId,
        storeSessionId: state.sessionId, current, alreadyInEditor,
      })
      const composeActive = composeVisible({
        composeEnabled,
        running,
        kind: state.kind,
        sessionId,
        storeSessionId: state.sessionId,
        composed,
        editorText: liveText,
        tail: remainder,
        fresh,
        draftBase,
      })
      // Model proposal first; while it is missing, the user's own history fills
      // the gap instantly (no request, no debounce).
      const historyMatch = enabled && !running && !nextActive && !composeActive
        && history.sessionId === sessionId
        && dockBooking.current.dismissed !== draft && dockBooking.current.dismissed !== draftBase
        ? /** @type {{ tail: string } | null} */ (bestHistoryMatch(history.items, draftBase))
        : null
      const historyActive = historyMatch !== null
      const visible = nextActive || composeActive || historyActive

      const proposal = nextActive
        ? current
        : composeActive
          ? (remainder !== '' ? remainder : composed)
          : historyMatch !== null ? historyMatch.tail : ''
      const proposalIsTail = nextActive ? false : composeActive ? remainder !== '' : historyActive
      const hintKey = nextActive
        ? 'hint.accept'
        : historyActive ? 'hint.history' : proposalIsTail ? 'hint.complete' : 'hint.replace'

      /**
       * Apply the visible proposal — always in full: the whole tail, or the whole
       * draft for a rewrite. Tab and a chip click behave the same.
       */

      const accept = React.useCallback(() => {
        const live = latest.current
        // Accept inserts what the editor shows, trimmed at the moment of the keypress.
        // A keystroke reaches the editor one frame before React sees it, so trimming
        // against the draft this render was handed would put the character the user
        // just typed on screen a second time.
        const editorNow = (() => {
          const editor = editorEl()
          if (editor === null) return ''
          return typeof editor.value === 'string' ? editor.value : (editor.textContent ?? '')
        })()
        const editorBase = editorNow === '' ? live.draft : editorNow.replace(/\s+$/, '')
        const insert = (text) => typeof inputActions?.insertText === 'function'
          && inputActions.insertText(text, inputActions.captureInsertion?.()) !== false
        const afterInsert = (applied, path) => {
          const shown = learnedShown.current
          if (shown !== null && shown.consumed !== true) {
            shown.consumed = true
            recordOutcome(shown.features, true)
            // One accept is enough to earn rewrites back.
            ghost.noteAccepted()
          }
          sendDock({ type: 'undismissed' })
          // Remember the draft the accept produced, so the safety net does not
          // immediately re-ask for the text that was just applied.
          lastRequested.current = requestSignature(applied, latest.current.attachmentKey)
          ghost.clear(live.sessionId ?? undefined)
          ghostLayer.clear()
          // Keep what it took to get here: the chip offers undo for a few seconds, and the
          // native undo stack only covers the insertText path.
          setUndoOffer({ before: live.draft, after: applied, at: Date.now(), sessionId: live.sessionId, path })
          editorEl()?.focus()
          return true
        }

        if (nextActive) {
          return insert(current) ? afterInsert(current, 'insert') : false
        }
        if (!composeActive) {
          if (historyActive && historyMatch !== null) {
            const chunk = followRemainder(`${live.draft}${historyMatch.tail}`, editorBase)
            if (chunk === '') return false
            // The tail was measured against the end of the draft. With the caret parked
            // mid-sentence, inserting it would split the user's own words: replace the draft
            // with the whole suggestion instead.
            if (caretPlacement() === 'inside' && typeof inputActions?.setDraft === 'function') {
              const whole = `${editorBase}${chunk}`
              return inputActions.setDraft(whole) !== false ? afterInsert(whole, 'setDraft') : false
            }
            return insert(chunk) ? afterInsert(editorBase + chunk, 'insert') : false
          }
          return false
        }
        if (!proposalIsTail) {
          // A rewrite replaces the whole draft.
          const done = typeof inputActions?.setDraft === 'function' && (inputActions.setDraft(proposal), true)
          return done ? afterInsert(proposal, 'setDraft') : false
        }
        // Tab inserts exactly what the ghost shows: the remainder measured against the
        // editor text at this instant. When that is empty nothing is on screen, so
        // nothing is inserted.
        const chunk = followRemainder(current, editorBase)
        if (chunk === '') return false
        // The tail was measured against the end of the draft. With the caret parked
        // mid-sentence, inserting it would split the user's own words: replace the draft
        // with the whole suggestion instead.
        if (caretPlacement() === 'inside' && typeof inputActions?.setDraft === 'function') {
          const whole = `${editorBase}${chunk}`
          return inputActions.setDraft(whole) !== false ? afterInsert(whole, 'setDraft') : false
        }
        return insert(chunk) ? afterInsert(editorBase + chunk, 'insert') : false
      }, [nextActive, composeActive, historyActive, historyMatch, proposal, proposalIsTail, current, inputActions, ghost, ghostLayer])

        const [undoOffer, setUndoOffer] = React.useState(null)

        // "补写完成 · 没有需要改的地方" used to be invisible: the store recorded it and the
        // row fell through to the key hints. Show it once, briefly.
        const [showEmpty, setShowEmpty] = React.useState(false)
        React.useEffect(() => {
          if (state.phase !== 'empty' || state.sessionId !== sessionId) { setShowEmpty(false); return undefined }
          if (forDraft !== draftBase && forDraft !== draft) { setShowEmpty(false); return undefined }
          setShowEmpty(true)
          const timer = setTimeout(() => setShowEmpty(false), 2500)
          return () => clearTimeout(timer)
        }, [state.phase, state.sessionId, forDraft, sessionId, draft, draftBase])

        // The offer is short-lived: eight seconds, or until the draft moves on.
        React.useEffect(() => {
          if (undoOffer === null) return undefined
          if (undoOffer.sessionId !== sessionId) { setUndoOffer(null); return undefined }
          if (draft !== undoOffer.after) { setUndoOffer(null); return undefined }
          const timer = setTimeout(() => setUndoOffer(null), 8000)
          return () => clearTimeout(timer)
        }, [undoOffer, sessionId, draft])

        /**
         * Undo an accept. The native stack already holds the entry when the text went in
         * through insertText; setDraft writes are not on it, so restore the draft instead.
         */
        const undo = React.useCallback(() => {
          const offer = undoOffer
          if (offer === null) return false
          const finish = () => {
            setUndoOffer(null)
            lastRequested.current = null
            ghost.clear(sessionId ?? undefined)
            ghostLayer.clear()
            editorEl()?.focus()
            return true
          }
          if (offer.path === 'insert') {
            try { document.execCommand('undo') } catch { /* older engines */ }
            if (domDraft() === offer.before) return finish()
          }
          if (typeof inputActions?.setDraft === "function" && inputActions.setDraft(offer.before) !== false) return finish()
          // Neither path worked: keep the offer so the user can try again.
          return false
        }, [undoOffer, sessionId, inputActions, ghost, ghostLayer])

        /**
         * Ask again for this draft. force=true skips the dedupe window and the "store
         * already answered" gate: the user is explicitly overriding both. The retry
         * budget is reset so the automatic retry is re-armed once per click.
         */
        const retry = React.useCallback(() => {
          const live = latest.current
          if (!live.enabled || live.sessionId === null || live.running === true) return false
          retriedFor.current = null
          request('compose', live.draft, true)
          return true
        }, [request])

      const acceptRef = React.useRef(accept)
      acceptRef.current = accept

      // The values the painter needs, read at paint time. Keeping them in a ref
      // lets the effect below depend on `visible` alone: a rebuild of two
      // observers on every streamed delta is real main-thread work.
      const paintData = React.useRef({})
      paintData.current = {
        nextActive,
        composeActive,
        historyActive,
        proposalIsTail,
        proposal,
        current,
        kind: state.kind,
        forDraft,
        fullText: composed,
        draftLength: draft.length,
        sessionId,
      }

      useGhostPaint({ visible, ghost, ghostLayer, paintData, dockBooking, sendDock, report, sessionId })

      useComposerKeys({
        visible, nextActive, items, ghost, ghostLayer, dismissAll, acceptRef,
        composing, latest, lastRequested, request, sendDock,
      })

      // A permanently visible row: a proposal, a pending note, or the key hints.
      // It keeps a fixed height so the composer never jumps as states change.
      const statusText = nextActive ? current : (composeActive || historyActive) ? proposal : ''
      // A failure used to be invisible: the store recorded it and nothing rendered it.
      const failureText = state.phase === 'error' && typeof state.error === 'string' && state.error !== ''
        && (forDraft === draftBase || forDraft === draft)
        ? state.error
        : ''
      // "Composing…" covers the whole wait for a usable proposal — including the
      // debounce window and a request that was answered for a slightly older
      // draft. It stops as soon as this exact draft has a settled answer
      // (a proposal, "nothing to add", or a failure).
      const answeredForThisDraft = (state.phase === 'empty' || state.phase === 'error' || state.phase === 'ready')
        && (forDraft === draftBase || forDraft === draft)
      const pendingCompose = composeEnabled && !running && statusText === ''
        && sessionId !== null
        && state.sessionId === sessionId
        && draft.trim().length >= MIN_DRAFT_CHARS
        && !answeredForThisDraft
      // An empty composer is waiting on the next-message prediction, which is a
      // model call too: say so instead of looking idle.
      const pendingNext = nextEnabled && !running && statusText === ''
        && sessionId !== null
        && state.sessionId === sessionId
        && settings.mode !== 'manual'
        && draftEmpty
        && state.phase === 'loading'
      const pendingAny = pendingCompose || pendingNext
      // A screen reader should hear the outcome once, not every streamed delta.
      // Announced once the text settles; see useDockAnnouncement.
      const announcement = useDockAnnouncement({ t, status: statusText, failure: failureText, busy: pendingAny || running })
      // An already generated suggestion survives the next request. Keeping it in
      // the row means the user never sees their completion simply disappear.
      const heldText = state.sessionId === sessionId
        && state.phase === 'loading'
        && state.items.length > 0
        && typeof state.items[0] === 'string'
        ? state.items[0]
        : ''
      // The row is always mounted: right after DSH starts the Session identity
      // can still be missing, and a plugin that hides itself looks broken.
      // Why is nothing on screen? One line per decided state, so a silent UI has
      // a record of the exact inputs that produced it.
      // Suppression is invisible otherwise: a rewrite that never appears looks exactly
      // like a rewrite that never arrived, and only one of those is a bug.
      const suppress = ghost.suppressState?.() ?? { on: false, streak: 0, allow: true }
      const decisionKey = `${state.phase}|${state.kind}|${state.items.length}|${nextActive}|${composeActive}|${historyActive}|${draftEmpty}|${running}|${suppress.on ? 'suppressed' : 'live'}:${suppress.streak}`
      useDockStateReport({
        t, decisionKey, sessionId, session, running, draft, state, history, enabled, suppress,
        droppedFrames: typeof ghost.streamDropped === 'function' ? ghost.streamDropped() : 0,
        nextActive, composeActive, historyActive, pendingCompose, pendingNext, statusText, draftEmpty,
        shown: nextActive ? current : proposal, learnedShown, report,
        // An empty attachment list is only meaningful next to why it is empty.
        attachmentCount: attached.length,
        attachmentIds: Array.isArray(input?.attachmentIds) ? input.attachmentIds.length : -1,
        attachmentNote: typeof attachments?.probe === 'function' ? attachments.probe() : 'no-port',
      })

      if (!enabled) return null
      const position = nextActive && items.length > 1
        ? ` · ${t('hint.position').replace('{index}', String(state.index + 1)).replace('{total}', String(items.length))}`
        : ''
      const chipStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        maxWidth: '78%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        border: '1px dashed var(--dsw-alias-border-l2, #c4c7cc)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        borderRadius: '999px',
        padding: '2px 8px',
        font: '11px/16px var(--dsw-font-sans, system-ui, sans-serif)',
      }
      return h(React.Fragment, null,
        h('div', {
          'data-composer-quill': 'dock',
          // Which Session this dock speaks for. The layer uses it to find the
          // composer it belongs to instead of the first one in the document.
          'data-session': sessionId === null || sessionId === undefined ? '' : String(sessionId),
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 2px 4px',
            minHeight: '22px',
          },
        }, renderStatusChip({ t, hintKey, statusText, failureText, position, running, chipStyle, pendingAny, onAccept: () => acceptRef.current(true), onUndo: () => undo(), onRetry: () => retry(), undoReady: undoOffer !== null, emptyReady: showEmpty })),
        h('span', {
          role: 'status',
          'aria-live': 'polite',
          style: {
            position: 'absolute',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            clipPath: 'inset(50%)',
            whiteSpace: 'nowrap',
          },
        }, announcement))
    }

    /** Settings → General: on/off, automatic or manual, pause and timeout. */
    /** The 消耗 group: today, lifetime, and a reset. */
    function UsagePanel(props) {
      const { t } = props
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const [snap, setSnap] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(null)

      const reload = React.useCallback(() => {
        const controller = new AbortController()
        fetchUsage(sessionId, controller.signal)
          .then((body) => { setSnap(body); setFailed(body === null ? 'empty body' : null) })
          .catch((error) => setFailed(String(error?.message ?? error).slice(0, 120)))
        return () => controller.abort()
      }, [sessionId])

      React.useEffect(() => reload(), [reload])

      const rate = snap?.price?.cnyPerUsd ?? 7.1
      const line = (label, bucket) => h('div', {
        style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px', minHeight: '26px' },
      },
      h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, label),
      h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: '12px', fontVariantNumeric: 'tabular-nums' } },
        bucket === null || bucket === undefined
          ? '—'
          : `${bucket.calls} 次 · ${formatTokens(bucket.input)} 入 · ${formatTokens(bucket.output)} 出 · ${formatCost(bucket.costMicro, rate)}`))

      if (snap === null) {
        return h('div', {
          'data-composer-quill': 'usage-panel',
          style: { color: 'var(--dsw-alias-label-tertiary, #8a8f98)', fontSize: '11px' },
        }, failed === null ? t('usage.loading') : `${t('usage.failed')}：${failed}`)
      }

      const uncosted = snap.lifetime?.uncosted ?? 0
      const rows = [
        line(t('usage.today'), snap.today),
        sessionId === '' ? null : line(t('usage.session'), snap.session),
        line(t('usage.lifetime'), snap.lifetime),
      ].filter(Boolean)

      return h('div', {
        'data-composer-quill': 'usage-panel',
        style: { display: 'flex', flexDirection: 'column' },
      },
      ...rows,
      uncosted > 0
        ? h('div', { style: { color: 'var(--dsw-alias-label-tertiary, #8a8f98)', fontSize: '11px', marginTop: '2px' } },
          `${t('usage.uncosted')}：${uncosted}`)
        : null,
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginTop: '6px' } },
        h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #8a8f98)', fontSize: '11px' } },
          `${t('usage.price')} ${snap.price?.asOf ?? ''} · ${t('usage.holidayNote')}`),
        h('button', {
          type: 'button',
          'data-composer-quill': 'usage-reset',
          disabled: busy,
          onClick: () => {
            setBusy(true)
            resetUsageTotals()
              .then((body) => { if (body !== null) setSnap(body) })
              .catch((error) => setFailed(String(error?.message ?? error).slice(0, 120)))
              .finally(() => setBusy(false))
          },
          style: {
            flex: 'none',
            height: '24px',
            padding: '0 10px',
            borderRadius: '6px',
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            font: '12px/16px var(--dsw-font-sans, system-ui, sans-serif)',
            cursor: busy ? 'default' : 'pointer',
          },
        }, t('usage.reset'))))
    }

    /**
     * Settings → 续笔 → 模型. The list comes from the Host, so it only offers routes
     * this installation can actually reach. Selecting nothing keeps the old
     * behaviour: suggestions use whatever the session uses.
     */
    function ModelPicker(props) {
      const { t } = props
      const config = props.config ?? defaultConfig()
      // GhostSettingsRow defines these inside its own body; this component renders
      // before it, so it carries its own copies rather than reaching across.
      const hintStyle = { color: 'var(--dsw-alias-label-tertiary, #8a8f98)', fontSize: '11px', lineHeight: '17px' }
      const fieldStyle = {
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '6px',
        padding: '4px 8px',
        fontSize: '13px',
        lineHeight: '20px',
      }
      const [providers, setProviders] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      const [value, setValue] = React.useState(() => currentConfig().modelRoute)

      React.useEffect(() => {
        const controller = new AbortController()
        fetchModels(controller.signal)
          .then((list) => setProviders(list))
          .catch(() => setFailed(true))
        return () => controller.abort()
      }, [])

      const key = value === null ? '' : `${value.provider}::${value.model}`
      const options = [h('option', { key: '', value: '' }, t('settings.model.follow'))]
      for (const provider of providers ?? []) {
        for (const model of provider.models) {
          options.push(h('option', {
            key: `${provider.id}::${model.id}`,
            value: `${provider.id}::${model.id}`,
          }, `${provider.name} · ${model.name}`))
        }
      }

      const hint = failed
        ? t('settings.model.failed')
        : providers === null
          ? t('settings.model.loading')
          : providers.length === 0
            ? t('settings.model.empty')
            : t('settings.model.hint')
      const disabled = providers === null || (providers.length === 0 && !failed)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        h('select', {
          'data-composer-quill': 'settings-model',
          'aria-label': t('settings.model'),
          value: key,
          disabled,
          onChange: (event) => {
            const next = event.target.value
            if (next === '') {
              setValue(null)
              config.set({ modelRoute: null })
              return
            }
            const [provider, model] = next.split('::')
            const route = normalizeModelRoute({ provider, model })
            setValue(route)
            config.set({ modelRoute: route })
          },
          style: { ...fieldStyle, width: '260px' },
        }, options),
        h('div', { style: hintStyle }, hint),
      )
    }

    function GhostSettingsRow(props) {
      const { t } = props
      const config = props.config ?? defaultConfig()
      const settings = React.useSyncExternalStore(config.subscribe, config.getSnapshot)
      const nextEnabled = settings.nextEnabled === true
      const composeEnabled = settings.composeEnabled === true
      const suppressRewritesOn = settings.suppressRewrites !== false

      // One visual language: a quiet label on the left, the control on the right.
      const labelStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '18px' }
      const hintStyle = { color: 'var(--dsw-alias-label-tertiary, #8a8f98)', fontSize: '11px', lineHeight: '17px' }
      const sectionStyle = { color: 'var(--dsw-alias-label-tertiary, #8a8f98)', fontSize: '11px', lineHeight: '16px', letterSpacing: '0.04em', padding: '12px 0 4px' }
      const fieldStyle = {
        height: '28px',
        padding: '0 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-overlay)',
        color: 'var(--dsw-alias-label-primary)',
        font: '12px/16px var(--dsw-font-sans, system-ui, sans-serif)',
      }
      const section = (text) => h('div', { style: sectionStyle }, text)
      const row = (label, control) => h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minHeight: '32px' },
      }, h('span', { style: labelStyle }, label), control)
      const switchButton = (on, label, onToggle, key) => h('button', {
        type: 'button',
        role: 'switch',
        'data-composer-quill': key,
        'aria-checked': on,
        'aria-label': label,
        title: label,
        onClick: onToggle,
        style: {
          flex: 'none',
          width: '36px',
          height: '20px',
          borderRadius: '999px',
          border: 'none',
          padding: '2px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: on ? 'flex-end' : 'flex-start',
          background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
          transition: 'background 120ms ease',
        },
      }, h('span', {
        style: { width: '16px', height: '16px', borderRadius: '50%', background: 'var(--dsw-alias-bg-overlay)' },
      }))

      const learning = learningSummary()
      const learningText = learning.shown === 0
        ? t('settings.learningEmpty')
        : `${learning.accepted}/${learning.shown}（${Math.round((learning.rate ?? 0) * 100)}%）`

      return h('div', {
        'data-composer-quill': 'settings-row',
        style: { display: 'flex', flexDirection: 'column', maxWidth: '520px', padding: '4px 0 8px' },
      },
        h('div', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: '14px', lineHeight: '20px' } }, t('settings.title')),
        h('div', { style: { ...labelStyle, marginTop: '2px' } }, t('settings.description')),

        section(t('settings.section.capability')),
        row(t('settings.next'), switchButton(nextEnabled, t('settings.next'), () => config.set({ nextEnabled: !nextEnabled }), 'settings-next')),
        row(t('settings.compose'), switchButton(composeEnabled, t('settings.compose'), () => config.set({ composeEnabled: !composeEnabled }), 'settings-compose')),

        section(t('settings.section.behaviour')),
        row(t('settings.mode'), h('select', {
          'data-composer-quill': 'settings-mode',
          'aria-label': t('settings.mode'),
          value: settings.mode,
          onChange: (event) => config.set({ mode: event.target.value }),
          style: { ...fieldStyle, width: '132px' },
        },
          h('option', { value: 'auto' }, t('settings.mode.auto')),
          h('option', { value: 'manual' }, t('settings.mode.manual')))),
        row(t('settings.suppress'), h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          switchButton(suppressRewritesOn, t('settings.suppress'), () => config.set({ suppressRewrites: !suppressRewritesOn }), 'settings-suppress'),
          h('div', { style: hintStyle }, t('settings.suppress.hint')))),
        row(t('settings.language'), h('select', {
          'data-composer-quill': 'settings-language',
          'aria-label': t('settings.language'),
          value: settings.language,
          onChange: (event) => config.set({ language: event.target.value }),
          style: { ...fieldStyle, width: '132px' },
        },
          h('option', { value: 'auto' }, `${t('settings.language.auto')}（${browserLocale() || 'zh'}）`),
          h('option', { value: 'zh' }, '中文'),
          h('option', { value: 'en' }, 'English'))),

        section(t('settings.section.model')),
        row(t('settings.model'), h(ModelPicker, { t, config })),
        row(t('settings.reasoning'), h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('select', {
            'data-composer-quill': 'settings-reasoning',
            'aria-label': t('settings.reasoning'),
            value: settings.reasoning,
            onChange: (event) => config.set({ reasoning: event.target.value }),
            style: { ...fieldStyle, width: '260px' },
          },
            h('option', { value: 'off' }, t('settings.reasoning.off')),
            h('option', { value: 'low' }, t('settings.reasoning.low')),
            h('option', { value: 'high' }, t('settings.reasoning.high')),
            h('option', { value: 'max' }, t('settings.reasoning.max'))),
          h('div', { style: hintStyle }, t('settings.reasoning.hint')))),

        section(t('settings.section.pace')),
        row(t('settings.debounce'), h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          h('input', {
            'data-composer-quill': 'settings-debounce',
            'aria-label': t('settings.debounce'),
            type: 'number',
            min: 80,
            max: 2000,
            step: 50,
            value: settings.debounceMs,
            onChange: (event) => config.set({ debounceMs: Number(event.target.value) }),
            style: { ...fieldStyle, width: '84px' },
          }),
          h('span', { style: hintStyle }, 'ms'))),
        row(t('settings.timeout'), h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          h('input', {
            'data-composer-quill': 'settings-timeout',
            'aria-label': t('settings.timeout'),
            type: 'number',
            min: 3000,
            max: 60000,
            step: 1000,
            value: settings.timeoutMs,
            onChange: (event) => config.set({ timeoutMs: Number(event.target.value) }),
            style: { ...fieldStyle, width: '96px' },
          }),
          h('span', { style: hintStyle }, 'ms'))),

        section(t('settings.section.keys')),
        h('div', { style: hintStyle }, t('settings.manualHint')),

        section(t('settings.section.usage')),
      h(UsagePanel, { t, sessionId: props.sessionId }),

      section(t('settings.section.learning')),
        h('div', { style: hintStyle }, `${t('settings.learning')}：${learningText}`))
    }

    
    /**
     * Navigation glyph for this plugin's settings section. The shell wraps it in a
     * 16px box and paints it in the row's colour, so the paths carry no fill of
     * their own and use currentColor.
     */
    function GhostSettingsIcon(props) {
      const size = props?.size ?? 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('path', { d: 'M12.6 3.4C9.1 3.5 5.4 6.1 3.6 12.4c6.3-1.8 8.9-5.5 9-9Z' }),
      h('path', { d: 'M3.6 12.4 8.6 7.4' }))
    }
/**
     * Keeps a render failure inside this plugin: the composer must never break
     * because of a suggestion feature.
     */
    class GhostBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        report('render-error', { detail: String(error && error.message ? error.message : error).slice(0, 400) })
      }

      render() {
        return this.state.failed ? null : this.props.children
      }
    }

// --- entry.js — concatenated into client.js by dev/tools/build-client.mjs ---
    const GhostDockEntry = (props) => h(GhostBoundary, null, h(GhostDock, props))
    const GhostSettingsEntry = (props) => h(GhostBoundary, null, h(GhostSettingsRow, props))

    // `conversation` is declared even though the composer works without it: the
    // attachment port reads the draft's attachments through that service, and the
    // runtime only exposes a service the plugin has declared.
    const inject = ['slots', 'locale', 'conversation']

    async function apply(ctx) {
      // The beacon names the shape this bundle registers, so a reload can be told apart
      // from the previous build without guessing.
      report('apply', { detail: JSON.stringify({ slots: Boolean(ctx.slots), locale: Boolean(ctx.locale), settings: 'settings.section', icon: Boolean(ctx.slots) }) })
      // A Host release that renames or drops one of these must disable the feature,
      // not take the composer down with it: the plugin owns a slot row, not the page.
      if (ctx === null || typeof ctx !== 'object' || ctx.slots === undefined || ctx.locale === undefined) {
        report('apply-unsupported', { detail: JSON.stringify({ slots: Boolean(ctx?.slots), locale: Boolean(ctx?.locale) }) })
        return () => {}
      }
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'composer-quill: dictionaries')

      const ghost = createGhostStore()
      const config = createConfigStore()

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'composer-quill',
        order: 11,
        locale: NS,
        inject: () => ({ ghost, config, attachments: attachmentPort(ctx) }),
      }, GhostDockEntry))

      // Its own section in the Settings nav, not an item inside General: the card has
      // five groups and a nav label of its own.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'composer-quill',
        order: 30,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS,
        inject: () => ({ config }),
      }, GhostSettingsEntry))

      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: 'composer-quill',
        order: 30,
        locale: NS,
      }, GhostSettingsIcon))

      return () => {
        ghost.clear()
      }
    }

    report('module', { detail: String((window.location && window.location.pathname) || '') })
    return { inject, apply, __test: { attachmentPort, requestSignature, signatureAttachmentKey, nextAskForAttachments, nextVisible, ownsCompose, composeVisible, composerForDock, token, report, beaconTally, closeOnEscape, layerStats, pickEditor, formatTokens, formatCost, isAcceptKey, claimBlocksRetrigger, statusChipKind, gateFor, createGhostStore, createGhostLayer, dockReducer, createDockBooking, describeAnnouncement, usableItems, followRemainder, bestHistoryMatch, normalizeConfig, saveSuggestion, loadSuggestion, readSuggestions, clearSessionSuggestions, markNoSuggestion, saidNothing, streamRoute, featuresOf, rankByLearning, recordOutcome, learningSummary, proposalIsStale, inFlightCovers, transcriptVersion, epochOf, bumpEpoch, syncEpoch } }
  },
})
