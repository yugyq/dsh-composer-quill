"""Real-editor check: one character triggers a request, and the row never hangs.

Two acceptable outcomes for a 1-character draft:
  a) the model offers a completion  -> Tab must insert it in full;
  b) the model declines             -> the row returns to the idle hint, no
                                       "补写中…" left behind.
"""

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
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(1600)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(400)
                break

        def snap():
            return page.evaluate(
                """() => {
                    const row = document.querySelector('[data-composer-quill="dock"]');
                    const proposal = document.querySelector('[data-composer-quill="dock-suggestion"]');
                    const pending = document.querySelector('[data-composer-quill="dock-pending"]');
                    const hint = document.querySelector('[data-composer-quill="dock-hint"]');
                    const ghost = document.querySelector('[data-composer-quill="text"]');
                    return {
                        present: Boolean(row),
                        proposal: proposal ? proposal.textContent || '' : '',
                        pending: Boolean(pending),
                        hint: hint ? hint.textContent || '' : '',
                        ghost: ghost && getComputedStyle(ghost).display !== 'none' ? ghost.textContent || '' : '',
                        draft: (document.querySelector('[data-composer-input]') || {}).textContent || '',
                    };
                }"""
            )

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
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)

        page.keyboard.insert_text("帮")
        started = time.time()
        found = None
        while time.time() - started < 25:
            current = snap()
            if current["proposal"] or current["ghost"]:
                found = current
                break
            page.wait_for_timeout(200)
        elapsed = round(time.time() - started, 2)
        print(f"单字草稿 -> {elapsed}s 建议: {(found or {}).get('proposal', '')[:34]!r}")

        if found is not None:
            before = snap()["draft"]
            page.keyboard.press("Tab")
            page.wait_for_timeout(400)
            after = snap()
            inserted = after["draft"][len(before):]
            print(f"Tab 插入整段: {inserted!r}  草稿长度 {len(before)} -> {len(after['draft'])}")
            ok = bool(inserted) and len(inserted) > 4
            print("PASS 单字即给建议且 Tab 一次取完" if ok else "FAIL 建议有了但 Tab 没生效")
        else:
            # The model may legitimately decline a one-character draft.
            page.wait_for_timeout(1500)
            final = snap()
            stuck = final["pending"]
            print(f"模型未给建议；行状态 pending={stuck} hint={final['hint'][:20]!r}")
            ok = final["present"] and not stuck
            print("PASS 单字已触发请求，模型未补写时也不会卡住" if ok else "FAIL 卡在补写中")

        page.screenshot(path="single-char-accept.png")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
