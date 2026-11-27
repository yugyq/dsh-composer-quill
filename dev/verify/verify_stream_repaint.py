"""The inline ghost must grow while the stream is still arriving."""

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

GHOST = "() => { const t = document.querySelector('[data-composer-quill=\"text\"]'); return t && getComputedStyle(t).display !== 'none' ? (t.textContent || '') : ''; }"


def main() -> int:
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
        for ch in "帮我把这段日志":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(50)

        lengths = []
        for _ in range(40):
            page.wait_for_timeout(250)
            lengths.append(len(page.evaluate(GHOST)))
            if lengths[-1] > 0 and len(lengths) > 4 and lengths[-1] == lengths[-2] and lengths[-3] == lengths[-1]:
                break
        nonzero = [value for value in lengths if value > 0]
        print("灰字长度变化:", lengths)
        grew = len(set(nonzero)) > 1
        ok = bool(nonzero) and grew
        print(f"PASS 灰字在流式期间逐步变长（步数 {len(set(nonzero))}）" if ok else "FAIL 灰字没有随流增长")
        page.screenshot(path="stream-repaint.png")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
