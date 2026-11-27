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
      // Described once per render, from the composer's own attachment list: the
      // request path must not read a store that may have moved on since.
      const attached = typeof attachments?.describe === 'function' ? attachments.describe(input) : []
      // Attachments are part of the question, not decoration: swapping a picture
      // must reach the same request path a keystroke does.
      const attachmentTotal = typeof attachments?.total === 'function' ? attachments.total() : attached.length
      const attachmentKey = typeof attachments?.key === 'function' ? attachments.key(attached, attachmentTotal) : ''
      latest.current = { sessionId, running, enabled, nextEnabled, composeEnabled, draft, draftEmpty, attachments: attached, attachmentTotal, attachmentKey, debounceMs: settings.debounceMs, timeoutMs: settings.timeoutMs, manual: settings.mode === 'manual' }
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

