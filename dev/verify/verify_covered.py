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
GHOST = "() => { const t = document.querySelector('[data-composer-quill=\"text\"]'); return t && getComputedStyle(t).display !== 'none' ? t.textContent || '' : ''; }"
PREDICTS = "() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/predict')).length"


def main() -> int:
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
        for ch in "帮我把这个报错的现象":
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(55)

        # Wait until a proposal is on screen, then read its tail.
        deadline = 25000
        tail = ""
        waited = 0
        while waited < deadline:
            tail = page.evaluate(GHOST)
            if tail:
                break
            page.wait_for_timeout(200)
            waited += 200
        print(f"建议尾巴: {tail[:24]!r}")

        before = page.evaluate(PREDICTS)
        # Type two characters that the proposal already contains.
        if len(tail) >= 2:
            for ch in tail[:2]:
                page.keyboard.insert_text(ch)
                page.wait_for_timeout(80)
            page.wait_for_timeout(1000)
            during = page.evaluate(PREDICTS)
            page.wait_for_timeout(2200)
            after = page.evaluate(PREDICTS)
            print(f"predict 次数: 打字前 {before} → 连续输入后 1s {during} → 延时到期后 {after}")
            print("chip:", page.evaluate(CHIP)[:40])
            ok = during == before and after >= before
        else:
            print("tail too short to test")
            ok = False
        print("PASS 覆盖区间内未额外调用" if ok else "FAIL 仍有额外调用")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
