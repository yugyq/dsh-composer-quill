"""Open DSH settings and capture this plugin's row as it really renders."""

import os
from pathlib import Path
import json
import sys
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
        page.wait_for_timeout(1500)
        for label in ("继续", "Continue", "知道了"):
            button = page.locator(f"button:has-text('{label}')")
            if button.count() > 0:
                button.first.click()
                page.wait_for_timeout(400)
                break

        # The app's own shortcut is far more stable than clicking an avatar.
        page.keyboard.press("Control+Alt+Comma")
        page.wait_for_timeout(1200)
        opened = page.evaluate("() => document.body.innerText.includes('设置')")
        if not opened:
            height = page.viewport_size["height"] if page.viewport_size else 900
            page.mouse.click(29, height - 30)
            page.wait_for_timeout(800)
            entry = page.locator("text=设置")
            if entry.count() > 0:
                entry.first.click()
                page.wait_for_timeout(1200)

        general = page.locator("text=通用设置")
        if general.count() > 0:
            general.first.click()
            page.wait_for_timeout(1000)

        row = page.locator("[data-composer-quill='settings-row']")
        print("plugin row count:", row.count())
        if row.count() == 0:
            print("FAIL 设置里没有找到插件行")
            browser.close()
            return 1

        print("row text:", row.first.inner_text().replace("\n", " | ")[:160])
        print("row box:", row.first.bounding_box())
        row.first.screenshot(path="settings-row.png")
        page.screenshot(path="settings-general.png")

        # The controls must actually write the configuration.
        page.select_option("[data-composer-quill='settings-mode']", "manual")
        page.wait_for_timeout(400)
        stored = page.evaluate("() => localStorage.getItem('dsh.composer-quill.config')")
        current = page.evaluate("() => document.querySelector('[data-composer-quill=\"settings-mode\"]').value")
        print("stored:", stored)
        print("mode value:", current)
        page.select_option("[data-composer-quill='settings-mode']", "auto")
        page.wait_for_timeout(200)

        ok = current == "manual" and stored is not None and '"mode":"manual"' in stored
        print("PASS 设置行渲染且写入配置" if ok else "FAIL 设置行或持久化异常")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
