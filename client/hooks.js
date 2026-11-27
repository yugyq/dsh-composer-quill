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
            forDraftLength: typeof input.state.forDraft === "string" ? input.state.forDraft.length : null,
            nextActive: input.nextActive,
            composeActive: input.composeActive,
            pendingCompose: input.pendingCompose,
            pendingNext: input.pendingNext,
            statusLength: input.statusText.length,
          attachments: input.attachmentCount,
          attachmentIds: input.attachmentIds,
          attachmentNote: input.attachmentNote,
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
          lastRequested.current = requestSignature(live.draft, live.attachmentKey)
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
          lastRequested.current = requestSignature(draftNow, live.attachmentKey)
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
              ghost.streamDelta(text, live.sessionId)
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
              ghost.streamFail('timed out', live.sessionId)
            }, live.timeoutMs || CLIENT_TIMEOUT_MS)
          }
          bump()
          streamRoute(ROUTE, { sessionId: live.sessionId, draft: draftNow, mode: 'compose', attachments: live.attachments ?? [], attachmentTotal: live.attachmentTotal ?? 0 }, active.signal, {
            start: (data) => {
              bump()
              // Keep whatever is on screen: the first delta replaces it.
              ghost.streamModeSet?.(data?.mode)
            },
            retract: (data) => {
              bump()
              flush()
              ghost.streamRetract(data?.mode === 'append' ? 'append' : 'full', live.sessionId)
            },
            delta: (data) => {
              bump()
              if (typeof data?.text === 'string') queue(data.text)
            },
            final: (data) => {
              bump()
              flush()
              if (typeof data?.text === 'string') ghost.streamFinal(data.text, data?.mode, live.sessionId)
              if (ghost.takeSuppressed?.() === true) report('suppressed', { sessionId: live.sessionId, detail: 'rewrite' })
            },
            done: (data) => {
              flush()
              markLive()
              ghost.streamDone(data ?? {}, live.sessionId)
              // Most compose suggestions arrive over SSE: persist them too, or
              // only the JSON fallback would ever be reused.
              const settled = ghost.getSnapshot()
              if (settled.kind === 'compose' && settled.items.length > 0) {
                saveSuggestion(settled.sessionId, 'compose', settled.forDraft, settled.items, `${historyRef.current.items.length}`, settled.mode)
              }
            },
            error: (data) => {
              const message = typeof data?.message === 'string' ? data.message : 'stream failed'
              ghost.streamFail(message, live.sessionId)
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
            ghost.streamFail(message, live.sessionId)
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
          .then(() => callRoute(ROUTE, { sessionId: live.sessionId, draft: draftNow, mode, attachments: live.attachments ?? [], attachmentTotal: live.attachmentTotal ?? 0 }, active.signal))
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
            if (requestSignature(text, live.attachmentKey) === lastRequested.current) return
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
            if (state.kind === 'compose') ghost.clear(sessionId)
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
          const covered = sameAttachments
            && storedText !== ''
            && stored.forDraft !== draft
            && draft.replace(/\s+$/, '').startsWith(stored.forDraft.replace(/\s+$/, ''))
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

