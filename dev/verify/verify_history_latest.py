"""History completion against the user's most recent conversation."""

import os
import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else ""
TITLE = sys.argv[2] if len(sys.argv) > 2 else "自己写输入补全插件并调试"
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
LOGS = [
    # The diagnostic log lives under the DSH profile or home directory.
    Path(os.environ.get("DSH_PROFILE_DIR", Path.home() / ".dsh")) / "composer-quill.log",
    Path(os.environ.get("DSH_HOME", Path.home() / ".dsh")) / "composer-quill.log",
]


def newest_session_id(after_iso: str):
    best = None
    for path in LOGS:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines()[-400:]:
            if '"stage":"dock"' not in line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("at", "") <= after_iso:
                continue
            sid = entry.get("sessionId")
            if sid and (best is None or entry["at"] > best[0]):
                best = (entry["at"], sid)
    return best[1] if best else None


def main() -> int:
    if not URL:
        return 2
    started_at = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
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

        opener = page.locator(f"text={TITLE}").first
        print("找到会话条目:", opener.count())
        opener.click()
        page.wait_for_timeout(3500)

        session_id = newest_session_id(started_at)
        print("session:", session_id)
        if not session_id:
            print("FAIL 没拿到 sessionId")
            return 1

        history = page.evaluate(
            """async (sessionId) => {
                const token = window.__DSH_COMPOSER_QUILL_TOKEN__ || '';
                const response = await fetch('/composer-quill/history', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-composer-quill-token': token },
                    body: JSON.stringify({ sessionId }),
                });
                return response.ok ? await response.json() : { error: response.status };
            }""",
            session_id,
        )
        items = history.get("items", []) if isinstance(history, dict) else []
        print("history items:", len(items))
        if not items:
            print("FAIL 该会话没有历史消息")
            return 1
        print("最近 3 条:", [item["text"][:18] for item in items[-3:]])

        sample = items[-1]["text"]
        prefix = sample[: max(3, min(6, len(sample) - 1))]
        print("取样:", sample[:24], "| 前缀:", prefix)

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

        started = time.time()
        for ch in prefix:
            page.keyboard.insert_text(ch)
            page.wait_for_timeout(30)

        first = None
        chip_text = ""
        while time.time() - started < 3.0:
            state = page.evaluate(
                """() => {
                    const chip = document.querySelector('[data-composer-quill="dock-suggestion"]');
                    const ghost = document.querySelector('[data-composer-quill="text"]');
                    return {
                        chip: chip ? chip.textContent || '' : '',
                        ghost: ghost && getComputedStyle(ghost).display !== 'none' ? ghost.textContent || '' : '',
                    };
                }"""
            )
            if state["chip"] or state["ghost"]:
                first = time.time() - started
                chip_text = state["chip"] or state["ghost"]
                break
            page.wait_for_timeout(20)

        elapsed = round(first, 2) if first is not None else None
        print(f"首个建议: {elapsed}s | {chip_text[:46]!r}")
        expects_tail = sample[len(prefix):]
        ok = first is not None and first < 0.6 and expects_tail[:4] in chip_text
        print("PASS 历史补全即时给出正确尾巴" if ok else "FAIL 历史补全未达预期")
        page.screenshot(path="history-real.png")

        # Leave the composer clean.
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        browser.close()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
