#!/usr/bin/env python3
"""在 verify_daily.py 外面套一层重试，并把抖动记账。

用法：
    python verify_with_retry.py                    # 最多 2 次
    python verify_with_retry.py --attempts 3
    python verify_with_retry.py --script _stub.py   # 自测用

判定：
- 任何一次全绿 → 退出码 0（途中的红灯记为「抖动」）
- 每次都红   → 退出码 1（真失败）
- 某场景累计抖动 ≥ 阈值（默认 3）→ 单独列出，让「抖到一定次数」不再被忽略
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SCENARIOS = HERE / "verify_daily.py"
# The ledger stays at dev/ (one level up), next to the other local state files.
DEFAULT_LEDGER = HERE.parent / "flake-ledger.json"
RESULT = re.compile(r"^\s*(PASS|FAIL)\s+(.+?)\s{2,}(.*)$")


def run_once(script: Path) -> tuple[int, dict[str, bool], str]:
    proc = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(script.parent),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    outcomes: dict[str, bool] = {}
    for line in output.splitlines():
        match = RESULT.match(line)
        if match:
            outcomes[match.group(2).strip()] = match.group(1) == "PASS"
    return proc.returncode, outcomes, output


def load_ledger(path: Path) -> dict:
    if not path.exists():
        return {"runs": 0, "flakes": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"runs": 0, "flakes": {}}
    data.setdefault("runs", 0)
    data.setdefault("flakes", {})
    return data


def save_ledger(path: Path, ledger: dict) -> None:
    path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--attempts", type=int, default=2, help="最多跑几次（默认 2）")
    parser.add_argument("--threshold", type=int, default=3, help="累计抖动几次就报出来（默认 3）")
    parser.add_argument("--script", default=str(DEFAULT_SCENARIOS), help="被测脚本")
    parser.add_argument("--ledger", default=str(DEFAULT_LEDGER), help="记账文件")
    args = parser.parse_args()

    script = Path(args.script)
    ledger_path = Path(args.ledger)
    ledger = load_ledger(ledger_path)
    ledger["runs"] += 1

    attempts: list[dict[str, bool]] = []
    last_output = ""
    for index in range(max(1, args.attempts)):
        code, outcomes, output = run_once(script)
        attempts.append(outcomes)
        last_output = output
        passed = sum(1 for value in outcomes.values() if value)
        print(f"[attempt {index + 1}/{args.attempts}] {passed}/{len(outcomes)} passed (exit {code})")
        if code == 0 and outcomes and all(outcomes.values()):
            break

    final_green = any(outcomes and all(outcomes.values()) for outcomes in attempts)
    names = sorted({name for outcomes in attempts for name in outcomes})
    flaked: list[str] = []
    for name in names:
        seen = [outcomes.get(name) for outcomes in attempts if name in outcomes]
        if final_green and any(value is False for value in seen) and any(value is True for value in seen):
            flaked.append(name)
            ledger["flakes"][name] = ledger["flakes"].get(name, 0) + 1

    save_ledger(ledger_path, ledger)

    if flaked:
        print("\n抖动（重试后通过）：")
        for name in flaked:
            count = ledger["flakes"].get(name, 0)
            mark = "  ⚠ 累计已达阈值" if count >= args.threshold else ""
            print(f"  · {name}  第 {count} 次{mark}")

    loud = [name for name in flaked if ledger["flakes"].get(name, 0) >= args.threshold]
    if loud:
        print("\n⚠ 以下场景反复抖动，已经不是偶发：")
        for name in loud:
            print(f"  · {name}  累计 {ledger['flakes'][name]} 次")
        print("  记账文件：" + str(ledger_path))

    if not final_green:
        print("\n始终未通过，输出尾部：")
        print("\n".join(last_output.splitlines()[-12:]))
        return 1

    if not flaked:
        print("\n全绿，无抖动。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
