"""After a suggestion is on screen, one more keystroke must not blank it."""

import os
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
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

STATE = """() => {
  const t = document.querySelector('[data-composer-quill="text"]');
  const chip = document.querySelector('[data-composer-quill="dock-suggestion"]');
  const pending = document.querySelector('[data-composer-quill="dock-pending"]');
  const hint = document.querySelector('[data-composer-quill="dock-hint"]');
  return {
    ghost: t && getComputedStyle(t).display !== 'none' ? (t.textContent || '') : '',
    chip: chip ? (chip.textContent || '') : '',
    pending: Boolean(pending),
    hint: hint ? (hint.textContent || '') : '',
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("[data-composer-input]", timeout=45000)
    page.wait_for_timeout(1500)
    for label in ("继续", "Continue", "知道了"):
        button = page.locator(f"button:has-text('{label}')")
        if button.count() > 0:
            button.first.click()
            page.wait_for_timeout(400)
            break

    def focus():
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

    focus()
    page.keyboard.press("Control+a")
    page.keyboard.press("Backspace")
    page.evaluate("() => window.localStorage.removeItem('dsh.composer-quill.suggestions')")
    page.wait_for_timeout(300)
    for ch in "帮我把刚才那段报错日志":
        page.keyboard.insert_text(ch)
        page.wait_for_timeout(120)

    first = None
    for _ in range(60):
        page.wait_for_timeout(250)
        state = page.evaluate(STATE)
        if state["ghost"] or state["chip"] or "·" in state["hint"]:
            first = state
            break
    print("首个建议: ghost=%r chip=%r" % ((first or {}).get("ghost", "")[:30], (first or {}).get("chip", "")[:30]))
    if first is None:
        print("FAIL 停手后也没有出现建议")
        sys.exit(1)

    page.keyboard.insert_text("按")
    blanks = 0
    with_proposal = 0
    with_pending = 0
    for _ in range(60):
        state = page.evaluate(STATE)
        if state["ghost"] or state["chip"] or "·" in state["hint"]:
            with_proposal += 1
        elif state["pending"] or state["hint"]:
            with_pending += 1
        else:
            blanks += 1
        page.wait_for_timeout(50)

    print("再敲一个字后 3 秒内采样 60 次：建议 %d 次，补写中 %d 次，完全空白 %d 次" % (with_proposal, with_pending, blanks))
    ok = blanks <= 3
    print("PASS 追加输入不会抹掉已有建议" if ok else "FAIL 完全空白 %d/60" % blanks)
    page.screenshot(path="no-blink-2.png")
    browser.close()
    sys.exit(0 if ok else 1)

