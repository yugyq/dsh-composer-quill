"""Short drafts: is the inline ghost back (tail) instead of only a rewrite chip?"""

import os
from pathlib import Path
import sys
import time
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
  const chip = document.querySelector('[data-composer-quill="dock-suggestion"]');
  const ghost = document.querySelector('[data-composer-quill="text"]');
  const editor = document.querySelector('[data-composer-input]');
  return {
    chip: chip ? (chip.textContent || '') : '',
    ghost: ghost && getComputedStyle(ghost).display !== 'none' ? (ghost.textContent || '') : '',
    draft: editor ? (editor.textContent || '') : '',
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

    results = []
    for draft in ("再", "帮", "现在", "帮我把这个日志"):
        focus()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.evaluate("() => window.localStorage.removeItem('dsh.composer-quill.suggestions')")
        page.wait_for_timeout(250)
        for ch in draft:
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(40)
        state = {"chip": "", "ghost": "", "draft": ""}
        started = time.time()
        while time.time() - started < 25:
            state = page.evaluate(STATE)
            if state["chip"] or state["ghost"]:
                break
            page.wait_for_timeout(200)
        kind = "改写" if "改写" in state["chip"] else ("尾巴" if "补全" in state["chip"] else "无")
        print(f"{draft!r:14} 形态={kind:4} 灰字={state['ghost'][:26]!r} chip={state['chip'][:34]!r}")
        results.append((draft, kind, state["ghost"]))
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(250)

    short_ok = all(kind == "尾巴" and ghost for draft, kind, ghost in results if len(draft) < 4)
    print("\nPASS 短草稿也有灰字尾巴" if short_ok else "\nFAIL 短草稿仍然没有灰字")
    page.screenshot(path="short-draft-ghost.png")
    browser.close()
    sys.exit(0 if short_ok else 1)
