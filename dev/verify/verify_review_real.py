"""Post-review real check: rewrite still shows, Tab applies, no page errors."""

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
                    hint: (document.querySelector('[data-composer-quill="dock-hint"]') || {}).textContent || '',
                    ghost: (() => {
                        const t = document.querySelector('[data-composer-quill="text"]');
                        return t && getComputedStyle(t).display !== 'none' ? t.textContent || '' : '';
                    })(),
                    draft: (document.querySelector('[data-composer-input]') || {}).textContent || '',
                })"""
            )

        def type_text(text):
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
            page.wait_for_timeout(250)
            for ch in text:
                page.keyboard.insert_text(ch)
                page.wait_for_timeout(55)

        def wait_for(predicate, seconds):
            deadline = time.time() + seconds
            while time.time() < deadline:
                current = state()
                if predicate(current):
                    return current
                page.wait_for_timeout(200)
            return None

        # 1) A draft with a typo should produce a rewrite proposal (it was invisible after the first suggestion).
        type_text("帮我把这段日志整理一下,然后告诉我原因和具体改法")
        first = wait_for(lambda s: s["chip"] or s["ghost"], 25)
        print("首个建议:", (first or {}).get("chip", "")[:40])
        page.wait_for_timeout(1200)

        type_text("帮我把这段曰志整理一下,然后告诉我原因")
        rewrite = wait_for(lambda s: "改写" in s["chip"], 25)
        print("改写建议:", (rewrite or {}).get("chip", "")[:40] or "(未出现)")

        # 2) Tab applies a proposal in full.
        type_text("帮我把这段日志")
        tail = wait_for(lambda s: bool(s["ghost"]), 25)
        before = state()["draft"]
        page.keyboard.press("Tab")
        page.wait_for_timeout(400)
        after = state()
        print(f"Tab: {before!r} -> {after['draft']!r}")

        ok = bool(rewrite) and len(after["draft"]) > len(before) and not errors
        print(f"PASS 改写可见 + Tab 整条 + 无异常 (errors={errors[:1]})" if ok else f"FAIL errors={errors[:2]}")
        page.screenshot(path="review-real.png")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
