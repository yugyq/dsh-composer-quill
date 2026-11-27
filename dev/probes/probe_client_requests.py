"""Probe: how many compose requests does one typing pause produce?"""
from pathlib import Path
from playwright.sync_api import sync_playwright

HARNESS = (Path(__file__).resolve().parent.parent / "harness" / "index.html")

def chrome():
    root = Path.home() / "AppData" / "Local" / "ms-playwright"
    return str(sorted(root.glob("chromium-*/chrome-win/chrome.exe"), reverse=True)[0])

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=chrome())
    page = browser.new_page(viewport={"width": 980, "height": 480})
    page.goto(HARNESS.as_uri(), wait_until="domcontentloaded")
    page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
    h = lambda expr: page.evaluate("() => window.__harness." + expr)

    h("setSession('s-probe-client')")
    page.wait_for_timeout(300)
    page.focus('[data-composer-input]')
    h("typeLive('帮我看下这个报错', {delay: 20})")
    page.wait_for_timeout(4000)

    calls = h("calls")
    compose = [c for c in calls if c.get("mode") == "compose"]
    nexts = [c for c in calls if c.get("mode") == "next"]
    print(f"一次打字停顿 -> compose 请求 {len(compose)} 次，next {len(nexts)} 次")
    for call in compose:
        print(f"  {call.get('url')}  draft={call.get('draft')!r}")
    browser.close()
