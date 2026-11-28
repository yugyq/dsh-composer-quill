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
