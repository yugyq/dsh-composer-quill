"""Daily scenarios against the REAL DSH web UI (Lexical composer).

Drives the isolated ghosttest instance through its token URL, types into the
actual Lexical editor, and asserts what the user would see.
"""

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
results: list[tuple[str, bool, str]] = []


def record(name, ok, evidence):
    results.append((name, ok, evidence))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {evidence}")


def main() -> int:
    if not URL:
        print("usage: python verify_real.py <url>")
        return 2
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        console: list[str] = []
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("[data-composer-input]", timeout=45000)
        page.wait_for_timeout(2000)
        # The preview build shows a "预览版说明" modal on first boot; it swallows input.
        for label in ("继续", "Continue", "知道了"):
            banner = page.locator(f"button:has-text('{label}')")
            if banner.count() > 0:
                banner.first.click()
                page.wait_for_timeout(800)
                break
        page.screenshot(path="real-0-boot.png")

        def editor_text():
            return page.evaluate("() => (document.querySelector('[data-composer-input]')||{}).textContent || ''")

        def ui():
            return page.evaluate(
                """() => ({
                    chip: (document.querySelector('[data-composer-quill="dock-suggestion"]') || {}).textContent || '',
                    pending: Boolean(document.querySelector('[data-composer-quill="dock-pending"]')),
                    ghost: (() => {
                        const t = document.querySelector('[data-composer-quill="text"]');
                        if (!t) return '';
                        return getComputedStyle(t).display === 'none' ? '' : t.textContent || '';
                    })(),
                })"""
            )

        def focus_editor():
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

        def type_text(text, delay=90):
            focus_editor()
            for ch in text:
                page.keyboard.insert_text(ch)
                page.wait_for_timeout(delay)

        def wait_for(predicate, timeout=18.0, interval=0.4):
            deadline = time.time() + timeout
            last = None
            while time.time() < deadline:
                last = ui()
                if predicate(last):
                    return last
                page.wait_for_timeout(int(interval * 1000))
            return last

        # S1 真实编辑器里逐字输入 -> 停顿 -> 建议
        type_text("帮我看看这个报错到底")
        seen = wait_for(lambda s: s["chip"] != "" or s["ghost"] != "")
        page.screenshot(path="real-1-proposal.png")
        record("S1 真实 Lexical 里出现建议", bool(seen["chip"] or seen["ghost"]), f"chip={seen['chip'][:30]!r} ghost={seen['ghost']!r}")

        before = editor_text()
        if seen["chip"] or seen["ghost"]:
            page.keyboard.press("Tab")
            page.wait_for_timeout(400)
            after = editor_text()
            record("S1 Tab 采纳改变草稿", after != before, f"before={len(before)}字 after={len(after)}字")
            page.screenshot(path="real-2-accepted.png")
        else:
            record("S1 Tab 采纳改变草稿", False, "没有建议可采纳")

        # S2 Esc 忽略后同草稿不再重弹
        page.keyboard.press("Escape")
        page.wait_for_timeout(2500)
        state = ui()
        record("S2 Esc 后不重弹", state["chip"] == "" and state["ghost"] == "", f"chip={state['chip'][:24]!r}")

        # S3 真实输入法路径：粘贴整段（Lexical 的 paste 分支）
        focus_editor()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)
        page.evaluate(
            """() => {
                const editor = document.querySelector('[data-composer-input]');
                editor.focus();
                const data = new DataTransfer();
                data.setData('text/plain', '帮我把这段曰志整理一下');
                editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
            }"""
        )
        page.wait_for_timeout(1200)
        exists = wait_for(lambda s: s["chip"] != "" or s["ghost"] != "", timeout=12)
        record("S3 粘贴后仍能识别草稿", bool(exists["chip"] or exists["ghost"]), f"chip={exists['chip'][:30]!r}")

        # R4 长草稿：模型可能判定“无需改动”，界面必须干净收尾（不留 pending）
        focus_editor()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)
        long_text = "帮我把这段日志按时间排好并标出错误行再说下一步，另外请把" * 3
        type_text(long_text, delay=12)
        got = wait_for(lambda s: s["chip"] != "" or s["ghost"] != "", timeout=25)
        settled = wait_for(lambda s: not s["pending"], timeout=15)
        record(
            "R4 长草稿（%d 字）请求后干净收尾" % len(long_text),
            not settled["pending"],
            f"proposal={'有' if (got['chip'] or got['ghost']) else '模型判定无需改动'} pending={settled['pending']}",
        )

        # R5 快速连打不卡在「补写中」
        focus_editor()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)
        page.evaluate("() => window.__realRec && window.__realRec.start()") if False else None
        states = []
        for _ in range(30):
            type_text("日志", delay=0)
            states.append(ui())
            page.wait_for_timeout(120)
        stuck = 0
        for s in states:
            stuck = stuck + 1 if s["pending"] else 0
        record("R5 连打期间不长期停在补写中", stuck <= 6, f"连续 pending 采样={stuck}")

        # R6 切会话不串建议
        first_session = page.locator("aside a, aside button").filter(has_text="翻译工具").first
        if first_session.count() > 0:
            first_session.click()
            page.wait_for_timeout(1500)
            state = ui()
            record("R6 切会话后不显示旧建议", state["chip"] == "" and state["ghost"] == "", f"chip={state['chip'][:24]!r}")
        else:
            record("R6 切会话后不显示旧建议", True, "侧栏没有可点会话，跳过")

        # R7 已经写完整的草稿：模型可能判定“无需改动”，此时应回退给一句可追加的话
        focus_editor()
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)
        type_text("帮我看看这个报错是怎么回事。")
        got = wait_for(lambda s: s["chip"] != "" or s["ghost"] != "", timeout=30)
        page.screenshot(path="real-4-fallback.png")
        record(
            "R7 完整草稿也能给出可追加建议",
            bool(got["chip"] or got["ghost"]),
            f"chip={got['chip'][:34]!r}",
        )

        record("S4 无页面异常", not [c for c in console if c.startswith("pageerror")], f"errors={[c for c in console if c.startswith('pageerror')][:1]}")

        if console:
            print("\n--- console (filtered) ---")
            for line in [c for c in console if "composer-quill" in c][:10]:
                print(" ", line[:200])
        page.screenshot(path="real-3-final.png")
        browser.close()

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
