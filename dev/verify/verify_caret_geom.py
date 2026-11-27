"""Probe the caret geometry Chromium actually reports inside the DSH composer."""

import os
from pathlib import Path
import json
import sys
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
  const sel = window.getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
  const collapsed = range ? [...range.getClientRects()].map(r => ({x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width)})) : null;
  const box = range ? range.getBoundingClientRect() : null;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let textNode = null;
  while (walker.nextNode()) if (walker.currentNode.length > 0) textNode = walker.currentNode;
  let charRect = null;
  if (textNode) {
    const probe = document.createRange();
    probe.setStart(textNode, textNode.length - 1);
    probe.setEnd(textNode, textNode.length);
    const r = probe.getClientRects()[0];
    if (r) charRect = {x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width)};
  }
  const s = getComputedStyle(editor);
  const ghost = document.querySelector('[data-composer-quill="text"]');
  return {
    collapsed,
    bounding: box ? {x: Math.round(box.x), y: Math.round(box.y), h: Math.round(box.height)} : null,
    charRect,
    lineHeight: s.lineHeight,
    fontSize: s.fontSize,
    ghost: ghost ? (() => { const r = ghost.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height)}; })() : null,
    nodes: editor.childNodes.length,
    html: editor.innerHTML.slice(0, 160),
  };
}
"""


def main() -> int:
    if not URL:
        return 2
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(1600)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(500)
                break

        def type_text(text):
            page.evaluate("""() => {
                const editor = document.querySelector('[data-composer-input]');
                editor.focus();
                const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false);
                const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
            }""")
            for ch in text:
                page.keyboard.insert_text(ch)
                page.wait_for_timeout(45)

        type_text("帮我把这个报错的现象描述清楚")
        page.wait_for_timeout(600)
        print("A 单行:")
        print(json.dumps(page.evaluate(PROBE), ensure_ascii=False, indent=2))

        page.keyboard.press("Shift+Enter")
        page.wait_for_timeout(400)
        print("\nC 末行空行:")
        print(json.dumps(page.evaluate(PROBE), ensure_ascii=False, indent=2))

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
