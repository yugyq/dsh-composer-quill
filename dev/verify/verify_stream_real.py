"""Measure first-token latency of the streaming compose in the real DSH editor."""

import os
from pathlib import Path
import json
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
        print("usage: python verify_stream_real.py <url>")
        return 2
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(2000)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(600)
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
        for ch in "帮我把这个报错的现象描述清楚":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(70)

        start = time.time()
        first_ghost = None
        first_chip = None
        state = {}
        while time.time() - start < 25:
            state = page.evaluate(
                """() => ({
                    chip: (document.querySelector('[data-composer-quill="dock-suggestion"]') || {}).textContent || '',
                    ghost: (() => {
                        const t = document.querySelector('[data-composer-quill="text"]');
                        return t && getComputedStyle(t).display !== 'none' ? t.textContent || '' : '';
                    })(),
                    pending: Boolean(document.querySelector('[data-composer-quill="dock-pending"]')),
                })"""
            )
            elapsed = time.time() - start
            if first_chip is None and state["chip"]:
                first_chip = elapsed
            if first_ghost is None and state["ghost"]:
                first_ghost = elapsed
            if first_ghost is not None and first_chip is not None:
                break
            page.wait_for_timeout(60)

        print(f"首字节到浏览器后的可见时间：chip={first_chip and round(first_chip,2)}s ghost={first_ghost and round(first_ghost,2)}s")
        print("最终状态:", json.dumps(state, ensure_ascii=False)[:200])
        page.screenshot(path="stream-real.png")
        ok = first_ghost is not None and first_ghost < 6
        print("PASS 流式首字可见" if ok else "FAIL 首字过慢或未出现")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
