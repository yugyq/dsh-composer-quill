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
      delete map[suggestionKey(sessionId, `none-${kind}`, draft, syncEpoch(sessionId))]
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
      }
      writeSuggestions(map)
    }

    function saidNothing(sessionId, kind, draft) {
      if (sessionId === null) return false
      const map = readSuggestions()
      return map[suggestionKey(sessionId, `none-${kind}`, draft, syncEpoch(sessionId))] !== undefined
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
