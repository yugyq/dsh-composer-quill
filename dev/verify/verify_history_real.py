"""History completion on a live session: seed a message, then complete its prefix.

Two things this proves that the mock cannot:
  1. the Host's /history returns this Session's own messages after a turn;
  2. typing the prefix of an earlier message produces an *instant* suggestion
     (no /predict request), labelled as history.
"""

import os
from pathlib import Path
import sys
import time
from collections import Counter
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

SEED = "请统计这个工作目录里一共有多少个文件，并按扩展名分组给我"
PREFIX = SEED[:6]

CHIP = "() => (document.querySelector('[data-composer-quill=\"dock-suggestion\"]') || {}).textContent || ''"
PREDICTS = "() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/predict')).length"


def main() -> int:
    if not URL:
        return 2
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(1500)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(400)
                break

        def focus_editor():
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

        # Phase 1 — seed one message so this Session has history.
        focus_editor()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        for ch in SEED[:12]:
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(30)
        page.keyboard.press("Enter")
        print("已发送种子消息，等待回合结束…")

        # Wait until the turn is over (the row stops saying 回答中).
        for _ in range(120):
            page.wait_for_timeout(500)
            hint = page.evaluate("() => (document.querySelector('[data-composer-quill=\"dock-hint\"]') || {}).textContent || ''")
            pending = page.evaluate("() => Boolean(document.querySelector('[data-composer-quill=\"dock-pending\"]'))")
            busy = "回答中" in hint
            if not busy and not pending:
                break
        page.wait_for_timeout(2000)  # let the post-turn history refresh land

        # Phase 2 — type a prefix of the seeded message.
        focus_editor()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)
        before = page.evaluate(PREDICTS)

        started = time.time()
        for ch in PREFIX:
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(30)

        chip = ""
        deadline = time.time() + 3
        while time.time() < deadline:
            chip = page.evaluate(CHIP)
            if chip:
                break
            page.wait_for_timeout(20)
        elapsed = round(time.time() - started, 2)
        after = page.evaluate(PREDICTS)

        print(f"前缀 {PREFIX!r} → {elapsed}s chip={chip[:40]!r}")
        print(f"/predict 次数: {before} → {after}")
        history_hit = "历史" in chip and chip[:1] != ""
        instant = elapsed < 0.6
        no_call = after == before
        ok = history_hit and instant and no_call
        print(
            "PASS 历史补全即时命中且不花模型调用"
            if ok
            else f"FAIL history={history_hit} instant={instant} no_call={no_call}"
        )
        page.screenshot(path="history-real.png")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
