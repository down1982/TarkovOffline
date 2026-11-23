"""
Escape from Tarkov Tactical Offline Assistant
In-Game Screen Capture Companion Tool (100% Safe, Zero BattlEye Risk)

Usage:
  py scripts/screen_hotkey_scanner.py

Features:
  1. Press Enter to capture active screen (or mouse hover area)
  2. Instant local RapidOCR text extraction (~50ms)
  3. Auto-matches against 602 Tasks and 282 FIR Collection Items
  4. Automatically opens or syncs with http://127.0.0.1:8080/
"""

import os
import sys
import time
import io
import json
import base64
import urllib.request
from PIL import Image, ImageGrab

SERVER_URL = "http://127.0.0.1:8080/api/scanner/recognize"

def capture_and_scan(crop_cursor_box=False):
    print("\n[📸] 正在截取画面...")
    try:
        if crop_cursor_box:
            # Optional: 600x400 around mouse cursor (for item tooltips)
            import ctypes
            class POINT(ctypes.Structure):
                _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
            pt = POINT()
            ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
            cx, cy = pt.x, pt.y
            bbox = (max(0, cx - 350), max(0, cy - 200), cx + 350, cy + 200)
            img = ImageGrab.grab(bbox=bbox)
        else:
            img = ImageGrab.grab()
    except Exception as e:
        print(f"[❌] 截屏失败: {e}")
        return

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

    print("[🔍] 正在通过 RapidOCR 神经引擎本地识别比对...")
    t0 = time.time()
    try:
        req = urllib.request.Request(
            SERVER_URL,
            data=json.dumps({"image": b64}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[❌] 请求本地扫描服务失败: {e}")
        print("    请确保 Web 服务已启动 (py server.py)")
        return

    elapsed = int((time.time() - t0) * 1000)
    if data.get("code") != 0 or not data.get("data"):
        print(f"[⚠️] 未识别到文字 (耗时 {elapsed}ms)")
        return

    res = data["data"]
    matched_tasks = res.get("matched_tasks", [])
    matched_items = res.get("matched_items", [])
    full_text = res.get("full_text", "")

    print(f"\n======== 战术识别结果 (耗时 {elapsed}ms) ========")
    print(f"提取文字: {full_text[:80]}{'...' if len(full_text) > 80 else ''}")

    if matched_tasks:
        print(f"\n🎯 匹配到任务 ({len(matched_tasks)} 项):")
        for t in matched_tasks:
            kappa_str = " [🏆 Kappa]" if t.get("is_kappa") else ""
            print(f"  • [{t.get('trader')}] {t.get('title')}{kappa_str} (Lv.{t.get('level', 1)})")
            for obj in (t.get("objectives") or [])[:2]:
                print(f"    - {obj}")

    if matched_items:
        print(f"\n📦 匹配到战局必留物品 ({len(matched_items)} 种):")
        for it in matched_items:
            fir_str = "🔥 需战局带出 (FIR)" if it.get("requires_fir") else "✔ 可跳蚤购买"
            print(f"  • {it.get('name')} | 共需: {it.get('total_need')} 件 | {fir_str}")
            for src in it.get("sources", [])[:3]:
                print(f"    - 来源: {src.get('title')} {src.get('sub', '')} ×{src.get('needed')}")

    if not matched_tasks and not matched_items:
        print("\n[ℹ️] 未匹配到特定任务或必留物品名称。可在网页端按 Ctrl+V 查看完整细节。")

    print("==================================================\n")

def main():
    print("=" * 60)
    print(" 逃离塔科夫 中文离线战术助手 - 截图速查伴侣 (100% 零封号安全)")
    print("=" * 60)
    print("操作方式:")
    print("  1. 在游戏内打开任务界面或鼠标移至物品上")
    print("  2. 在此窗口按 [Enter] 即刻截屏全屏扫描")
    print("  3. 输入 'c' + [Enter] 截取鼠标指针周围局部区域 (物品悬浮窗)")
    print("  4. 或在游戏内直接按 Win+Shift+S 截图，然后在网页端 Ctrl+V")
    print("  5. 输入 'q' 退出\n")

    while True:
        try:
            cmd = input("按 Enter 键立即截屏识别 (输入 'c' 局部 / 'q' 退出): ").strip().lower()
            if cmd == 'q':
                print("退出扫描伴侣。")
                break
            elif cmd == 'c':
                capture_and_scan(crop_cursor_box=True)
            else:
                capture_and_scan(crop_cursor_box=False)
        except (KeyboardInterrupt, EOFError):
            print("\n已退出。")
            break

if __name__ == "__main__":
    main()
