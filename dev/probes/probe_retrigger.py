"""Probe three client situations to find where a second compose request comes from."""
from pathlib import Path
from playwright.sync_api import sync_playwright

HARNESS = (Path(__file__).resolve().parent.parent / "harness" / "index.html")

def chrome():
    root = Path.home() / "AppData" / "Local" / "ms-playwright"
    return str(sorted(root.glob("chromium-*/chrome-win/chrome.exe"), reverse=True)[0])

def count(page):
    calls = page.evaluate("() => window.__harness.calls")
    return len([c for c in calls if c.get("mode") == "compose"])

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=chrome())
    page = browser.new_page(viewport={"width": 980, "height": 480})
    page.goto(HARNESS.as_uri(), wait_until="domcontentloaded")
    page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
    h = lambda expr: page.evaluate("() => window.__harness." + expr)

    # A: pause -> suggestion -> continue typing inside it
    h("setSession('s-a')")
    page.wait_for_timeout(300)
    page.focus('[data-composer-input]')
    h("typeLive('帮我看下这个报错', {delay: 20})")
    page.wait_for_timeout(1500)
    base = count(page)
    h("type('，')")
    page.wait_for_timeout(4000)
    print(f"A 建议出现后再打一个字：compose 由 {base} → {count(page)}")

    # B: model says nothing to change; does the safety net ask again?
    page.reload()
    page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
    h("setSession('s-b')")
    page.wait_for_timeout(300)
    h("setComposeMode('unchanged')")
    page.focus('[data-composer-input]')
    h("typeLive('这段日志帮我整理一下', {delay: 20})")
    first = count(page)
    page.wait_for_timeout(6000)
    print(f"B 模型说无改动后静置 6 秒：compose {first} → {count(page)}")

    # C: failure path — does the automatic retry add a call?
    page.reload()
    page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
    h("setSession('s-c')")
    page.wait_for_timeout(300)
    h("setComposeMode('fail-once')")
    page.focus('[data-composer-input]')
    h("typeLive('这段日志帮我整理一下', {delay: 20})")
    page.wait_for_timeout(5000)
    print(f"C 第一次失败后重试：compose {count(page)} 次")

    browser.close()
