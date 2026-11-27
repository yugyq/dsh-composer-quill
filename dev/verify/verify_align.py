"""Measure how the ghost box lines up with the real editor text."""

import os
from pathlib import Path
import json
import sys
import time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else ""
def _chrome_path():
    """Chromium for Playwright, located at runtime instead of hard-coded."""
    override = os.environ.get("DSH_CHROME")
    if override:
        return override
    roots = [
        Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")) if os.environ.get("PLAYWRIGHT_BROWSERS_PATH") else None,
        Path.home() / "AppData" / "Local" / "ms-playwright",
        Path.home() / ".cache" / "ms-playwright",
    ]
    patterns = ["chromium-*/chrome-win/chrome.exe", "chromium-*/chrome-linux/chrome", "chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium"]
    for root in roots:
        if root is None or not root.exists():
            continue
        for pattern in patterns:
            for candidate in sorted(root.glob(pattern), reverse=True):
                return str(candidate)
    return None


CHROME = _chrome_path()

PROBE = """
() => {
  const editor = document.querySelector('[data-composer-input]');
  const ghost = document.querySelector('[data-composer-quill="text"]');
  const rect = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)}; };
  // The last character of the draft, and the line box of the caret.
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let textNode = null;
  while (walker.nextNode()) { if (walker.currentNode.length > 0) textNode = walker.currentNode; }
  let charRect = null;
  if (textNode) {
    const probe = document.createRange();
    probe.setStart(textNode, textNode.length - 1);
    probe.setEnd(textNode, textNode.length);
    charRect = probe.getClientRects()[0] || null;
  }
  const sel = window.getSelection();
  let caretRects = null;
  if (sel && sel.rangeCount) caretRects = [...sel.getRangeAt(0).getClientRects()].map(r => ({x:Math.round(r.x),y:Math.round(r.y),h:Math.round(r.height)}));
  const gs = ghost ? getComputedStyle(ghost) : null;
  const editorStyle = getComputedStyle(editor);
  const parentStyle = textNode && textNode.parentElement ? getComputedStyle(textNode.parentElement) : null;
  return {
    charRect: charRect ? {x:Math.round(charRect.x), y:Math.round(charRect.y), w:Math.round(charRect.width), h:Math.round(charRect.height), top:Math.round(charRect.top), bottom:Math.round(charRect.bottom)} : null,
    caretRects,
    ghost: rect(ghost),
    ghostStyle: gs ? {fontSize: gs.fontSize, lineHeight: gs.lineHeight, top: gs.top, left: gs.left, opacity: gs.opacity} : null,
    editor: {fontSize: editorStyle.fontSize, lineHeight: editorStyle.lineHeight, paddingTop: editorStyle.paddingTop, borderTop: editorStyle.borderTopWidth},
    textParent: parentStyle ? {tag: textNode.parentElement.tagName, fontSize: parentStyle.fontSize, lineHeight: parentStyle.lineHeight, margin: parentStyle.margin} : null,
    editorRect: rect(editor),
  };
}
"""


def main() -> int:
    if not URL:
        print("usage: python verify_align.py <url>")
        return 2
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(1800)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(500)
                break

        page.evaluate(
            """() => {
                const editor = document.querySelector('[data-composer-input]');
                editor.focus();
                const range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }"""
        )
        for ch in "帮我把这个报错的现象描述清楚":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(60)

        deadline = time.time() + 25
        while time.time() < deadline:
            if page.evaluate("() => Boolean(document.querySelector('[data-composer-quill=\"text\"]'))"):
                break
            page.wait_for_timeout(150)

        data = page.evaluate(PROBE)
        print(json.dumps(data, ensure_ascii=False, indent=2))
        if data.get("charRect") and data.get("ghost"):
            char_rect = data["charRect"]
            ghost_rect = data["ghost"]
            line_height = float((data.get("ghostStyle") or {}).get("lineHeight", "0").replace("px", "") or 0)
            leading = max(0.0, (line_height - char_rect["h"]) / 2) if line_height else 0.0
            # After the fix the ghost's line box starts `leading` above the glyph
            # box, so ghost.y should sit exactly there.
            delta = ghost_rect["y"] - (char_rect["y"] - leading)
            print(f"\n行盒顶偏差 = {delta:+.1f}px（期望 ≈0；leading={leading:.1f}px）")
            aligned = abs(delta) <= 1.0
            print("PASS 与正文同一行盒" if aligned else "FAIL 行盒未对齐")
            page.screenshot(path="align-after.png")
            browser.close()
            return 0 if aligned else 1


if __name__ == "__main__":
    sys.exit(main())
