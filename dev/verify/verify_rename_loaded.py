"""Does the renamed plugin actually load and paint its row?"""

import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright


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

URL = sys.argv[1]
STATE = """() => {
  const row = document.querySelector('[data-composer-quill="dock"]');
  const oldRow = document.querySelector('[data-composer-ghost="dock"]');
  const hint = document.querySelector('[data-composer-quill="dock-hint"]');
  const editor = document.querySelector('[data-composer-input]');
  return {
    quillRow: Boolean(row),
    legacyRow: Boolean(oldRow),
    hint: hint ? (hint.textContent || '') : '',
    hasEditor: Boolean(editor),
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("[data-composer-input]", timeout=45000)
    page.wait_for_timeout(2500)
    for label in ("继续", "Continue", "知道了"):
        button = page.locator(f"button:has-text('{label}')")
        if button.count() > 0:
            button.first.click()
            page.wait_for_timeout(400)
            break
    state = page.evaluate(STATE)
    print("输入框存在:", state["hasEditor"])
    print("新标记 data-composer-quill 行:", state["quillRow"])
    print("旧标记 data-composer-ghost 行:", state["legacyRow"])
    print("行内提示:", repr(state["hint"][:40]))
    print("页面异常:", errors[:2])
    ok = state["quillRow"] and not state["legacyRow"]
    print("PASS 插件以新名字加载" if ok else "FAIL 插件未按新名字加载")
    browser.close()
    sys.exit(0 if ok else 1)
