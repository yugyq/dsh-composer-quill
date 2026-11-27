"""Real-editor check: accept a suggestion, clear the composer, expect a new one."""

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

        def state():
            return page.evaluate(
                """() => ({
                    chip: (document.querySelector('[data-composer-quill="dock-suggestion"]') || {}).textContent || '',
                    ghost: (() => {
                        const t = document.querySelector('[data-composer-quill="text"]');
                        return t && getComputedStyle(t).display !== 'none' ? t.textContent || '' : '';
                    })(),
                    draft: (document.querySelector('[data-composer-input]') || {}).textContent || '',
                })"""
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
        # The next-message prediction needs a transcript: make one short turn first.
        for ch in "你好":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(60)
        page.keyboard.press("Enter")
        print("已发送一条短消息，等待回合结束…")
        deadline = time.time() + 90
        while time.time() < deadline:
            busy = page.evaluate("() => Boolean(document.querySelector('[data-composer-input][aria-disabled=\"true\"], [data-phase=\"sending\"], [data-phase=\"submitting\"]'))")
            if not busy:
                break
            page.wait_for_timeout(500)
        page.wait_for_timeout(2500)
        for ch in "帮我把这段日志":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(55)

        deadline = time.time() + 25
        while time.time() < deadline:
            if state()["chip"]:
                break
            page.wait_for_timeout(200)
        before = state()
        print("采纳前:", before["chip"][:40] or "(无)")

        page.evaluate("() => document.querySelector('[data-composer-quill=\"dock-suggestion\"]')?.click()")
        page.wait_for_timeout(400)
        after_accept = state()
        print("采纳后草稿长度:", len(after_accept["draft"]))

        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        print("清空后草稿:", repr(state()["draft"]))

        deadline = time.time() + 15
        found = None
        while time.time() < deadline:
            current = state()
            if current["chip"] or current["ghost"]:
                found = current
                break
            page.wait_for_timeout(200)

        print("清空后建议:", (found or {}).get("chip", "")[:44] or (found or {}).get("ghost", ""))
        ok = found is not None
        print("PASS 清空后重新弹出建议" if ok else "FAIL 清空后没有建议")
        page.screenshot(path="cleared-rearm.png")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
