"""After a turn ends, an empty composer must get a next-message suggestion."""

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
PENDING = "() => Boolean(document.querySelector('[data-composer-quill=\"dock-pending\"]'))"
HINT = "() => (document.querySelector('[data-composer-quill=\"dock-hint\"]') || {}).textContent || ''"


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
        for ch in "你好":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(60)
        page.keyboard.press("Enter")
        print("已发送，等待回合结束…")

        seen = []
        chip = ""
        for _ in range(90):  # up to 45 s
            page.wait_for_timeout(500)
            state = (page.evaluate(CHIP), page.evaluate(PENDING), page.evaluate(HINT))
            if state not in seen:
                seen.append(state)
            if state[0]:
                chip = state[0]
                break

        print("状态变化:", seen[-4:])
        print(f"最终 chip: {chip[:44]!r}")
        ok = bool(chip)
        print("PASS 回合结束后出现了下一句建议" if ok else "FAIL 回合结束后仍无建议")
        page.screenshot(path="after-turn.png")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
