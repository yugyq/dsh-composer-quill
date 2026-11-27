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

