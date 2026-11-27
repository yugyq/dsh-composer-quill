"""Pixel-level check: does the grey ghost sit on the same ink row as the black text?

Takes an element screenshot of the composer, splits pixels into "dark ink"
(typed text) and "grey ink" (ghost), and compares the first/last inked row of
each column band.
"""

import os
from pathlib import Path
import io
import sys
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


def bands(img: Image.Image):
    arr = np.asarray(img.convert("RGB")).astype(int)
    lum = arr.sum(axis=2) / 3
    dark = lum < 90          # typed text
    grey = (lum >= 100) & (lum < 185)  # ghost text
    def rows(mask):
        ys = np.where(mask.any(axis=1))[0]
        return (int(ys.min()), int(ys.max())) if len(ys) else (None, None)
    return rows(dark), rows(grey)


def main() -> int:
    if not URL:
        print("usage: python verify_align_pixels.py <url>")
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
            page.wait_for_timeout(55)

        # Wait for a ghost to appear.
        for _ in range(120):
            if page.evaluate("() => Boolean(document.querySelector('[data-composer-quill=\"text\"]'))"):
                break
            page.wait_for_timeout(150)
        page.wait_for_timeout(300)

        editor = page.locator("[data-composer-input]")
        shot = Image.open(io.BytesIO(editor.screenshot()))
        shot.save("align-pixels.png")
        dark, grey = bands(shot)
        print(f"图像尺寸: {shot.size}")
        print(f"黑字墨迹行: {dark}  灰字墨迹行: {grey}")
        if dark[0] is not None and grey[0] is not None:
            print(f"顶部差 (灰 - 黑) = {grey[0] - dark[0]:+d}px ；底部差 = {grey[1] - dark[1]:+d}px")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
