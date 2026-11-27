"""Fresh-start check: the composer row works before the Session is live, and recovers."""

import os
from pathlib import Path
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


def main() -> int:
    if not URL:
        return 2
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)[:120]))
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(800)

        def state():
            return page.evaluate(
                """() => {
                    const row = document.querySelector('[data-composer-quill="dock"]');
                    return {
                        row: Boolean(row),
                        proposal: (document.querySelector('[data-composer-quill="dock-suggestion"]') || {}).textContent || '',
                        pending: Boolean(document.querySelector('[data-composer-quill="dock-pending"]')),
                        hint: (document.querySelector('[data-composer-quill="dock-hint"]') || {}).textContent || '',
                    };
                }"""
            )

        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(300)
                break

        first = state()
        print("刚打开:", first)

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
            page.wait_for_timeout(55)

        # In a brand-new Session the Host answers 409 until an agent exists.
        # The row must stay usable: no endless "补写中…", no error surface.
        samples = []
        deadline = time.time() + 12
        while time.time() < deadline:
            samples.append(state())
            page.wait_for_timeout(400)
        stuck = all(sample["pending"] for sample in samples[-6:])
        has_row = all(sample["row"] for sample in samples)
        print(f"12s 内 pending 是否一直挂着: {stuck}；行是否常驻: {has_row}")
        print("末尾状态:", samples[-1])

        ok = has_row and first["row"] and not errors and not stuck
        print("PASS 刚打开可用且不会卡在补写中" if ok else f"FAIL errors={errors[:2]}")
        page.screenshot(path="fresh-start.png")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
