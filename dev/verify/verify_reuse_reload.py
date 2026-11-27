"""Reload the page: a stored suggestion must appear without a new model call."""

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

CHIP = "() => (document.querySelector('[data-composer-quill=\"dock-suggestion\"]') || {}).textContent || ''"
PREDICTS = "() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/predict')).length"


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

        # Establish a transcript so the next-message prediction has something to work on.
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
        for ch in "你好":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(60)
        page.keyboard.press("Enter")

        first_chip = ""
        seen_pending = False
        for _ in range(90):
            page.wait_for_timeout(500)
            pending = page.evaluate("() => Boolean(document.querySelector('[data-composer-quill=\"dock-pending\"]'))")
            seen_pending = seen_pending or pending
            chip = page.evaluate(CHIP)
            if chip:
                first_chip = chip
                break
        print(f"首次建议: {first_chip[:34]!r}（等待时出现补写中: {seen_pending}）")

        stored = page.evaluate("() => window.localStorage.getItem('dsh.composer-quill.suggestions')")
        print("localStorage 已存:", bool(stored), (stored or '')[:40])

        # Reload: the stored suggestion must come back without a /predict call.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(2500)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(300)
                break

        after_chip = ""
        for _ in range(20):
            page.wait_for_timeout(300)
            after_chip = page.evaluate(CHIP)
            if after_chip:
                break
        calls = page.evaluate(PREDICTS)
        print(f"刷新后 chip: {after_chip[:34]!r}；刷新后 /predict 次数: {calls}")
        ok = bool(first_chip) and bool(after_chip) and calls <= 1
        print("PASS 刷新后直接复用已存建议" if ok else "FAIL 刷新后仍需要重新请求")
        page.screenshot(path="reuse-after-reload.png")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
