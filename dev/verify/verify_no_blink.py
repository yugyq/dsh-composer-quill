"""Typing continuously must not blank the ghost: sample it while typing."""

import os
from pathlib import Path
import sys
import time
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

GHOST = """() => {
  const t = document.querySelector('[data-composer-quill="text"]');
  const chip = document.querySelector('[data-composer-quill="dock-suggestion"]');
  const pending = document.querySelector('[data-composer-quill="dock-pending"]');
  return {
    ghost: t && getComputedStyle(t).display !== 'none' ? (t.textContent || '') : '',
    chip: chip ? (chip.textContent || '') : '',
    pending: Boolean(pending),
  };
}"""

TEXT = "帮我把刚才那段报错日志按时间顺序整理一下"

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
    page.keyboard.press("Control+a")
    page.keyboard.press("Backspace")
    page.wait_for_timeout(300)

    # Type like a person: 180 ms between keys, sampling the ghost on every key.
    samples = []
    appeared = False
    blanks_after_appear = 0
    for index, ch in enumerate(TEXT):
        page.keyboard.insert_text(ch)
        state = page.evaluate(GHOST)
        samples.append(state)
        if state["ghost"] or state["chip"]:
            appeared = True
        elif appeared:
            blanks_after_appear += 1
        page.wait_for_timeout(180)

    # Let the last request settle and look again.
    page.wait_for_timeout(5000)
    final = page.evaluate(GHOST)
    print(f"逐字采样 {len(samples)} 次；出现过建议={appeared}；出现过建议后又空白 {blanks_after_appear} 次")
    print(f"最终：ghost={final['ghost'][:40]!r} chip={final['chip'][:40]!r} pending={final['pending']}")
    ok = appeared and blanks_after_appear <= 1
    print("PASS 输入过程中灰字不再闪断" if ok else f"FAIL 闪断 {blanks_after_appear} 次")
    page.screenshot(path="no-blink.png")
    browser.close()
    sys.exit(0 if ok else 1)
