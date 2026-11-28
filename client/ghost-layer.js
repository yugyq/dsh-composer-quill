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
      let panelEl = null
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
      const layoutBox = () => {
        if (target === null || target === undefined) return false
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
        fitToHeight(limit)
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
        fitToHeight(limit)
        copyFont(style)
        // 三行以上就垫一块面板：灰字本来就画在页面之上，长尾直接把正文压住太糙。
        // 面板从第二行开始，第一行留在输入框里，避免盖住用户已经打出来的字。
        const line = Number.parseFloat(style.lineHeight) || rect.height || 24
        const height = textEl === null ? 0 : textEl.scrollHeight
        if (panelEl !== null) {
          if (height > line * 1.6) {
            Object.assign(panelEl.style, {
              display: '',
              left: `${Math.round(contentLeft - origin.left - 10)}px`,
              top: `${Math.round(lineTop + line - 6)}px`,
              width: `${Math.round(blockWidth + 20)}px`,
              height: `${Math.round(height - line + 12)}px`,
            })
            if (host !== null) host.setAttribute('data-mode', 'panel')
          } else {
            panelEl.style.display = 'none'
            if (host !== null) host.setAttribute('data-mode', 'inline')
          }
        }
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

      const clear = () => {
        if (liveLayer === token) liveLayer = null
        if (host !== null) {
          host.remove()
          host = null
        }
        textEl = null
        panelEl = null
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
        host = document.createElement('div')
        host.setAttribute('data-composer-quill', 'layer')
        host.setAttribute('data-session', ownSession)
        host.setAttribute('aria-hidden', 'true')
        // On <body>, fixed: the composer's own overflow clipped the tail after two lines
        // no matter how much height the text wanted. A viewport-anchored layer cannot be
        // clipped by an ancestor, and `place()` already works in viewport coordinates.
        host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483000;pointer-events:none;'
        panelEl = document.createElement('div')
        panelEl.setAttribute('data-composer-quill', 'panel')
        panelEl.style.cssText = [
          'position:absolute',
          'box-sizing:border-box',
          'display:none',
          'border-radius:10px',
          'background:rgba(255,255,255,.97)',
          'border:1px solid rgba(17,24,39,.08)',
          'box-shadow:0 10px 28px rgba(17,24,39,.10)',
          'pointer-events:none',
        ].join(';')
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
        host.appendChild(panelEl)
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

