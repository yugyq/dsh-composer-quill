"""The language setting: renders, persists, and forces the output."""

import os
from pathlib import Path
import sys
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
CHIP = "() => (document.querySelector('[data-composer-quill=\"dock-suggestion\"]') || {}).textContent || ''"
SCRIPT = "() => { const t = document.querySelector('[data-composer-quill=\"text\"]'); return t && getComputedStyle(t).display !== 'none' ? t.textContent || '' : ''; }"


def focus_editor(page):
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


def clear(page):
    focus_editor(page)
    page.keyboard.press("Control+a")
    page.keyboard.press("Backspace")
    page.evaluate("() => window.localStorage.removeItem('dsh.composer-quill.suggestions')")
    page.wait_for_timeout(250)


def type_draft(page, text, wait=5000):
    clear(page)
    for ch in text:
        page.keyboard.insert_text(ch)
        page.wait_for_timeout(40)
    page.wait_for_timeout(wait)
    return page.evaluate(CHIP), page.evaluate(SCRIPT)


def open_settings(page):
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    page.keyboard.press("Control+Alt+Comma")
    page.wait_for_timeout(1100)
    general = page.locator("text=通用设置")
    if general.count() > 0:
        general.first.click()
        page.wait_for_timeout(700)


def set_language(page, value):
    open_settings(page)
    select = page.locator("[data-composer-quill='settings-language']").first
    select.select_option(value)
    page.wait_for_timeout(400)
    stored = page.evaluate("() => localStorage.getItem('dsh.composer-quill.config')")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    return stored


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

    open_settings(page)
    select = page.locator("[data-composer-quill='settings-language']").first
    print("语言选项:", select.evaluate("el => Array.from(el.options).map(o => o.value + ':' + o.textContent)"))
    print("默认值:", select.evaluate("el => el.value"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    chip, ghost = type_draft(page, "帮我把这个日志")
    print("跟随系统 + 中文草稿 ->", (chip or "(空白)")[:60])

    print("切到 English ->", set_language(page, "en"))
    chip, ghost = type_draft(page, "帮我把这个日志", wait=6000)
    print("强制英文 + 中文草稿 ->", (chip or "(空白)")[:70])

    chip, ghost = type_draft(page, "fix the flaky test", wait=6000)
    print("强制英文 + 英文草稿 ->", (chip or "(空白)")[:70])

    print("切回跟随系统 ->", set_language(page, "auto"))
    chip, ghost = type_draft(page, "帮我把这个日志", wait=6000)
    print("跟随系统 + 中文草稿 ->", (chip or "(空白)")[:70])

    page.screenshot(path="settings-language.png")
    browser.close()
