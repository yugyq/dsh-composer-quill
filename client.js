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
    const React = require('react')
    const h = React.createElement

    const NS = 'composer-quill'
    const BUILD = '0.31.66'
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

    function token() {
      return typeof window[TOKEN_GLOBAL] === 'string' ? window[TOKEN_GLOBAL] : ''
    }

    /** Fire-and-forget stage report; needs no page token. */
    function report(event, data) {
      try {
        const capability = token()
        const headers = { 'content-type': 'application/json', [CLIENT_HEADER]: '1' }
        if (capability !== '') headers[TOKEN_HEADER] = capability
        fetch(BEACON, {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          keepalive: true,
          body: JSON.stringify({ event, hasToken: capability !== '', build: BUILD, ...data }),
        }).catch(() => {})
      } catch {
        // Diagnostics only.
      }
    }

    /** Read an SSE compose response, falling back to a whole JSON body. */
    /** Headers every request needs, so the two transports cannot drift apart. */
    function requestHeaders(accept) {
      const capability = token()
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
      sessionId: null, phase: 'idle', kind: 'next', items: [], index: 0, error: null, forDraft: '', requested: null,
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
      const key = mode + "|" + draftNow
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
          && stored !== null
          && stored.sessionId === live.sessionId
          && stored.kind === 'compose'
          && stored.forDraft === draftNow
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
        if (stored !== null && stored.phase === 'loading' && inFlightCovers(stored.requested, draftNow)) {
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
      const cancel = () => {
        if (controller !== null) {
          controller.abort()
          controller = null
        }
        // Without this the dock keeps showing "补写中…" after a cancel (switching
        // Sessions, starting a turn) and nothing ever clears it.
        const current = store.getSnapshot()
        if (current.phase === 'loading') store.set({ ...current, phase: 'idle', requested: null })
      }
      const proposalOf = () => (streamMode === 'append' ? `${streamBase.replace(/\s+$/, '')}${acc}` : acc)
      return {
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
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
        /** True once, if the last finished stream was withheld on purpose. */
        /** What the suppression rule is currently doing, for the dock-state beacon. */
        suppressState: () => ({ on: suppressRewrites, streak: ignoredStreak, allow: allowSuppress }),
        takeSuppressed: () => {
          const was = lastSuppressed
          lastSuppressed = false
          return was
        },
        cancel: () => {
          cancel()
          if (!streaming) return
          streaming = false
          acc = ''
          streamMode = 'full'
          streamBase = ''
          store.set(IDLE)
        },
        /** Streaming compose: same snapshot shape, filled in as deltas arrive. */
        streamStart: (sessionId, kind, forDraft) => {
          cancel()
          streaming = true
          controller = new AbortController()
          acc = ''
          streamMode = 'full'
          streamBase = forDraft
          lastSuppressed = false
          // A compose answer may still turn out to be a rewrite, so nothing is
          // painted until the `start` frame says which case it is.
          holding = suppressRewrites && kind === 'compose'
          const previous = store.getSnapshot()
          // Keep the proposal that is already on screen; the first delta of this
          // request replaces it. Otherwise every keystroke blanks the composer.
          const keep = !holding
            && previous.sessionId === sessionId
            && previous.kind === kind
            && previous.items.length > 0
          store.set({
            sessionId,
            phase: 'loading',
            kind,
            items: keep ? previous.items : [],
            index: keep ? Math.min(previous.index, previous.items.length - 1) : 0,
            error: null,
            forDraft: keep ? previous.forDraft : forDraft,
            requested: forDraft,
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
        streamRetract: (mode) => {
          acc = ''
          streamMode = mode === 'append' ? 'append' : 'full'
          if (streamMode === 'append') holding = false
          const current = store.getSnapshot()
          store.set({ ...current, items: [] })
        },
        streamDelta: (text) => {
          if (typeof text !== 'string' || text === '') return
          acc += text
          // Withheld: keep the scratch text, leave the composer alone.
          if (holding) return
          const current = store.getSnapshot()
          // The store may still carry the proposal of an older draft (retention):
          // this result belongs to the draft the stream was requested for.
          store.set({ ...current, phase: 'ready', items: [proposalOf()], forDraft: current.requested ?? current.forDraft })
        },
        streamFinal: (text, mode) => {
          streaming = false

          const current = store.getSnapshot()
          if (mode === 'append' || mode === 'full') streamMode = mode
          if (holding && streamMode === 'full') {
            // Suppressed rewrite: better silent than covering the draft the user is
            // still typing.
            holding = false
            lastSuppressed = true
            acc = ''
            store.set({ ...current, phase: 'empty', items: [], requested: null, forDraft: current.requested ?? current.forDraft })
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
          store.set({ ...current, phase: 'ready', items: [proposalOf()], forDraft: current.requested ?? current.forDraft })
        },
        streamDone: (meta) => {
          streaming = false
          controller = null
          const current = store.getSnapshot()
          const items = usableItems(current.items)
          const unchanged = meta !== null && typeof meta === 'object' && meta.reason === 'unchanged'
          // An error for this draft outranks a later "nothing to add": the user asked
          // once, it failed, and a quiet empty answer must not erase that fact.
          if (unchanged && current.phase === 'error') return
          store.set({
            ...current,
            phase: unchanged || items.length === 0 ? 'empty' : 'ready',
            // The Host said "nothing to change" for this draft: keeping the older
            // proposal would offer a suggestion it just rejected.
            items: unchanged ? [] : items,
            error: null,
            requested: null,
            forDraft: current.requested ?? current.forDraft,
          })
        },
        streamFail: (message) => {
          streaming = false
          controller = null
          const current = store.getSnapshot()
          // Keep the retry budget pointed at the right draft: forDraft must follow
          // this request, or the one-retry-per-draft guard never matches.
          store.set({ ...current, phase: 'error', items: [], error: message, requested: null, forDraft: current.requested ?? current.forDraft })
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
          store.set(IDLE)
        },
        /**
         * Show a suggestion that was computed earlier (from localStorage) without
         * asking the Host again. A live result always wins over a stored one.
         */
        hydrate: (sessionId, kind, forDraft, items) => {
          if (!Array.isArray(items) || items.length === 0) return false
          // A stored compose answer may be a rewrite and carries no mode: while
          // suppressed, keep the store quiet and let a live request decide.
          if (suppressRewrites && kind === 'compose') return false
          const current = store.getSnapshot()
          if (current.sessionId === sessionId && current.items.length > 0) return false
          if (current.sessionId === sessionId && current.phase === 'loading') return false
          store.set({
            sessionId,
            phase: 'ready',
            kind,
            items,
            index: 0,
            error: null,
            forDraft,
            requested: null,
          })
          return true
        },
        cycle: (step) => {
          const current = store.getSnapshot()
          const total = current.items.length
          if (total < 2) return
          store.set({ ...current, index: (current.index + step + total) % total })
        },
        /**
         * Mark a request as started at schedule time (before the debounce fires)
         * so the UI can show a busy affordance immediately, while keeping the
         * proposal that is already on screen.
         */
        begin: (sessionId, kind, forDraft) => {
          cancel()
          controller = new AbortController()
          const previous = store.getSnapshot()
          // Keep the proposal that is already on screen: a new request must not
          // blank the composer for a second. The retained proposal keeps its own
          // `forDraft`, so the prefix arithmetic still matches what it was built
          // from, and a rewrite for an older draft stays hidden by its guard.
          const keep = previous.sessionId === sessionId
            && previous.kind === kind
            && previous.items.length > 0
          store.set({
            sessionId,
            phase: 'loading',
            kind,
            items: keep ? previous.items : [],
            index: keep ? Math.min(previous.index, previous.items.length - 1) : 0,
            error: null,
            forDraft: keep ? previous.forDraft : forDraft,
            requested: forDraft,
          })
          return controller
        },
        settle: (sessionId, active, kind, forDraft, rawItems) => {
          if (controller !== active || active.signal.aborted) return
          controller = null
          // The streaming path already drops anything that is not a non-empty string;
          // a malformed JSON answer used to reach the renderer instead.
          const items = usableItems(rawItems)
          store.set({
            sessionId,
            // 'empty' is a settled answer ("nothing to add"), not a pending state.
            phase: items.length === 0 ? 'empty' : 'ready',
            kind,
            items,
            index: 0,
            error: null,
            forDraft,
            requested: null,
          })
        },
        fail: (sessionId, active, kind, forDraft, message) => {
          if (controller !== active || active.signal.aborted) return
          controller = null
          store.set({ sessionId, phase: 'error', kind, items: [], index: 0, error: message, forDraft, requested: null })
        },
      }
    }

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
    function suggestionKey(sessionId, kind, draft, epoch = '') {
      return `${sessionId ?? ''}|${kind}|${draft ?? ''}|${epoch}`
    }

    function saveSuggestion(sessionId, kind, draft, items, version = '', mode = '') {
      if (sessionId === null || !Array.isArray(items) || items.length === 0) return
      const map = readSuggestions()
      map[suggestionKey(sessionId, kind, draft, syncEpoch(sessionId))] = {
        items,
        at: Date.now(),
        version: String(version ?? ''),
        // 'append' for a tail, 'full' for a rewrite or a next message: the display
        // derives it anyway, but storing it keeps the record self-describing.
        mode: mode === 'append' || mode === 'full' ? mode : '',
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

    function loadSuggestion(sessionId, kind, draft) {
      if (sessionId === null) return null
      const entry = readSuggestions()[suggestionKey(sessionId, kind, draft, syncEpoch(sessionId))]
      if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.items)) return null
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

    const editorEl = () => document.querySelector('[data-composer-input]')

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
      return { left: last.right, right: last.right, top: last.top, bottom: last.bottom, width: 0, height: last.height }
    }

    /** Last non-empty text node inside `node`, depth-first. */
    function lastTextNodeOf(node) {
      if (node === null) return null
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let found = null
      while (walker.nextNode()) {
        if (walker.currentNode.length > 0) found = walker.currentNode
      }
      return found
    }

    /**
     * Caret box in viewport coordinates. A collapsed range often reports a
     * zero-size or line-start rect, so the caret is measured as the right edge
     * of the character before it, which is stable across browsers.
     */
    function caretRect() {
      const selection = window.getSelection?.()
      if (selection === null || selection === undefined || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      const root = editorEl()
      if (root === null || !root.contains(range.endContainer)) return null
      if (!range.collapsed) {
        const rects = range.getClientRects()
        return rects.length > 0 ? rects[rects.length - 1] : null
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
          return { left: last.right, right: last.right, top: last.top, bottom: last.bottom, width: 0, height: last.height }
        }
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        for (let index = Math.min(offset, node.childNodes.length) - 1; index >= 0; index -= 1) {
          const child = node.childNodes[index]
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
        const box = node.getBoundingClientRect?.()
        const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight) || 0
        if (box !== undefined && lineHeight > 2 && box.height >= lineHeight * 2) {
          // `fromBlock` marks a caret that legitimately starts a line, so the
          // caller must not "fix" its x with the previous character's edge.
          return { left: box.left, top: box.bottom - lineHeight, bottom: box.bottom, width: 0, height: lineHeight, fromBlock: true }
        }
      }

      const collapsed = range.getClientRects()
      if (collapsed.length > 0) {
        const last = collapsed[collapsed.length - 1]
        if (last.width > 0 || last.height > 0) return last
      }
      if (node.nodeType === Node.ELEMENT_NODE && typeof node.getBoundingClientRect === 'function') {
        const box = node.getBoundingClientRect()
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

    /**
     * View-only inline ghost layer. It lives on <body> as a fixed layer, so the
     * composer's own overflow and stacking cannot clip it.
     */
    function createGhostLayer() {
      let host = null
      let textEl = null
      let textNode = null
      // Floats on the first line only: wrapped lines then start at the content edge.
      let spacerEl = null
      // 编辑框自己的 min-height，提案撑高之前先存下来。
      let savedMinHeight = null
      // Parent we made positioned, so its own style can be put back.
      let positionedParent = null
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
          placeholderDisplay = next.style.display
          next.style.display = 'none'
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
        // 灰字是浮层，不会撑高输入框：先借最多两行的高度，让它像正文一样换行。
        // 每次重新判断：借过一次后更长的尾巴仍需要更多高度，否则只能被省略号截断。
        if (target !== null) {
          const line = Number.parseFloat(getComputedStyle(textEl).lineHeight) || 24
          const want = Math.min(textEl.scrollHeight, limit + line * 2)
          const current = Number.parseFloat(getComputedStyle(target).minHeight) || 0
          if (want > current + 2) {
            if (savedMinHeight === null) savedMinHeight = target.style.minHeight
            target.style.minHeight = `${Math.round(want)}px`
            return
          }
        }
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
      const layoutBox = () => {
        if (target === null || target === undefined) return false
        const style = getComputedStyle(target)
        const rect = target.getBoundingClientRect()
        const clip = clipBox()
        const px = (value) => Number.parseFloat(value) || 0
        const left = Math.max(rect.left + px(style.borderLeftWidth) + px(style.paddingLeft), clip.left)
        const top = Math.max(rect.top + px(style.borderTopWidth) + px(style.paddingTop), clip.top)
        const origin = hostOrigin()
        place(
          left - origin.left,
          top - origin.top,
          Math.max(0, Math.min(rect.width - px(style.paddingLeft) - px(style.paddingRight), clip.right - left)),
          null,
          style.textAlign,
          clip.bottom - top,
        )
        fitToHeight(clip.bottom - top)
        copyFont(style)
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

      const layoutCaret = () => {
        if (target === null || target === undefined) return false
        const style = getComputedStyle(target)
        const px = (value) => Number.parseFloat(value) || 0
        const box = target.getBoundingClientRect()
        const clip = clipBox()
        // A fixed layer is not clipped by the editor, so every limit comes from the
        // visible composer box instead of the editor's own (taller) box.
        const contentLeft = Math.max(box.left + px(style.borderLeftWidth) + px(style.paddingLeft), clip.left)
        const contentRight = Math.min(box.right - px(style.borderRightWidth) - px(style.paddingRight), clip.right)
        const contentBottom = Math.min(box.bottom - px(style.borderBottomWidth) - px(style.paddingBottom), clip.bottom)
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
        // 可用高度必须在同一个坐标空间里算：lineTop 相对 host，contentBottom 是视口。
        const limit = contentBottom - (rect.top - leading)
        place(contentLeft - origin.left, lineTop, blockWidth, null, 'left', limit)
        if (spacerEl !== null) {
          const line = Number.parseFloat(style.lineHeight) || rect.height || 24
          spacerEl.style.width = `${Math.round(indentWidth)}px`
          spacerEl.style.height = `${Math.round(line)}px`
        }
        fitToHeight(limit)
        copyFont(style)
        return true
      }

      const clear = () => {
        if (positionedParent !== null) {
          positionedParent.style.position = ''
          positionedParent = null
        }
        if (target !== null && savedMinHeight !== null) {
          target.style.minHeight = savedMinHeight
          savedMinHeight = null
        }
        if (host !== null) {
          host.remove()
          host = null
        }
        textEl = null
        restorePlaceholder()
        target = null
      }

      const mount = () => {
        const editor = editorEl()
        if (editor === null) return false
        // A previous mount can survive a body re-render as a detached node, and a
        // second dock instance would draw a second ghost: start clean.
        for (const stale of document.querySelectorAll('[data-composer-quill="layer"]')) stale.remove()
        target = editor
        host = document.createElement('div')
        host.setAttribute('data-composer-quill', 'layer')
        host.setAttribute('aria-hidden', 'true')
        // Inside the composer, not on <body>: the composer clips it, dialogs cover it,
        // and the tail wraps inside the same box the text does.
        host.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;z-index:0;pointer-events:none;'
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
        const parent = editor.parentElement
        const parentStyle = parent === null ? null : getComputedStyle(parent)
        if (parent !== null && parentStyle !== null && parentStyle.position === 'static') {
          parent.style.position = 'relative'
          positionedParent = parent
        }
        ;(parent ?? document.body).appendChild(host)
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
        if (host === null || !host.isConnected) {
          if (!mount()) return
        }
        if (editorEl() !== target) {
          clear()
          if (!mount()) return
        }
        if (textNode !== null && textNode.nodeValue !== text) textNode.nodeValue = text
        textEl.style.display = ''
        hidePlaceholder()
        if (anchor === 'caret' && layoutCaret()) return
        layoutBox()
      }

      return { render, clear, isMounted: () => host !== null && host.isConnected, debug }
    }

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
            forDraftLength: typeof input.state.forDraft === "string" ? input.state.forDraft.length : null,
            nextActive: input.nextActive,
            composeActive: input.composeActive,
            pendingCompose: input.pendingCompose,
            pendingNext: input.pendingNext,
            statusLength: input.statusText.length,
            suppressRewrites: input.suppress?.on === true,
            ignoredStreak: input.suppress?.streak ?? 0,
            historyActive: input.historyActive,
            historyItems: input.history.items.length,
            draftEmpty: input.draftEmpty,
            sameSession: input.state.sessionId === input.sessionId,
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
    React.useEffect(() => {
      if (paintedSession.current !== sessionId) {
        paintedSession.current = sessionId
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
      const paint = () => {
        if (overlayBlocking()) {
          ghostLayer.clear()
          return
        }
        const data = paintData.current
        let anchor = 'none'
        // The host reports the draft from its own state, and the editor keeps the
        // previous Session's text until the swap lands: believing the prop alone paints
        // the ghost over text that is still there. Read the editor too.
        const editorText = (() => {
          const editor = editorEl()
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
            detail: JSON.stringify({ anchor, proposalChars: String(data.proposal).length, ...ghostLayer.debug() }),
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
          lastRequested.current = live.draft
          request('compose', live.draft)
          return
        }
        if (event.key === 'Enter') { dismissAll(); return }
        if (event.key === 'Escape') {
          if (visible) {
            event.preventDefault()
            event.stopPropagation()
            if (latest.current.draft.trim() !== '') sendDock({ type: 'dismissed', draft: latest.current.draft })
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
          lastRequested.current = draftNow
          const active = ghost.streamStart(live.sessionId, 'compose', draftNow)
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
              ghost.streamDelta(text)
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
              ghost.streamFail('timed out')
            }, live.timeoutMs || CLIENT_TIMEOUT_MS)
          }
          bump()
          streamRoute(ROUTE, { sessionId: live.sessionId, draft: draftNow, mode: 'compose' }, active.signal, {
            start: (data) => {
              bump()
              // Keep whatever is on screen: the first delta replaces it.
              ghost.streamModeSet?.(data?.mode)
            },
            retract: (data) => {
              bump()
              flush()
              ghost.streamRetract(data?.mode === 'append' ? 'append' : 'full')
            },
            delta: (data) => {
              bump()
              if (typeof data?.text === 'string') queue(data.text)
            },
            final: (data) => {
              bump()
              flush()
              if (typeof data?.text === 'string') ghost.streamFinal(data.text, data?.mode)
              if (ghost.takeSuppressed?.() === true) report('suppressed', { sessionId: live.sessionId, detail: 'rewrite' })
            },
            done: (data) => {
              flush()
              markLive()
              ghost.streamDone(data ?? {})
              // Most compose suggestions arrive over SSE: persist them too, or
              // only the JSON fallback would ever be reused.
              const settled = ghost.getSnapshot()
              if (settled.kind === 'compose' && settled.items.length > 0) {
                saveSuggestion(settled.sessionId, 'compose', settled.forDraft, settled.items, `${historyRef.current.items.length}`, settled.mode)
              }
            },
            error: (data) => {
              const message = typeof data?.message === 'string' ? data.message : 'stream failed'
              ghost.streamFail(message)
              report('compose-failed', { sessionId: live.sessionId, draftLength: draftNow.length, detail: message.slice(0, 300) })
            },
            json: (body) => {
              const items = rebaseItems(typeof body?.text === 'string' && body.text !== '' ? [body.text] : [], draftNow)
              ghost.settle(live.sessionId, active, 'compose', draftNow, items)
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
            ghost.streamFail(message)
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
        const active = ghost.begin(live.sessionId, kind, draftNow)
        const deadline = setTimeout(() => {
          active.abort()
          ghost.fail(live.sessionId, active, kind, draftNow, 'timed out')
        }, live.timeoutMs || CLIENT_TIMEOUT_MS)
        active.signal.addEventListener('abort', () => clearTimeout(deadline), { once: true })
        Promise.resolve()
          .then(() => callRoute(ROUTE, { sessionId: live.sessionId, draft: draftNow, mode }, active.signal))
          .then((body) => {
            if (active.signal.aborted) return
            markLive()
            const items = mode === 'next'
              ? (Array.isArray(body?.candidates) ? body.candidates : [])
              : rebaseItems(typeof body?.text === 'string' && body.text !== '' ? [body.text] : [], draftNow)
            ghost.settle(live.sessionId, active, kind, draftNow, items)
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
            ghost.fail(live.sessionId, active, kind, draftNow, message)
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
              forDraft: stored.forDraft,
              phase: stored.phase,
              requested: stored.requested,
            },
            dismissed: dockBooking.current.dismissed,
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
        if (state.forDraft !== draft || retriedFor.current === draft) return undefined
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
      }, [state.phase, state.kind, state.forDraft, draft, enabled, running, sessionId, request])
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
            if (text === lastRequested.current) return
            if (dockBooking.current.dismissed === text) return
            const pending = ghost.getSnapshot()
            if (pending.phase !== 'idle' && pending.forDraft === text) return
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
            if (!running && sessionId !== null && nextEnabled && draftEmpty && settings.mode !== 'manual'
              && hydrateStored('next', '')) {
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
        draft, composeEnabled, sessionId, running, settings, state, dockBooking, sendDock,
        ghost, hydrateStored, report, request, composing, refs,
      } = passed
      const { lastRequested } = refs
        React.useEffect(() => {
          if (draft.trim() !== '') sendDock({ type: 'typed' })
          if (!composeEnabled || sessionId === null || running || settings.mode === 'manual') return
          if (draft.trim().length < MIN_DRAFT_CHARS) {
            if (state.kind === 'compose') ghost.clear(sessionId)
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
          if (lastRequested.current === draft) return
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
          const stillApplies = typeof inFlightFor === 'string' && inFlightFor !== '' && draft.startsWith(inFlightFor)
          if (state.phase === 'loading' && inFlightFor !== null && inFlightFor !== draft && !stillApplies) ghost.cancel()
            // Not claimed here: request() records the draft only when a call really
            // starts. Marking a suppressed draft as answered stalled the ghost — the
            // retrigger then skipped it forever.
          // The draft still lies inside the proposal already on screen: keep using
          // its tail and wait much longer before paying for a new call.
          const stored = ghost.getSnapshot()
          const storedText = stored.sessionId === sessionId && stored.kind === 'compose' && stored.items.length > 0
            ? stored.items[stored.index] ?? ''
            : ''
          const covered = storedText !== ''
            && stored.forDraft !== draft
            && draft.replace(/\s+$/, '').startsWith(stored.forDraft.replace(/\s+$/, ''))
            && followRemainder(storedText, draft.replace(/\s+$/, '')) !== ''
          if (covered && dockBooking.current.covered !== draft) {
            sendDock({ type: 'covered', draft })
            report('covered', { sessionId, draftLength: draft.length, detail: 'prefix-extension' })
          }
          if (!covered) sendDock({ type: 'not-covered' })
          // A stored answer for this exact draft is better than a fresh call.
          if (hydrateStored('compose', draft)) return
          request('compose', draft, false, covered ? COVERED_DEBOUNCE_MS : undefined)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [draft, composeEnabled, sessionId, running])
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

    function GhostDock(props) {
      const { session, input, inputActions, t } = props
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
        const marker = `${kind}|${forDraft}`
        if (hydratedFor.current === marker) return false
        const items = loadSuggestion(sessionId, kind, forDraft)
        if (items === null || items.length === 0) return false
        const shown = ghost.hydrate(sessionId, kind, forDraft, items)
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
      latest.current = { sessionId, running, enabled, nextEnabled, composeEnabled, draft, draftEmpty, debounceMs: settings.debounceMs, timeoutMs: settings.timeoutMs, manual: settings.mode === 'manual' }
      const layer = React.useRef(null)
      if (layer.current === null) layer.current = createGhostLayer()
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
        draft, enabled, sessionId, running, settings, state, dockBooking, sendDock,
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
      const fresh = state.forDraft === draft || state.forDraft === draftBase
      const alreadyInEditor = proposalIsStale(current, liveText)
      const nextActive = nextEnabled && !running && draftEmpty && state.kind === 'next' && current !== '' && !alreadyInEditor
      const composeActive = composeEnabled && !running
        && state.kind === 'compose'
        && state.sessionId === sessionId
        && composed !== ''
        && (remainder !== '' || (fresh && composed.trim() !== draftBase.trim()))
      // Model proposal first; while it is missing, the user's own history fills
      // the gap instantly (no request, no debounce).
      const historyMatch = enabled && !running && !nextActive && !composeActive
        && history.sessionId === sessionId
        && dockBooking.current.dismissed !== draft && dockBooking.current.dismissed !== draftBase
        ? bestHistoryMatch(history.items, draftBase)
        : null
      const historyActive = historyMatch !== null
      const visible = nextActive || composeActive || historyActive

      const proposal = nextActive
        ? current
        : composeActive
          ? (remainder !== '' ? remainder : composed)
          : historyActive ? historyMatch.tail : ''
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
          lastRequested.current = applied
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
          if (state.forDraft !== draftBase && state.forDraft !== draft) { setShowEmpty(false); return undefined }
          setShowEmpty(true)
          const timer = setTimeout(() => setShowEmpty(false), 2500)
          return () => clearTimeout(timer)
        }, [state.phase, state.sessionId, state.forDraft, sessionId, draft, draftBase])

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
        forDraft: state.forDraft,
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
        && (state.forDraft === draftBase || state.forDraft === draft)
        ? state.error
        : ''
      // "Composing…" covers the whole wait for a usable proposal — including the
      // debounce window and a request that was answered for a slightly older
      // draft. It stops as soon as this exact draft has a settled answer
      // (a proposal, "nothing to add", or a failure).
      const answeredForThisDraft = (state.phase === 'empty' || state.phase === 'error' || state.phase === 'ready')
        && (state.forDraft === draftBase || state.forDraft === draft)
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
        nextActive, composeActive, historyActive, pendingCompose, pendingNext, statusText, draftEmpty,
        shown: nextActive ? current : proposal, learnedShown, report,
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
        : `${learning.accepted}/${learning.shown}（${Math.round(learning.rate * 100)}%）`

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

    const GhostDockEntry = (props) => h(GhostBoundary, null, h(GhostDock, props))
    const GhostSettingsEntry = (props) => h(GhostBoundary, null, h(GhostSettingsRow, props))

    const inject = ['slots', 'locale']

    async function apply(ctx) {
      // The beacon names the shape this bundle registers, so a reload can be told apart
      // from the previous build without guessing.
      report('apply', { detail: JSON.stringify({ slots: Boolean(ctx.slots), locale: Boolean(ctx.locale), settings: 'settings.section', icon: Boolean(ctx.slots) }) })
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'composer-quill: dictionaries')

      const ghost = createGhostStore()
      const config = createConfigStore()

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'composer-quill',
        order: 11,
        locale: NS,
        inject: () => ({ ghost, config }),
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
    return { inject, apply, __test: { formatTokens, formatCost, isAcceptKey, claimBlocksRetrigger, statusChipKind, gateFor, createGhostStore, dockReducer, createDockBooking, describeAnnouncement, usableItems, followRemainder, bestHistoryMatch, normalizeConfig, saveSuggestion, loadSuggestion, readSuggestions, clearSessionSuggestions, streamRoute, featuresOf, rankByLearning, recordOutcome, learningSummary, proposalIsStale, inFlightCovers, transcriptVersion, epochOf, bumpEpoch, syncEpoch } }
  },
})
