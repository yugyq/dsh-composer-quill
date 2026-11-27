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
      const describe = (input) => {
        const ids = Array.isArray(input?.attachmentIds) ? input.attachmentIds : []
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
          described.push({ kind: item?.kind === 'image' ? 'image' : 'file', name, bytes, receiptId })
          if (described.length >= MAX_DESCRIBED_ATTACHMENTS) break
        }
        lastNote = lastNote === '' ? `ok:${described.length}:${described.filter(item => item.receiptId !== '').length}` : lastNote
        return described
      }
      const probe = () => lastNote
      /**
       * The same shape the Host stamps into its request trace, so a log line from
       * either side reads identically. An unready attachment has no receipt: its
       * name stands in, which still changes when a different file is picked.
       */
      const key = (described) => (Array.isArray(described) ? described : [])
        .map((item) => `${item?.kind === 'image' ? 'image' : 'file'}:${item?.receiptId ? item.receiptId : (item?.name ?? '')}:${Number.isFinite(item?.bytes) ? item.bytes : 0}`)
        .join(',')
      return { describe, probe, key }
    }
