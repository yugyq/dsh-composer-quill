"""Verify a draft ending with a newline gets a tail ghost on the empty line."""

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
        return 2
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(1600)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(500)
                break

        page.evaluate("""() => {
            const e = document.querySelector('[data-composer-input]');
            e.focus();
            const r = document.createRange(); r.selectNodeContents(e); r.collapse(false);
            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        }""")
        for ch in "帮我看下这个报错":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(50)
        page.keyboard.press("Shift+Enter")
        page.wait_for_timeout(300)

        deadline = time.time() + 25
        shown = False
        while time.time() < deadline:
            if page.evaluate("() => Boolean(document.querySelector('[data-composer-quill=\"text\"]'))"):
                shown = True
                break
            page.wait_for_timeout(200)
        page.wait_for_timeout(300)

        info = page.evaluate("""() => {
            const g = document.querySelector('[data-composer-quill="text"]');
            const chip = document.querySelector('[data-composer-quill="dock-suggestion"]');
            const e = document.querySelector('[data-composer-input]');
            const pEl = e.querySelector('p');
            const gr = g ? g.getBoundingClientRect() : null;
            const pr = pEl ? pEl.getBoundingClientRect() : null;
            return {
              ghost: gr ? {y: Math.round(gr.y), h: Math.round(gr.height), text: (g.textContent || '').slice(0, 24)} : null,
              chip: chip ? (chip.textContent || '').slice(0, 40) : null,
              paragraph: pr ? {y: Math.round(pr.y), h: Math.round(pr.height)} : null,
              lineHeight: parseFloat(getComputedStyle(e).lineHeight),
            };
        }""")
        print(json.dumps(info, ensure_ascii=False, indent=2))
        page.screenshot(path="emptyline-ghost.png")

        ok = False
        if info["ghost"] and info["paragraph"]:
            second_line_top = info["paragraph"]["y"] + info["lineHeight"]
            delta = info["ghost"]["y"] - second_line_top
            print(f"第二行行首 y={second_line_top:.0f}，灰字 y={info['ghost']['y']}，偏差={delta:+.0f}px")
            ok = abs(delta) <= 2 and bool(info["ghost"]["text"])
        print("PASS 空行也有灰字且落在空行" if ok else "FAIL 空行未出现灰字或位置不对")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
