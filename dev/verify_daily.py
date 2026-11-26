"""Daily-usage simulation for dsh-composer-quill.

Drives the real plugin client bundle in Chromium against a faithful composer
mock, with human-like typing (per-character input, pauses, corrections, IME
composition, Esc, Tab, Enter) and records every UI state change at 50 ms.

Each scenario prints PASS/FAIL with the evidence used.
"""

import os
import json
import sys
from pathlib import Path
import time
from playwright.sync_api import sync_playwright

HARNESS = Path(__file__).resolve().parent / "harness" / "index.html"
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

results: list[tuple[str, bool, str]] = []


class _ScenarioLimit(Exception):
    """Raised once the requested number of scenarios has run."""


def record(name: str, ok: bool, evidence: str) -> None:
    results.append((name, ok, evidence))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {evidence}")
    limit = int(os.environ.get("DSH_SCENARIO_LIMIT", "0") or 0)
    if limit > 0 and len(results) >= limit:
        raise _ScenarioLimit()


def longest_run(samples, pred):
    best = 0
    start = None
    for sample in samples:
        if pred(sample):
            if start is None:
                start = sample["t"]
            best = max(best, sample["t"] - start)
        else:
            start = None
    return best


def proposal_of(snap):
    """Text of the suggestion chip (the dock row is always present now)."""
    return (snap.get("proposal") or {}).get("text", "")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME or None)
        page = browser.new_page(viewport={"width": 980, "height": 480})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="load")
        page.wait_for_function("() => window.__harnessReady === true || window.__harnessError", timeout=15000)
        if page.evaluate("() => window.__harnessError || ''"):
            print("HARNESS ERROR", page.evaluate("() => window.__harnessError"))
            return 1

        h = lambda expr: page.evaluate(f"() => window.__harness.{expr}")

        def reset(draft=""):
            h("resetLearning()")
            h(f"type({json.dumps(draft)})")

        def compose_calls():
            return len([c for c in h("calls") if c["mode"] == "compose"])

        # ---- S1 日常短句：逐字输入 -> 停顿 -> 建议 -> Tab
        reset("")
        h("typeLive('帮我看下这个报错')")
        page.wait_for_timeout(1600)
        snap = h("snapshot()")
        chip = proposal_of(snap)
        ghost = snap["text"]["text"] if snap["text"] else ""
        ok = bool(chip) and ("按 Tab" in chip) and bool(ghost)
        record("S1 逐字输入后给出建议", ok, f"chip={chip[:28]!r} ghost={ghost!r}")
        h("accept()")
        page.wait_for_timeout(150)
        inserted = page.evaluate("() => window.__harnessInserted || null")
        record("S1 Tab 采纳", bool(inserted), f"inserted={inserted!r}")

        # ---- S2 快速连打：不应卡在补写中，也不应长时间空白
        reset("")
        h("rec.start(50)")
        h("typeLive('帮我把这段日志整理一下顺便把报错的行标出来再给下一步建议', {delay: 70})")
        page.wait_for_timeout(2500)
        samples = h("rec.stop()")
        stuck = longest_run(samples, lambda s: s["pending"])
        tail = samples[-10:]
        responded = any(s["proposal"] or s["ghost"] for s in tail)
        record("S2 快速连打不卡在补写中", len(samples) >= 10 and stuck <= 4000, f"最长 pending={stuck}ms samples={len(samples)}")
        record("S2 停顿后 2.5s 内有反馈", responded, f"末尾状态={tail[-1]['proposal'][:24]!r}")

        # ---- S3 中途改主意：旧建议不得覆盖新输入
        reset("")
        h("typeLive('帮我把这段日志', {delay: 60})")
        page.wait_for_timeout(1600)
        page.evaluate("() => { window.__harnessSetDraft = null; window.__harnessInserted = null }")
        h("typeLive('，另外贴一下配置文件', {delay: 60})")
        page.wait_for_timeout(250)
        h("accept()")
        page.wait_for_timeout(150)
        applied = page.evaluate("() => ({ inserted: window.__harnessInserted, setDraft: window.__harnessSetDraft })")
        stale = applied["setDraft"] is not None and "另外" not in (applied["setDraft"] or "")
        record("S3 改主意后不套用过时改写", not stale, f"applied={applied}")
        # Wait until a fresh proposal is actually on screen (the request for the
        # extended draft has to land first), then accept it.
        deadline = time.time() + 6.0
        ready = False
        while time.time() < deadline:
            snap = h("snapshot()")
            button = page.evaluate("() => Boolean(document.querySelector('[data-composer-quill=\"dock-suggestion\"]'))")
            if button:
                ready = True
                break
            page.wait_for_timeout(150)
        page.evaluate("() => { window.__harnessInserted = null; window.__harnessSetDraft = null }")
        h("accept()")
        page.wait_for_timeout(200)
        fresh = page.evaluate("() => ({ inserted: window.__harnessInserted, setDraft: window.__harnessSetDraft })")
        ok = fresh["inserted"] is not None or (fresh["setDraft"] is not None and "另外" in fresh["setDraft"])
        recent = page.evaluate("() => [...new Set(window.__harness.calls.filter(c => c.mode === 'compose').map(c => c.draft))].slice(-3)")
        record("S3b 新建议仍可采纳", ready and ok, f"applied={fresh} ready={ready} compose_drafts={recent}")

        # ---- S4 错字：整段改写
        reset("")
        h("typeLive('帮我把这段曰志', {delay: 60})")
        page.wait_for_timeout(1600)
        snap = h("snapshot()")
        chip = proposal_of(snap)
        page.evaluate("() => { window.__harnessSetDraft = null }")
        h("accept()")
        page.wait_for_timeout(150)
        applied = page.evaluate("() => window.__harnessSetDraft || null")
        ok = "采用改写" in chip and applied is not None and "日志" in applied
        record("S4 错字走整段改写", ok, f"chip={chip[:24]!r} setDraft={str(applied)[:24]!r}")

        # ---- S5 Esc 忽略：同一草稿不再自动弹出
        reset("")
        h("typeLive('帮我把这段日志', {delay: 60})")
        page.wait_for_timeout(1600)
        h("press({key: 'Escape'})")
        page.wait_for_timeout(2200)
        snap = h("snapshot()")
        chip = proposal_of(snap)
        ghost = snap["text"]["text"] if snap["text"] else ""
        record("S5 Esc 后同草稿不再重弹", chip == "" and ghost == "", f"chip={chip!r} ghost={ghost!r}")

        # ---- S50 连续忽略三次：整段改写暂停，尾巴照常，采纳一次恢复
        # S5 already spent one ignore in this page's store, so start from a clean one.
        page.reload()
        page.wait_for_selector("[data-composer-input]")

        def ignore_one(draft):
            reset("")
            h(f"typeLive({draft!r}, {{delay: 40}})")
            page.wait_for_timeout(1700)
            first = proposal_of(h("snapshot()"))
            h("press({key: 'Escape'})")
            page.wait_for_timeout(200)
            return first

        first = ignore_one('这段曰志报错了')
        second = ignore_one('这段曰志报错了两处')
        third = ignore_one('这段曰志报错了两处还')
        # The fourth rewrite is requested but must not be painted.
        reset("")
        calls_before = compose_calls()
        h("typeLive('这段曰志报错了两处还有堆栈', {delay: 40})")
        page.wait_for_timeout(1900)
        suppressed = proposal_of(h("snapshot()"))
        asked = compose_calls() - calls_before
        # A tail is not a rewrite: it still arrives.
        reset("")
        h("typeLive('这段日志里有个 409', {delay: 40})")
        page.wait_for_timeout(1700)
        tail = proposal_of(h("snapshot()"))
        record(
            "S50 忽略三次后不再画改写、尾巴照常",
            all("采用改写" in c for c in (first, second, third)) and asked >= 1 and suppressed == "" and "按 Tab" in tail,
            f"三次改写={['采用改写' in first, '采用改写' in second, '采用改写' in third]} 第四次请求={asked} 压制后={suppressed!r} 尾巴={tail[:20]!r}",
        )
        # One acceptance earns rewrites back.
        h("accept()")
        page.wait_for_timeout(300)
        reset("")
        h("typeLive('这段曰志报错了两处还有别', {delay: 40})")
        page.wait_for_timeout(1900)
        restored = proposal_of(h("snapshot()"))
        record("S50b 采纳一次后改写恢复", "采用改写" in restored, f"chip={restored[:24]!r}")

        # ---- S51 等待期：只有草稿真的继续下去的那部分能留在屏幕上
        # 预填（把上一轮的答案先画出来、等真答案到了再换）会把一句用户已经读到的话
        # 在他眼前改写。实测同一草稿多打一个字，新答案在预填文本第 1 个字左右就分叉，
        # 所以这条不变量必须钉住：屏幕上只允许出现「草稿 + 旧答案」仍然成立的那截，
        # 任何按长度硬裁、按猜测补出来的文字都算回归。
        h("setComposeMode('echo')")
        h("setComposeTiming({first: 0, step: 20})")
        reset("")
        base_draft = "把消费面板按天汇总"
        h(f"typeLive({json.dumps(base_draft)}, {{delay: 40}})")
        page.wait_for_timeout(1200)
        base_tail = (h("snapshot()")["text"] or {}).get("text", "")
        # 把模型调慢，让「等待期」长到能被采样
        h("setComposeTiming({first: 1500, step: 120})")
        edited = base_draft + base_tail[:1]  # 用户顺着建议又打了一个字
        h("rec.start(40)")
        h(f"type({json.dumps(edited)})")
        page.wait_for_timeout(600)
        during = h("rec.stop()")
        # 只判「编辑器里已经是新草稿」的那些采样：早于输入落地的采样画旧尾巴是对的。
        seen = [s for s in during if s["draft"] == edited]
        kept = {s["ghost"] for s in seen}
        expected_new = "，接着查「" + edited[-4:] + "」那几条 409。"
        settled_new = ""
        for _ in range(45):
            settled_new = (h("snapshot()")["text"] or {}).get("text", "")
            if settled_new == expected_new:
                break
            page.wait_for_timeout(100)
        record(
            "S51 等待期只留草稿继续的那部分",
            bool(base_tail) and bool(seen) and kept <= {"", base_tail[1:]} and settled_new == expected_new,
            f"旧尾巴={base_tail[:14]!r} 采样={len(seen)} 条 灰字={sorted(kept)!r} 到达后={settled_new[:16]!r}",
        )

        # ---- S51b 草稿没继续旧答案：等待期一个字都不许画
        h("setComposeTiming({first: 0, step: 20})")
        reset("")
        base2 = "把重试次数也统计进去"
        h(f"typeLive({json.dumps(base2)}, {{delay: 40}})")
        page.wait_for_timeout(1200)
        base2_tail = (h("snapshot()")["text"] or {}).get("text", "")
        h("setComposeTiming({first: 1500, step: 120})")
        diverged = base2 + "★"  # 旧答案里没有这个字，草稿不再继续它
        h("rec.start(40)")
        h(f"type({json.dumps(diverged)})")
        page.wait_for_timeout(600)
        during2 = h("rec.stop()")
        seen2 = [s for s in during2 if s["draft"] == diverged]
        painted = {s["ghost"] for s in seen2}
        expected2 = "，接着查「" + diverged[-4:] + "」那几条 409。"
        settled2 = ""
        for _ in range(45):
            settled2 = (h("snapshot()")["text"] or {}).get("text", "")
            if settled2 == expected2:
                break
            page.wait_for_timeout(100)
        record(
            "S51b 旧答案接不上时等待期不画任何字",
            bool(base2_tail) and bool(seen2) and painted == {""} and settled2 == expected2,
            f"旧尾巴={base2_tail[:14]!r} 采样={len(seen2)} 条 灰字={sorted(painted)!r} 到达后={settled2[:16]!r}",
        )
        h("setComposeMode('ok')")
        h("setComposeTiming({first: 0, step: 220})")

        # ---- S51c 采纳插入的就是屏幕上那截灰字
        # Tab 按下的那一刻，编辑器可能已经比宿主状态新一帧。按旧草稿裁剪会把用户刚
        # 打的字再插一遍；灰字为空时按 Tab 也不该插任何东西。
        h("setComposeMode('echo')")
        h("setComposeTiming({first: 0, step: 20})")
        reset("")
        base3 = "把失败原因也带上"
        h(f"typeLive({json.dumps(base3)}, {{delay: 40}})")
        page.wait_for_timeout(1200)
        base3_tail = (h("snapshot()")["text"] or {}).get("text", "")
        # 让下一次请求慢到不会在采纳前插话（2.5 秒）
        h("setComposeTiming({first: 2500, step: 120})")
        ahead = base3 + base3_tail[:1]
        h(f"typeAhead({json.dumps(ahead)})")
        h("accept()")
        page.wait_for_timeout(200)
        accepted = h("draft()")
        wanted = base3 + base3_tail
        record(
            "S51c 采纳只插入屏幕上那截灰字",
            bool(base3_tail) and accepted == wanted,
            f"旧尾巴={base3_tail[:12]!r} 采纳后={accepted!r} 期望={wanted!r}",
        )
        # ---- S51d 工具条文案和灰字必须是同一截
        # 灰字在绘制时裁剪，工具条只能在渲染时裁剪。按键之后宿主状态可能还慢一拍，
        # 那一拍里两边会指向不同的尾巴；所以按键本身要能把这一行重新渲染出来。
        h("setComposeMode('echo')")
        h("setComposeTiming({first: 0, step: 20})")
        reset("")
        base4 = "把调用链也画出来"
        h(f"typeLive({json.dumps(base4)}, {{delay: 40}})")
        page.wait_for_timeout(1200)
        base4_tail = (h("snapshot()")["text"] or {}).get("text", "")
        h("setComposeTiming({first: 2500, step: 120})")
        ahead4 = base4 + base4_tail[:1]
        # 每次 DOM 变化都读一次：不一致只活到下一帧，定时采样会漏掉它（试过，漏）。
        # 工具条是「<提示>：<尾巴>」，按第一个全角冒号切出尾巴再和灰字比。
        def chip_tail_of(text):
            return text.split("：", 1)[1].strip() if "：" in text else text.strip()

        seen4 = h(f"typeAheadWatched({json.dumps(ahead4)})")
        pairs4 = [
            (chip_tail_of(s["chip"]), s["ghost"])
            for s in seen4["frames"]
            if s["ghost"] and chip_tail_of(s["chip"])
        ]
        disagree4 = [p for p in pairs4 if p[0] != p[1]]
        record(
            "S51d 工具条文案与灰字同一截",
            bool(base4_tail) and bool(pairs4) and not disagree4,
            f"旧尾巴={base4_tail[:10]!r} 变化帧={len(pairs4)} 条 不一致={len(disagree4)} 条"
            + (f" 例={disagree4[0][0]!r} vs {disagree4[0][1]!r}" if disagree4 else ""),
        )
        # ---- S54 按键和 Tab 落在同一拍时，采纳仍然补完这句话（issue #8）
        # 灰字是上一拍算出来的，编辑器可能已经多了一个字而宿主还没重渲染。旧规则在这种
        # 情况下返回空、什么也不插。用建议本身重新对齐，插进去的只会比灰字更短，所以
        # 屏幕上永远不会出现用户没读到过的字。
        h("setComposeMode('echo')")
        h("setComposeTiming({first: 0, step: 20})")
        reset("")
        base5 = "把重试的间隔也写进去"
        h(f"typeLive({json.dumps(base5)}, {{delay: 40}})")
        page.wait_for_timeout(1200)
        base5_tail = (h("snapshot()")["text"] or {}).get("text", "")
        h("setComposeTiming({first: 2500, step: 120})")
        ahead5 = base5 + base5_tail[:1]
        # DOM 里打字和按 Tab 之间不插渲染：React 来不及把 current 换成新草稿。
        typed5 = h(f"typeAheadAccept({json.dumps(ahead5)})")
        page.wait_for_timeout(200)
        accepted5 = h("draft()")
        wanted5 = base5 + base5_tail
        record(
            "S54 同一拍里按键再采纳，补完这句话",
            bool(base5_tail) and typed5 == ahead5 and accepted5 == wanted5,
            f"灰字={base5_tail[:12]!r} 按键后={typed5!r} 采纳后={accepted5!r} 期望={wanted5!r}",
        )
        # ---- S54b 编辑器被别处改过、宿主还不知道时，Tab 用建议本身对齐（issue #8）
        # 「DOM 变了但 React 还没收到」这种状态在本应用里只有一个来源：外部改动或组字。
        # 这时按旧尾巴裁剪会得到空串（什么也不插），用建议本身重算能补完这句话，而且
        # 插进去的仍然是灰字里已经出现过的那截。
        h("setComposeTiming({first: 0, step: 20})")
        reset("")
        base6 = "把失败率也一起统计"
        h(f"typeLive({json.dumps(base6)}, {{delay: 40}})")
        page.wait_for_timeout(1200)
        base6_tail = (h("snapshot()")["text"] or {}).get("text", "")
        h("setComposeTiming({first: 2500, step: 120})")
        ahead6 = base6 + base6_tail[:1]
        h(f"typeSilentAccept({json.dumps(ahead6)})")   # 没有 input 事件：宿主状态停在旧草稿
        page.wait_for_timeout(200)
        accepted6 = h("draft()")
        wanted6 = base6 + base6_tail
        record(
            "S54b 宿主不知道编辑器改了字时，采纳照样补完这句话",
            bool(base6_tail) and accepted6 == wanted6,
            f"灰字={base6_tail[:12]!r} 采纳后={accepted6!r} 期望={wanted6!r}",
        )
        h("setComposeMode('ok')")
        h("setComposeTiming({first: 0, step: 220})")

        # ---- S6 请求失败一次：自动重试并恢复
        h("setComposeMode('fail-once')")
        reset("")
        h("typeLive('这段日志重新试一下', {delay: 60})")
        page.wait_for_timeout(4200)
        snap = h("snapshot()")
        chip = proposal_of(snap)
        record("S6 失败后自动重试恢复", "按 Tab" in chip, f"chip={chip[:28]!r}")
        h("setComposeMode('ok')")

        # ---- S7 IME 组字期间不发新请求
        reset("")
        h("typeLive('这段日志', {delay: 60})")
        page.wait_for_timeout(1600)
        before = compose_calls()
        page.evaluate(
            """() => {
                const editor = document.querySelector('[data-composer-input]');
                editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
                editor.textContent = '这段日志还有';
                editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '还有' }));
            }"""
        )
        page.wait_for_timeout(1400)
        during = compose_calls()
        page.evaluate("() => document.querySelector('[data-composer-input]').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))")
        h("key('。')")
        page.wait_for_timeout(1800)
        after = compose_calls()
        record("S7 组字期间不打断", during == before and after > during, f"calls before/during/after={before}/{during}/{after}")

        # ---- S8 发送后清空，不残留
        h("press({key: 'Enter'})")
        page.wait_for_timeout(400)
        snap = h("snapshot()")
        chip = proposal_of(snap)
        record("S8 发送后清空建议", chip == "", f"chip={chip!r}")

        # ---- S10 长草稿（150 字）
        long_draft = "帮我把这段日志按时间顺序整理成一张表，标出错误行，并给出下一步排查建议。" * 4
        reset("")
        h(f"typeLive({json.dumps(long_draft)}, {{delay: 8}})")
        page.wait_for_timeout(2000)
        snap = h("snapshot()")
        chip = proposal_of(snap)
        record("S10 长草稿仍给建议", "按 Tab" in chip, f"len={len(long_draft)} chip={chip[:26]!r}")

        # ---- S11 单字草稿也会请求（0.9.0 取消了 3 字下限）
        reset("")
        before = compose_calls()
        h("typeLive('好', {delay: 60})")
        page.wait_for_timeout(1500)
        after = compose_calls()
        snap = h("snapshot()")
        record(
            "S11 单字草稿也给建议",
            after > before and bool(proposal_of(snap) or (snap["text"]["text"] if snap["text"] else "")),
            f"compose calls {before}->{after} chip={proposal_of(snap)[:20]!r}",
        )

        # ---- S12 切会话不串建议
        reset("")
        h("typeLive('这段日志', {delay: 60})")
        page.wait_for_timeout(1600)
        page.evaluate("() => window.__harness.setSession('s-other')")
        page.wait_for_timeout(300)
        snap = h("snapshot()")
        chip = proposal_of(snap)
        ghost = snap["text"]["text"] if snap["text"] else ""
        record("S12 切会话后不显示旧会话建议", chip == "" and ghost == "", f"chip={chip!r} ghost={ghost!r}")
        page.evaluate("() => window.__harness.setSession('s-harness')")

        # ---- S48 切会话立刻清灰字（issue #5 的第 1 条）
        reset("")
        h("clearSuggestions()")
        h("setSession('s48-a')")
        before_switch = ""
        for _ in range(25):
            page.wait_for_timeout(200)
            before_switch = (h("snapshot()")["text"] or {}).get("text", "")
            if before_switch:
                break
        store_a = h("store()")
        h("setSession('s48-b')")
        page.wait_for_timeout(120)
        after_switch = (h("snapshot()")["text"] or {}).get("text", "")
        record(
            "S48 切会话立刻清掉上一个会话的灰字",
            bool(before_switch) and after_switch == "",
            f"切前={before_switch[:14]!r} 切后120ms={after_switch[:14]!r} store={str(store_a)[:60]}",
        )

        # ---- S53 切会话掐掉在飞的补全请求（issue #7）
        reset("")
        h("clearSuggestions()")
        h("setComposeTiming({first: 2500, step: 200})")
        h("resetMetrics()")
        h("setSession('s53-a')")
        page.wait_for_timeout(200)
        s53_draft = '帮我把这段报错查一下'
        h(f"typeLive({s53_draft!r}, {{delay: 20}})")
        page.wait_for_timeout(900)          # 请求在飞：首字 2500ms 还没到
        sent_before = len([c for c in h("calls") if c.get("mode") == "compose"])
        h("setSession('s53-b')")
        page.wait_for_timeout(700)
        aborted = h("aborts()")
        after_calls = [c for c in h("calls") if c.get("mode") == "compose"][sent_before:]
        stale = [c for c in after_calls if c.get("draft") == s53_draft]
        record(
            "S53 切会话掐掉在飞的补全请求",
            sent_before >= 1 and aborted >= 1 and len(stale) == 0,
            f"切前 compose={sent_before} 取消={aborted} 切后同草稿={len(stale)}",
        )
        h("setComposeTiming({first: 0, step: 220})")

        # ---- S49 宿主说空、编辑器里还有字时不许画 box 灰字（issue #5 的第 2 条）
        reset("")
        h("clearSuggestions()")
        h("setSession('s49')")
        painted_with_empty = ""
        for _ in range(25):
            page.wait_for_timeout(200)
            painted_with_empty = (h("snapshot()")["text"] or {}).get("text", "")
            if painted_with_empty:
                break
        page.evaluate(
            """() => {
                const editor = document.querySelector('[data-composer-input]');
                if (editor) {
                    editor.textContent = '上一个会话留下的文字';
                    window.dispatchEvent(new Event('resize'));
                }
            }"""
        )
        page.wait_for_timeout(500)
        painted_with_text = (h("snapshot()")["text"] or {}).get("text", "")
        record(
            "S49 编辑器不空时不画 box 灰字",
            bool(painted_with_empty) and painted_with_text == "",
            f"空编辑器时={painted_with_empty[:12]!r} 有文字时={painted_with_text[:12]!r}",
        )
        page.evaluate(
            """() => {
                const editor = document.querySelector('[data-composer-input]');
                if (editor) editor.textContent = '';
            }"""
        )
        h("type('')")

        # ---- S13 灰字必须和正文落在同一个行盒里
        reset("")
        h("typeLive('帮我把这个报错的现象描述清楚', {delay: 60})")
        page.wait_for_timeout(1500)
        align = h("align()")
        ok = bool(align) and align.get("delta") is not None and abs(align["delta"]) <= 1.0
        record("S13 灰字与正文行盒对齐", ok, f"align={align}")

        # ---- S14 本地历史补全：模型还没回，历史就该先顶上
        reset("")
        h("typeLive('帮我把这段日志', {delay: 40})")
        started = time.time()
        first_chip = None
        chip_text = ""
        while time.time() - started < 2.0:
            snap = h("snapshot()")
            chip = proposal_of(snap)
            if chip:
                first_chip = time.time() - started
                chip_text = chip
                break
            page.wait_for_timeout(30)
        record(
            "S14 本地历史补全毫秒级兜底",
            first_chip is not None and first_chip < 0.45 and "历史" in chip_text,
            f"首个建议 {first_chip and round(first_chip, 2)}s chip={chip_text[:24]!r}",
        )

        # ---- S15 Tab 一次取完整条建议（0.9.0 取消逐词）
        reset("")
        h("typeLive('帮我把这段日志', {delay: 40})")
        page.wait_for_timeout(1500)
        before_len = len(h("draft()"))
        page.evaluate("() => { window.__harnessInserted = null }")
        h("accept(false)")
        page.wait_for_timeout(300)
        inserted = page.evaluate("() => window.__harnessInserted")
        after_len = len(h("draft()"))
        state = h("snapshot()")
        record(
            "S15 Tab 一次取完建议",
            bool(inserted) and after_len > before_len and not proposal_of(state),
            f"插入={str(inserted)[:18]!r} 长度 {before_len}->{after_len} 仍在显示={bool(proposal_of(state))}",
        )

        # ---- S16 采纳后清空文本，建议应重新弹出
        reset("")
        h("typeLive('帮我把这段日志', {delay: 40})")
        page.wait_for_timeout(1500)
        h("accept()")
        page.wait_for_timeout(300)
        after_accept = h("draft()")
        h("type('')")                      # 把输入框清空
        deadline = time.time() + 4.0
        chip = ghost = ""
        while time.time() < deadline:
            snap = h("snapshot()")
            chip = proposal_of(snap)
            ghost = snap["text"]["text"] if snap["text"] else ""
            if "按 Tab 采纳" in chip:
                break
            page.wait_for_timeout(120)
        record(
            "S16 清空文本后建议重新弹出",
            bool(chip) and ("按 Tab 采纳" in chip),
            f"采纳后={after_accept[:12]!r} 清空后 chip={chip[:26]!r} ghost={ghost[:16]!r}",
        )

        # ---- S22 切换会话：键没变时复用存储，而不是重新采样
        reset("")
        h("setSession('sess-a')")
        chip = ""
        for _ in range(24):
            page.wait_for_timeout(250)
            chip = proposal_of(h("snapshot()"))
            if "按 Tab 采纳" in chip:
                break
        first_chip = chip
        h("setSession('sess-b')")
        page.wait_for_timeout(1500)
        # Only look at what happens after coming back to the first Session.
        h("calls.length = 0")
        h("setSession('sess-a')")
        page.wait_for_timeout(2000)
        hydrated = [c for c in h("calls") if c.get("mode") == "beacon" and c.get("event") == "hydrated"]
        predicts = [c for c in h("calls") if c.get("mode") in ("next", "compose")]
        print('   [S22 全部调用]', [(c.get('mode'), c.get('event'), c.get('draft')) for c in h('calls')])
        again = proposal_of(h("snapshot()"))
        record(
            "S22 切回会话命中存储（hydrated）",
            bool(first_chip) and bool(hydrated) and bool(again),
            f"首次={first_chip[:14]!r} 切回={again[:14]!r} hydrated={len(hydrated)} 模型请求={[(c.get('mode'), c.get('draft')) for c in predicts]}",
        )

        # ---- S17 dock 行常驻：空闲时也在，且高度不跳
        reset("")
        page.wait_for_timeout(600)
        idle = h("snapshot()")
        idle_dock = idle["dock"]
        idle_hint = (idle.get("hint") or {}).get("text", "")
        page.wait_for_timeout(1500)
        typing = h("snapshot()")
        dock_heights = [x["dock"]["rect"]["h"] for x in (idle, typing) if x["dock"]]
        record(
            "S17 建议行常驻不消失",
            bool(idle_dock) and bool(typing["dock"]) and len(set(dock_heights)) <= 1
            and bool(idle_hint or (idle.get("proposal") or {}).get("text")),
            f"空闲 hint={idle_hint[:16]!r} proposal={((idle.get('proposal') or {}).get('text') or '')[:16]!r} 高度={dock_heights}",
        )

        # ---- S18 草稿在建议之内继续输入：复用旧尾巴，延后请求
        reset("")
        h("typeLive('帮我把这段日志', {delay: 40})")
        page.wait_for_timeout(2000)
        base_calls = compose_calls()
        # 继续打「建议尾巴」里的字：此刻建议仍然覆盖草稿
        h("typeLive('，找出', {delay: 60})")
        page.wait_for_timeout(1000)          # 小于延后的 1.2 s
        during = compose_calls()
        ghost_now = h("snapshot()")
        tail_visible = bool((ghost_now["text"]["text"] if ghost_now["text"] else "") or proposal_of(ghost_now))
        page.wait_for_timeout(2200)          # 超过延后阈值
        after = compose_calls()
        record(
            "S18 前缀延长期间复用旧建议",
            during == base_calls and after > base_calls and tail_visible,
            f"calls {base_calls}->{during}->{after} 期间仍有建议={tail_visible}",
        )

        # ---- S19 流式期间灰字要逐步变长（不是只画第一个 delta）
        reset("")
        h("rec.start(60)")
        h("typeLive('帮我把这段日志', {delay: 30})")
        page.wait_for_timeout(2200)
        samples = h("rec.stop()")
        ghost_lengths = sorted({len(s["ghost"]) for s in samples if s["ghost"]})
        grew = len(ghost_lengths) >= 2
        record(
            "S19 灰字随流式增长",
            grew,
            f"灰字长度集合={ghost_lengths[-6:]}",
        )

        # ---- S20 采纳反馈：学到的偏好会重排候选（但不会新增/丢弃）
        reset("")
        # The store must not answer this one: the point is to see the ranking run.
        h('clearSuggestions()')
        # 让「长建议」显得更受欢迎
        h("""setLearning({
            "kind:next": {"shown": 10, "accepted": 9},
            "len:l": {"shown": 10, "accepted": 9},
            "len:xs": {"shown": 10, "accepted": 1},
            "open:word": {"shown": 10, "accepted": 5},
            "greet:no": {"shown": 10, "accepted": 9},
            "end:period": {"shown": 10, "accepted": 5},
            "end:open": {"shown": 10, "accepted": 5},
            "script:zh": {"shown": 10, "accepted": 9}
        })""")
        page.wait_for_timeout(1200)
        snap = h("snapshot()")
        chip = proposal_of(snap)
        learned_first = chip.split("：", 1)[-1][:12]
        record(
            "S20 学到偏好后重排候选",
            "把刚才那段报错" in chip and "第 1/2 条" in chip,
            f"首条={learned_first!r}",
        )
        h("resetLearning()")

        # ---- S23 真实节奏：快速连打 + 模型慢，取消次数要有上限
        # A real model takes ~1.9s to its first delta. Typing faster than that used
        # to cancel every request that was about to paint the ghost.
        reset("")
        h("resetMetrics()")
        h("setComposeTiming({first: 1800, step: 260})")
        h("rec.start(50)")
        h("typeLive('帮我把这段构建日志从头到尾看一遍，找出最先失败的那一步', {delay: 45})")
        page.wait_for_timeout(600)
        typed_samples = h("rec.stop()")
        typing_s = max(0.1, (typed_samples[-1]["t"] - typed_samples[0]["t"]) / 1000)
        aborts_during_typing = h("aborts()")
        # One cancel per retrigger interval is the worst case the design allows.
        allowed = int(typing_s / 1.5) + 2
        record(
            "S23 快速连打期间取消失控",
            # Before the first delta a superseded request is allowed to finish and
            # be dropped, so zero is a legitimate reading. The bound is the guard.
            aborts_during_typing <= allowed,
            f"{aborts_during_typing} 次取消 / {typing_s:.1f}s（上限 {allowed}）",
        )

        # ---- S24 停手等灰字：停手后必须稳定出现，且不再反复重发
        page.wait_for_timeout(2600)
        settled = h("snapshot()")
        settled_chip = proposal_of(settled)
        settled_ghost = settled["text"]["text"] if settled["text"] else ""
        calls_after_settle = compose_calls()
        page.wait_for_timeout(2400)
        later = h("snapshot()")
        later_chip = proposal_of(later)
        calls_later = compose_calls()
        record(
            "S24 停手后给出灰字",
            bool(settled_chip or settled_ghost),
            f"chip={settled_chip[:24]!r} ghost={settled_ghost[:16]!r}",
        )
        record(
            "S24 灰字在 2.4s 内不消失也不重发",
            later_chip == settled_chip and calls_later - calls_after_settle <= 1,
            f"再次采样 chip={later_chip[:20]!r} 新增请求={calls_later - calls_after_settle}",
        )

        # ---- S25 频繁取消：模型比重触发更慢时，取消要有界，最后一次仍能出建议
        reset("")
        h("resetMetrics()")
        h("setComposeTiming({first: 3200, step: 300})")
        started = page.evaluate("() => performance.now()")
        for burst in ["第一段快速输入", "第二段继续补充", "第三段再加一句"]:
            h(f"typeLive({burst!r}, {{delay: 55}})")
            page.wait_for_timeout(700)
        elapsed_s = (page.evaluate("() => performance.now()") - started) / 1000
        aborts_slow = h("aborts()")
        allowed_slow = int(elapsed_s / 1.5) + 3
        record(
            "S25 模型比重触发慢时取消有界",
            aborts_slow <= allowed_slow,
            f"{aborts_slow} 次取消 / {elapsed_s:.1f}s（上限 {allowed_slow}）",
        )
        # A 3.2 s first delta plus three frames needs ~4.1 s; poll rather than guess.
        final_chip = ""
        final_ghost = ""
        phase = ""
        for _ in range(16):
            page.wait_for_timeout(500)
            final_snap = h("snapshot()")
            final_chip = proposal_of(final_snap)
            final_ghost = final_snap["text"]["text"] if final_snap["text"] else ""
            phase = (h("store()") or {}).get("phase", "")
            if final_chip or final_ghost:
                break
        record(
            "S25 最终仍能给出建议",
            bool(final_chip or final_ghost),
            f"chip={final_chip[:24]!r} ghost={final_ghost[:16]!r} phase={phase} compose={compose_calls()}",
        )
        h("setComposeTiming({first: 0, step: 220})")

        # ---- S26 长灰字必须留在可见的滚动框内
        # 官方结构是 card > scroll(overflow:auto, 固定视口) > grow > editor：编辑器会长高，
        # 真正裁切的是 scroll。这里按同样的结构量，断言灰字不越过 scroll 的底边。
        reset("")
        h("setComposeMode('long')")
        h("typeLive('帮我把这段构建日志从头到尾看一遍并逐行给出结论，标出最先失败的那一步以及重试次数', {delay: 35})")
        page.wait_for_timeout(2200)
        geometry = page.evaluate(
            """() => {
                const editor = document.querySelector('[data-composer-input]');
                const ghost = document.querySelector('[data-composer-quill="text"]');
                const scroll = editor ? editor.closest('.scroll') : null;
                if (!editor || !ghost || !scroll) return null;
                const e = editor.getBoundingClientRect();
                const g = ghost.getBoundingClientRect();
                const s = scroll.getBoundingClientRect();
                return {
                    scrollTop: Math.round(s.top), scrollBottom: Math.round(s.bottom),
                    editorBottom: Math.round(e.bottom),
                    ghostTop: Math.round(g.top), ghostBottom: Math.round(g.bottom),
                    ghostText: (ghost.textContent || '').length,
                    ghostTail: (ghost.textContent || '').slice(-1),
                    display: getComputedStyle(ghost).display,
                };
            }"""
        )
        record(
            "S26 长灰字不越过滚动框",
            bool(geometry)
            and geometry["ghostText"] >= 8
            and geometry["ghostBottom"] <= geometry["scrollBottom"] + 6,
            f"渲染 {geometry['ghostText']} 字，结尾 {geometry['ghostTail']!r}，几何 {geometry}",
        )
        h("setComposeMode('ok')")

        # ---- S27 打开对话框后灰字必须消失
        # 灰字层是 fixed + 极高 z-index：打开设置这类对话框时它会画在对话框上面。
        ghost_len = """() => {
            const node = document.querySelector('[data-composer-quill="text"]');
            return node ? (node.textContent || '').length : 0;
        }"""
        # 前面几条场景把假模型调慢过、也切换过模式；从干净页面开始，
        # 否则残留的提案会让这一条测的不是它想测的东西。
        page.reload()
        page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
        h("resetLearning()")
        h("type('')")
        h("typeLive('帮我把这段构建日志从头到尾看一遍', {delay: 40})")
        # 等灰字真的出现再开对话框：固定等待不够稳。
        before_ghost = 0
        for _ in range(12):
            page.wait_for_timeout(400)
            before_ghost = page.evaluate(ghost_len)
            if before_ghost > 0:
                break
        page.evaluate(
            """() => {
                const dialog = document.createElement('div');
                dialog.id = 'fake-dialog';
                dialog.setAttribute('role', 'dialog');
                dialog.setAttribute('aria-modal', 'true');
                dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:9999';
                document.body.appendChild(dialog);
            }"""
        )
        page.wait_for_timeout(600)
        during_ghost = page.evaluate(ghost_len)
        page.evaluate("() => document.getElementById('fake-dialog')?.remove()")
        page.wait_for_timeout(600)
        after_ghost = page.evaluate(ghost_len)
        record(
            "S27 对话框打开时灰字不穿透",
            before_ghost > 0 and during_ghost == 0 and after_ghost > 0,
            f"打开前 {before_ghost} → 打开时 {during_ghost} → 关闭后 {after_ghost}",
        )
        h("typeLive('', {delay: 0})")

        # ---- S28 换行后的灰字回到行首
        reset("")
        h("setComposeMode('long')")
        h("typeLive('试一下灰字显示得怎么样，多写点字', {delay: 35})")
        page.wait_for_timeout(2000)
        lines_info = page.evaluate(
            """() => {
                const ghost = document.querySelector('[data-composer-quill="text"]');
                const editor = document.querySelector('[data-composer-input]');
                if (!ghost || !editor) return null;
                const node = ghost.lastChild;
                const text = node ? node.nodeValue || '' : '';
                if (text === '') return null;
                const range = document.createRange();
                const starts = [];
                let previousTop = null;
                for (let i = 0; i < text.length; i += 1) {
                    range.setStart(node, i);
                    range.setEnd(node, i + 1);
                    const rect = range.getBoundingClientRect();
                    if (previousTop === null || Math.abs(rect.top - previousTop) > 2) {
                        starts.push(Math.round(rect.left));
                        previousTop = rect.top;
                    }
                }
                return {
                    starts,
                    editorLeft: Math.round(editor.getBoundingClientRect().left),
                    ghostLeft: Math.round(ghost.getBoundingClientRect().left),
                };
            }"""
        )
        record(
            "S28 换行后回到行首",
            bool(lines_info)
            and len(lines_info["starts"]) >= 2
            and lines_info["starts"][0] > lines_info["editorLeft"] + 20
            and all(abs(start - lines_info["editorLeft"]) <= 2 for start in lines_info["starts"][1:]),
            f"{lines_info}",
        )
        h("setComposeMode('ok')")

        # ---- S29 Shift+Tab 不是采纳
        reset("")
        h("typeLive('帮我把这段构建日志从头到尾看一遍', {delay: 30})")
        page.wait_for_timeout(1800)
        before_shift_tab = h("draft()")
        h("press({key: 'Tab', shiftKey: true})")
        page.wait_for_timeout(300)
        after_shift_tab = h("draft()")
        record(
            "S29 Shift+Tab 不插入建议",
            before_shift_tab != "" and after_shift_tab == before_shift_tab,
            f"前 {len(before_shift_tab)} 字 → 后 {len(after_shift_tab)} 字",
        )
        h("type('')")

        # ---- S30 光标在句中时采纳：整段替换，不切断原句
        reset("")
        h("typeLive('帮我把这段构建日志从头到尾看一遍', {delay: 30})")
        page.wait_for_timeout(1800)
        before_s30 = h("draft()")
        # 把光标停在句中的第 5 个字之后
        page.evaluate(
            """() => {
                const editor = document.querySelector('[data-composer-input]');
                const node = editor.firstChild;
                const range = document.createRange();
                range.setStart(node, Math.min(5, (node.textContent || '').length));
                range.collapse(true);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }"""
        )
        page.evaluate("() => { window.__harnessInserted = null; window.__harnessSetDraft = null }")
        page.wait_for_timeout(200)
        h("press({key: 'Tab'})")
        page.wait_for_timeout(400)
        applied_s30 = page.evaluate("() => ({ inserted: window.__harnessInserted, setDraft: window.__harnessSetDraft })")
        after_s30 = h("draft()")
        record(
            "S30 句中采纳不切断原句",
            # 要么整段替换成「原草稿 + 尾巴」，要么什么都不做；不允许把尾巴插进句子中间。
            (applied_s30["setDraft"] or "").startswith(before_s30)
            and len(applied_s30["setDraft"] or "") > len(before_s30)
            and applied_s30["inserted"] is None,
            f"setDraft={(applied_s30['setDraft'] or '')[:26]!r}… inserted={applied_s30['inserted']} draft={after_s30[:18]!r}…",
        )
        h("type('')")

        # ---- S31 失败要说出来
        # 前面几条场景换过模式、调过假模型的时序；从干净页面开始，这条测的才是失败本身。
        page.reload()
        page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
        reset("")
        h("setComposeMode('fail-always')")
        h("typeLive('帮我把这段构建日志从头到尾看一遍', {delay: 30})")
        # 失败 → 重试一次 → 再失败才落到 error 状态，固定等待不够稳。
        error_shown = None
        for _ in range(16):
            page.wait_for_timeout(400)
            error_shown = page.evaluate(
                """() => {
                    const node = document.querySelector('[data-composer-quill="dock-error"]');
                    return node ? (node.textContent || '') : null;
                }"""
            )
            if error_shown:
                break
        dock_names = page.evaluate(
            """() => Array.from(document.querySelectorAll('[data-composer-quill]'))
                .map((n) => n.getAttribute('data-composer-quill'))
                .filter((name) => name && name.startsWith('dock-'))"""
        )
        state_now = h("store()") or {}
        calls_now = [call for call in (h("calls") or []) if call.get("mode") == "compose"]
        record(
            "S31 失败时显示原因",
            isinstance(error_shown, str) and "建议失败" in error_shown,
            f"dock-error={error_shown!r} phase={state_now.get('phase')} error={state_now.get('error')!r} "
            f"forDraft={state_now.get('forDraft')!r} compose_calls={len(calls_now)} dock={dock_names}",
        )
        h("setComposeMode('ok')")
        h("type('')")

        # ---- S32 灰字上报不再逐帧，也不再带草案原文
        reset("")
        h("setComposeMode('long')")
        h("typeLive('帮我把这段构建日志从头到尾看一遍，并按时间顺序列出每一步', {delay: 25})")
        page.wait_for_timeout(2600)
        beacons = page.evaluate(
            """() => (window.__harness.calls || [])
                .filter((call) => call.mode === 'beacon' && call.event === 'paint')
                .map((call) => call.detail || '')"""
        )
        with_text = [detail for detail in beacons if '"text"' in detail]
        with_length = [detail for detail in beacons if 'proposalChars' in detail]
        record(
            "S32 灰字上报不再逐帧",
            # 一次流式补写有 40+ 个增量；4 次、5 次、6 次都说明「不是逐帧」。
            # 上限放到 8，逐帧回归（会到几十次）仍然会被抓住。
            1 <= len(beacons) <= 8 and not with_text and len(with_length) == len(beacons),
            f"paint 上报 {len(beacons)} 次，带原文 {len(with_text)} 次，带长度 {len(with_length)} 次",
        )
        h("setComposeMode('ok')")
        h("type('')")

        # ---- S33 设置控件都有可访问名
        page.reload()
        page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
        page.evaluate("() => window.__harness.showSettings()")
        page.wait_for_timeout(500)
        names = page.evaluate(
            """() => ['settings-mode', 'settings-language', 'settings-debounce', 'settings-timeout']
                .map((key) => {
                    const node = document.querySelector('[data-composer-quill="' + key + '"]');
                    if (!node) return [key, null];
                    const label = node.getAttribute('aria-label') || '';
                    const labelled = node.id ? document.querySelector('label[for="' + node.id + '"]') : null;
                    return [key, label || (labelled ? (labelled.textContent || '') : '')];
                })"""
        )
        unnamed = [key for key, name in names if not name]
        record("S33 设置控件都有可访问名", not unnamed, f"缺名: {unnamed} 全部={names}")
        page.reload()
        page.wait_for_function("() => window.__harnessReady === true", timeout=30000)

        # ---- S34 播报不逐帧，且最终只说一次结果
        reset("")
        h("setComposeMode('long')")
        page.evaluate(
            """() => {
                window.__liveChanges = [];
                const node = document.querySelector('[role="status"]');
                if (!node) { window.__liveChanges.push('<no live region>'); return }
                window.__liveText = () => node.textContent || '';
                const observer = new MutationObserver(() => {
                    window.__liveChanges.push(node.textContent || '');
                });
                observer.observe(node, { childList: true, characterData: true, subtree: true });
                window.__liveObserver = observer;
            }"""
        )
        h("typeLive('帮我把这段构建日志从头到尾看一遍，并按时间顺序列出每一步', {delay: 25})")
        page.wait_for_timeout(3200)
        changes = page.evaluate(
            """() => {
                if (window.__liveObserver) window.__liveObserver.disconnect();
                const seen = [];
                for (const text of (window.__liveChanges || [])) {
                    if (text !== '' && seen[seen.length - 1] !== text) seen.push(text);
                }
                return { distinct: seen, final: window.__liveText ? window.__liveText() : '' };
            }"""
        )
        record(
            "S34 播报不逐帧",
            1 <= len(changes["distinct"]) <= 3
            and changes["final"].startswith("建议：")
            and len(changes["final"]) > len("建议："),
            f"播报变化 {len(changes['distinct'])} 次，最终={changes['final'][:40]!r}",
        )
        h("setComposeMode('ok')")
        h("type('')")

        # ---- S35 Esc 之后 Tab 交还给宿主
        reset("")
        h("typeLive('这段日志重新整理一下', {delay: 40})")
        page.wait_for_timeout(1800)
        before_focus = page.evaluate("() => document.activeElement ? document.activeElement.tagName : null")
        h("press({key: 'Escape'})")
        page.wait_for_timeout(300)
        after_escape = page.evaluate(
            """() => {
                const chip = document.querySelector('[data-composer-quill="dock-suggestion"]');
                return chip ? 'chip 仍在' : 'chip 已消失';
            }"""
        )
        # A synthetic KeyboardEvent never moves focus: Tab traversal needs a trusted key.
        page.focus('[data-composer-input]')
        page.wait_for_timeout(100)
        page.keyboard.press("Tab")
        page.wait_for_timeout(300)
        after_tab = page.evaluate(
            """() => {
                const editor = document.querySelector('[data-composer-input]');
                return { stillInEditor: document.activeElement === editor, draft: window.__harness.draft() };
            }"""
        )
        record(
            "S35 Esc 之后 Tab 交还宿主",
            after_escape == "chip 已消失" and not after_tab["stillInEditor"],
            f"Esc 后 {after_escape}；Tab 后仍在输入框={after_tab['stillInEditor']} 焦点原在 {before_focus}",
        )

        # ---- S36 切到新会话只问一次（#3 的真相：多出来的那次是 /history 读取）
        reset("")
        h("typeLive('先说一句占位的话', {delay: 20})")
        page.wait_for_timeout(1600)
        h("type('')")
        page.wait_for_timeout(500)
        h("setSession('s-second')")
        page.wait_for_timeout(900)
        h("setSession('s-third')")
        page.wait_for_timeout(900)
        per_session = {}
        history_reads = {}
        for call in h("calls"):
            session = call.get("sessionId")
            if session not in ("s-second", "s-third"):
                continue
            if call.get("mode") == "next":
                per_session[session] = per_session.get(session, 0) + 1
            elif call.get("mode") == "history":
                history_reads[session] = history_reads.get(session, 0) + 1
        record(
            "S36 切会话只问一次",
            per_session.get("s-second") == 1 and per_session.get("s-third") == 1,
            f"每个新会话的 next 次数={per_session}（期望各 1），history 读取={history_reads}",
        )

        # ---- S37 失败重试不能活过会话切换
        reset("")
        h("setComposeMode('fail-always')")
        h("typeLive('这段日志重新整理一下再发我', {delay: 25})")
        page.wait_for_timeout(1500)   # 失败 → 重试定时器已挂上（1200ms）
        armed = h("store()") or {}
        before_switch = len([c for c in h("calls") if c.get("mode") == "compose"])
        # 切会话后立刻清空输入框：之后再出现同草稿的 compose 调用，就只能是那次重试
        h("setSession('s-other')")
        h("type('')")
        # The next retry is ~4 s out: wait past it, or the check can only pass.
        page.wait_for_timeout(4500)
        after = [c for c in h("calls") if c.get("mode") == "compose"][before_switch:]
        stale = [c for c in after if c.get("draft") == "这段日志重新整理一下再发我"]
        record(
            "S37 失败重试不能活过会话切换",
            armed.get("phase") == "error" and before_switch >= 1 and len(stale) == 0,
            f"切换前 phase={armed.get('phase')}；切换后同草稿的 compose 调用={len(stale)}（期望 0）",
        )
        h("setComposeMode('ok')")
        h("type('')")

        # ---- S38 采纳后可撤销，撤销回到采纳前
        reset("")
        h("typeLive('这段日志', {delay: 30})")
        page.wait_for_timeout(1400)
        before_accept = h("draft()")
        h("press({key: 'Tab'})")
        page.wait_for_timeout(300)
        after_accept = h("draft()")
        undo_chip = page.evaluate(
            """() => { const n = document.querySelector('[data-composer-quill="dock-undo"]'); return n ? n.textContent : null }"""
        )
        page.evaluate("""() => { const n = document.querySelector('[data-composer-quill="dock-undo"]'); if (n) n.click() }""")
        page.wait_for_timeout(400)
        record(
            "S38 采纳后可撤销",
            after_accept != before_accept and bool(undo_chip) and h("draft()") == before_accept,
            f"采纳前={before_accept!r} 采纳后={after_accept[:16]!r} 按钮={undo_chip!r} 撤销后={h('draft()')!r}",
        )

        # ---- S39 采纳后再打字，撤销入口消失
        page.wait_for_timeout(300)
        page.evaluate("""() => { const n = document.querySelector('[data-composer-quill="dock-undo"]'); return Boolean(n) }""")
        h("type('这')")
        page.wait_for_timeout(300)
        undo_after_typing = page.evaluate(
            """() => { const n = document.querySelector('[data-composer-quill="dock-undo"]'); return n ? n.textContent : null }"""
        )
        record(
            "S39 再打字后撤销入口消失",
            undo_after_typing is None,
            f"打字后按钮={undo_after_typing!r} draft={h('draft()')!r}",
        )
        h("type('')")

        # ---- S40 失败行可点击重试
        # 前面几条留下的 claim 与焦点状态会拦掉请求；从干净页面开始，这条测的才是重试本身
        page.reload()
        page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
        page.wait_for_timeout(300)
        reset("")
        page.focus('[data-composer-input]')
        h("setComposeMode('fail-always')")
        # 用一个没被前面场景用过的草稿：same-draft 的「刚采纳过」保护会拦掉重复请求
        h("typeLive('帮我把这次的失败重试路径验证一下', {delay: 25})")
        # 失败 → 自动重试也在飞 → 再失败才落到 error，所以轮询而不是死等
        error_chip = None
        for _ in range(16):
            page.wait_for_timeout(400)
            error_chip = page.evaluate(
                """() => { const n = document.querySelector('[data-composer-quill="dock-error"]'); return n ? { text: n.textContent, tag: n.tagName } : null }"""
            )
            if error_chip:
                break
        before_retry = len([c for c in h("calls") if c.get("mode") == "compose"])
        page.evaluate("""() => { const n = document.querySelector('[data-composer-quill="dock-error"]'); if (n) n.click() }""")
        page.wait_for_timeout(700)
        after_retry = len([c for c in h("calls") if c.get("mode") == "compose"])
        record(
            "S40 失败行可点击重试",
            bool(error_chip) and error_chip["tag"] == "BUTTON" and after_retry > before_retry,
            f"按钮={error_chip} compose {before_retry}->{after_retry}",
        )

        # ---- S41 连点重试只多发一次
        clicked = page.evaluate(
            """() => {
                const n = document.querySelector('[data-composer-quill="dock-error"]');
                if (!n) return false;
                n.click();
                n.click();
                return true;
            }"""
        )
        page.wait_for_timeout(900)
        after_double = len([c for c in h("calls") if c.get("mode") == "compose"])
        record(
            "S41 连点重试只多发一次",
            clicked and after_double - after_retry <= 2,
            f"连点后 compose {after_retry}->{after_double}（上限 +2，含失败瞬间的自动重试）",
        )
        h("setComposeMode('ok')")
        h("type('')")

        # ---- S42 「没有需要改的地方」要说出来，2.5 秒后回到按键提示
        page.reload()
        page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
        page.wait_for_timeout(300)
        h("setComposeMode('unchanged')")
        page.evaluate("() => window.__harness.setSession('s-empty')")
        page.wait_for_timeout(200)
        page.focus('[data-composer-input]')
        h("typeLive('帮我把这段日志整理一下再发我', {delay: 25})")
        empty_chip = None
        for _ in range(16):
            page.wait_for_timeout(300)
            empty_chip = page.evaluate(
                """() => { const n = document.querySelector('[data-composer-quill="dock-empty"]'); return n ? n.textContent : null }"""
            )
            if empty_chip:
                break
        page.wait_for_timeout(2700)
        after_ttl = page.evaluate(
            """() => {
                const empty = document.querySelector('[data-composer-quill="dock-empty"]');
                const hint = document.querySelector('[data-composer-quill="dock-hint"]');
                return { empty: empty ? empty.textContent : null, hint: Boolean(hint) };
            }"""
        )
        record(
            "S42 没有需要改的地方要说出来",
            bool(empty_chip) and after_ttl["empty"] is None and after_ttl["hint"],
            f"先显示 {empty_chip!r}，2.7s 后 empty={after_ttl['empty']!r} hint={after_ttl['hint']}",
        )
        h("setComposeMode('ok')")
        h("type('')")

        # ---- S43 两个开关各管一件事：关掉「补写」后打字不再请求
        # 直接改配置（设置卡片由夹具临时挂载，重复挂载会留下旧的 React 树，点击不可靠）
        def set_flag(name, value):
            page.evaluate(
                """(payload) => {
                    const key = 'dsh.composer-quill.config';
                    let raw = {};
                    try { raw = JSON.parse(window.localStorage.getItem(key) || '{}') } catch {}
                    raw[payload.name] = payload.value;
                    window.localStorage.setItem(key, JSON.stringify(raw));
                }""",
                {'name': name, 'value': value},
            )
            page.reload()
            page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
            page.wait_for_timeout(300)
        
        set_flag('composeEnabled', False)
        page.focus('[data-composer-input]')
        before_calls = len([c for c in h('calls') if c.get('mode') == 'compose'])
        h("typeLive('关掉补写之后不该再有请求', {delay: 25})")
        page.wait_for_timeout(1600)
        after_calls = len([c for c in h('calls') if c.get('mode') == 'compose'])
        set_flag('composeEnabled', True)
        page.focus('[data-composer-input]')
        h("typeLive('打开之后应该又能补写了', {delay: 25})")
        page.wait_for_timeout(1600)
        resumed = len([c for c in h('calls') if c.get('mode') == 'compose'])
        record(
            "S43 关掉补写后不再请求",
            after_calls == before_calls and resumed > after_calls,
            f"compose {before_calls}->{after_calls}->{resumed}（关掉时 0 增长，打开后恢复）",
        )

        h("type('')")


        # ---- S45 消耗面板：有数字，点重置后归零
        page.reload()
        page.wait_for_function("() => window.__harnessReady === true", timeout=30000)
        page.wait_for_timeout(300)
        h("showSettings()")
        page.wait_for_timeout(600)
        panel = page.evaluate(
            """() => {
                const node = document.querySelector('[data-composer-quill="usage-panel"]');
                return node ? node.textContent : null;
            }"""
        )
        record(
            "S45 消耗面板显示用量",
            panel is not None
            and "147" in panel
            and "12 次" in panel
            and ("累计" in panel or "usage.lifetime" in panel),
            f"面板={ (panel or '')[:80]!r }",
        )

        page.evaluate(
            """() => { const b = document.querySelector('[data-composer-quill="usage-reset"]'); if (b) b.click() }"""
        )
        page.wait_for_timeout(600)
        after = page.evaluate(
            """() => { const node = document.querySelector('[data-composer-quill="usage-panel"]'); return node ? node.textContent : null }"""
        )
        record(
            "S45 重置后归零",
            after is not None and "147" not in after and "0 次" in after,
            f"重置后={(after or '')[:80]!r}",
        )

        # ---- S46 设置里选的模型会随请求发给宿主（issue #4）
        page.evaluate("() => window.__harness.setSession('s46')")
        page.wait_for_timeout(200)
        h("showSettings()")
        page.wait_for_timeout(600)
        model_select = page.locator('[data-composer-quill="settings-model"]')
        selects = model_select.count()
        options = model_select.locator("option").all_inner_texts() if selects == 1 else []
        record(
            "S46 设置里有模型选择器",
            selects == 1 and len(options) >= 2,
            f"选择器={selects} 选项={options}",
        )
        if selects == 1 and len(options) >= 2:
            model_select.select_option("deepseek::v4-flash")
            page.wait_for_timeout(300)
            stored = page.evaluate(
                "() => JSON.parse(localStorage.getItem('dsh.composer-quill.config') || '{}').modelRoute"
            )
            record(
                "S46 选择后写入配置",
                stored == {"provider": "deepseek", "model": "v4-flash"},
                f"选项={options} 存下={stored}",
            )
            h("type('')")
            page.evaluate("() => window.__harness.setSession('s46-b')")
            page.wait_for_timeout(200)
            page.focus("[data-composer-input]")
            h("typeLive('帮我看下这个报错', {delay: 20})")
            page.wait_for_timeout(2500)
            sent = [c for c in h("calls") if c.get("mode") == "compose"]
            record(
                "S46 请求带上所选模型",
                bool(sent) and sent[0].get("model") == {"provider": "deepseek", "model": "v4-flash"},
                f"请求={sent[0].get('model') if sent else None}",
            )
        h("type('')")

        # ---- S47 思考强度：选项可读，选完后请求带上档位
        thinking = page.locator('[data-composer-quill="settings-reasoning"]')
        thinking_selects = thinking.count()
        labels = thinking.locator("option").all_inner_texts() if thinking_selects == 1 else []
        record("S47 设置里有思考强度", thinking_selects == 1 and len(labels) >= 2, f"选择器={thinking_selects} 选项={labels}")
        if thinking_selects == 1 and len(labels) >= 2:
            thinking.select_option("high")
            page.wait_for_timeout(300)
            stored_reasoning = page.evaluate(
                "() => JSON.parse(localStorage.getItem('dsh.composer-quill.config') || '{}').reasoning"
            )
            record("S47 选择后写入配置", stored_reasoning == "high", f"选项={labels} 存下={stored_reasoning}")
            h("type('')")
            page.evaluate("() => window.__harness.setSession('s47')")
            page.wait_for_timeout(200)
            before_asked = len([c for c in h("calls") if c.get("mode") == "compose"])
            page.focus("[data-composer-input]")
            h("typeLive('帮我看看这个报错', {delay: 20})")
            page.wait_for_timeout(2500)
            # calls 是整场累积的：只看这次设置之后发出的请求
            asked = [c for c in h("calls") if c.get("mode") == "compose"][before_asked:]
            record(
                "S47 请求带上思考档位",
                bool(asked) and asked[-1].get("reasoning") == "high",
                f"新增 {len(asked)} 条，档位={asked[-1].get('reasoning') if asked else None}",
            )
            # 回到默认，免得影响后面的用例
            thinking.select_option("off")
            page.wait_for_timeout(200)
        h("type('')")

        record("S9 无页面异常", not errors, f"errors={errors[:2]}")
        page.screenshot(path="daily-final.png")

        browser.close()

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} scenarios passed")
    if failed:
        print("failed:", ", ".join(failed))
    return 0 if not failed else 1


# The number the READMEs and the CHANGELOG claim. A drift here means a scenario was
# added or deleted without updating the docs — say so instead of quietly reporting N/N.
EXPECTED_SCENARIOS = 66


if __name__ == "__main__":
    try:
        code = main()
        if EXPECTED_SCENARIOS is not None and len(results) != EXPECTED_SCENARIOS:
            print(
                f"\n@@ 场景数量对不上：实际跑了 {len(results)} 条，预期 {EXPECTED_SCENARIOS} 条。"
                " 加/删场景时请同步 EXPECTED_SCENARIOS 与文档里的数字。"
            )
            code = 1
        sys.exit(code)
    except _ScenarioLimit:
        passed = sum(1 for _, ok, _ in results if ok)
        failed = len(results) - passed
        print(f"\n已跑 {len(results)} 条（DSH_SCENARIO_LIMIT），{passed} 通过，{failed} 失败")
        # A partial run that already saw a failure is a failure, not a pass.
        sys.exit(0 if failed == 0 else 1)




