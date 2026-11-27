// --- entry.js — concatenated into client.js by dev/tools/build-client.mjs ---
    const GhostDockEntry = (props) => h(GhostBoundary, null, h(GhostDock, props))
    const GhostSettingsEntry = (props) => h(GhostBoundary, null, h(GhostSettingsRow, props))

    const inject = ['slots', 'locale']

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
