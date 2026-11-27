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
/* @@CLIENT_BODY@@ */
  },
})
