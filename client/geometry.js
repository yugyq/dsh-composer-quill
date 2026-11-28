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

