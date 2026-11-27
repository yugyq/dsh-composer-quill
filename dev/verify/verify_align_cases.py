"""Pixel alignment across the layouts a composer actually hits.

Case A: one line of text.
Case B: two lines (Shift+Enter), caret at the end of line 2.
Case C: trailing newline, caret on an empty line.
Case D: empty composer (ghost anchored to the content box).
"""

import os
from pathlib import Path
import io
import sys
import time
from playwright.sync_api import sync_playwright
from PIL import Image
import numpy as np

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


def ink_rows(shot: Image.Image):
    arr = np.asarray(shot.convert("RGB")).astype(int)
    lum = arr.sum(axis=2) / 3
    dark = lum < 90
    grey = (lum >= 100) & (lum < 185)
    def rows(mask):
        ys = np.where(mask.any(axis=1))[0]
        if len(ys) == 0:
            return None
        return int(ys.min()), int(ys.max())
    return rows(dark), rows(grey)


def clear(page):
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


def wait_ghost(page, timeout=25.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if page.evaluate("() => Boolean(document.querySelector('[data-composer-quill=\"text\"]'))"):
            return True
        page.wait_for_timeout(150)
    return False


def main() -> int:
    if not URL:
        print("usage: python verify_align_cases.py <url>")
        return 2
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(1800)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(500)
                break

        cases = []

        # A: one line
        clear(page)
        for ch in "帮我把这个报错的现象描述清楚":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(55)
        wait_ghost(page)
        page.wait_for_timeout(200)
        cases.append(("A 单行", page.locator("[data-composer-input]").screenshot()))

        # B: two lines, caret at the end of line 2
        clear(page)
        for ch in "帮我看下这个报错":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(50)
        page.keyboard.press("Shift+Enter")
        for ch in "另外请说明复现步骤":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(50)
        wait_ghost(page)
        page.wait_for_timeout(200)
        cases.append(("B 两行（光标在第二行）", page.locator("[data-composer-input]").screenshot()))

        # C: trailing newline -> caret on an empty line
        clear(page)
        for ch in "帮我看下这个报错":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(50)
        page.keyboard.press("Shift+Enter")
        page.wait_for_timeout(300)
        wait_ghost(page, timeout=6)
        page.wait_for_timeout(200)
        cases.append(("C 末行空行", page.locator("[data-composer-input]").screenshot()))

        # D: empty composer
        clear(page)
        wait_ghost(page, timeout=20)
        page.wait_for_timeout(400)
        cases.append(("D 空输入框", page.locator("[data-composer-input]").screenshot()))

        for name, raw in cases:
            shot = Image.open(io.BytesIO(raw))
            dark, grey = ink_rows(shot)
            shot.save(f"align-case-{name.split()[0]}.png")
            delta = None
            if dark and grey:
                delta = grey[0] - dark[0]
            print(f"{name}: 黑={dark} 灰={grey} 顶部差={delta if delta is not None else 'n/a'}")

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
