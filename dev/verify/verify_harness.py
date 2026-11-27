"""Drive the local composer harness and report what actually renders.

Runs the real plugin client bundle against a faithful mock of the DSH composer
DOM (contenteditable[data-composer-input] inside .grow, placeholder sibling),
with real React. No DSH auth needed.

Covers the merged entry: one proposal per pause, shown as an inline tail when it
extends the draft, and as a dock chip rewrite when it also changes the draft.
"""

import os
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HARNESS = Path(__file__).resolve().parent.parent / "harness" / "index.html"
URL = HARNESS.as_uri()
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


def dump(page, label):
    snap = page.evaluate("() => window.__harness.snapshot()")
    print(f"\n--- {label} ---")
    print(json.dumps(snap, ensure_ascii=False, indent=2))
    return snap


def main() -> int:
    console: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 900, "height": 420})
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
        page.goto(URL, wait_until="load")
        page.wait_for_function("() => window.__harnessReady === true || window.__harnessError", timeout=15000)
        err = page.evaluate("() => window.__harnessError || ''")
        if err:
            print("HARNESS ERROR:", err)
        page.screenshot(path="harness-1-empty.png")
        dump(page, "1 empty composer")

        page.evaluate("() => window.__harness.type('帮我把这段日')")
        page.wait_for_timeout(1400)
        dump(page, "2 after typing (inline tail expected)")
        page.screenshot(path="harness-2-typing.png")

        page.evaluate("() => window.__harness.type('帮我把这段日的日')")
        page.wait_for_timeout(1300)
        dump(page, "2b after typing into the proposal (tail shrinks)")
        page.screenshot(path="harness-2b-following.png")

        # Stability: keep typing while a fresh request is in flight and count how
        # often the ghost disappears.
        page.evaluate("() => window.__harness.type('帮我把这段日的日志')")
        samples = []
        for _ in range(20):
            page.wait_for_timeout(150)
            samples.append(page.evaluate("() => ({ ghost: window.__harness.ghostNow(), dock: (document.querySelector('[data-composer-quill=\\'dock\\']') || {}).textContent || '' })"))
        ghost_on = [s for s in samples if s["ghost"] and s["ghost"].get("display") != "none" and s["ghost"].get("text")]
        dock_off = [i for i, s in enumerate(samples) if not s["dock"]]
        print(f"\nstability: inline ghost {len(ghost_on)}/{len(samples)}; dock blank at {dock_off}")
        print("tails seen:", sorted({s["ghost"]["text"] for s in ghost_on}))
        print("dock states:", sorted({s["dock"] for s in samples}))
        page.screenshot(path="harness-2c-stability.png")

        page.evaluate("() => window.__harness.accept()")
        page.wait_for_timeout(200)
        print("\nTab ->", page.evaluate("() => ({ inserted: window.__harnessInserted ?? null, setDraft: window.__harnessSetDraft ?? null })"))

        # A typo draft: the rewrite changes existing text, so the proposal can
        # only be shown as a chip and applied with setDraft.
        page.evaluate("() => window.__harness.type('帮我把这段曰志')")
        page.wait_for_timeout(1400)
        dump(page, "3 typo draft (rewrite chip, no inline)")
        page.screenshot(path="harness-3-rewrite.png")

        clicked = page.evaluate("() => window.__harness.clickChip()")
        page.wait_for_timeout(200)
        print("\nchip clicked:", clicked, "| setDraft:", page.evaluate("() => window.__harnessSetDraft || null"))

        # A failed request must not leave the composer saying "composing" forever.
        page.evaluate("() => { window.__harnessSetDraft = null; window.__harness.setComposeMode('fail-once'); window.__harness.type('帮我整理一下这段日志') }")
        states = []
        for _ in range(24):
            page.wait_for_timeout(200)
            states.append(page.evaluate("() => (document.querySelector('[data-composer-quill=\\'dock\\']') || {}).textContent || ''"))
        print("\nfail-once dock states:", sorted(set(states)))
        print("ends with a proposal:", bool(states[-1]) and '补写中' not in states[-1])

        # A "nothing to change" answer must hide the chip instead of parking it.
        page.evaluate("() => window.__harness.setComposeMode('unchanged')")
        page.evaluate("() => window.__harness.type('这段日志已经写好了不用改')")
        page.wait_for_timeout(2500)
        print("\nunchanged dock:", page.evaluate("() => (document.querySelector('[data-composer-quill=\\'dock\\']') || {textContent:''}).textContent"))

        if console:
            print("\n--- console ---")
            for line in console[:20]:
                print(" ", line)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

