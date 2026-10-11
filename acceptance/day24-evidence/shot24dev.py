# -*- coding: utf-8 -*-
"""
Day 10：抓「某个交互动作执行之后」的、带地址栏的真实 Edge 窗口截图。

为什么要这么拆（三段各干最擅长的事）：
  1) Python 用**干净参数**启动 Edge（不带任何自动化开关）→ 窗口跟手动打开的一模一样；
  2) Node + playwright-core 经 CDP 连上去做点击 → 不用手算坐标，也不怕高 DPI 缩放；
  3) Python 用 PrintWindow 抓窗口 → 连标签页 + 地址栏一起抓下来。

用法:
  python shot_cdp.py <输出png> <动作: none|seed|toggle-water> [宽=1280] [高=1084] [截图高度上限=1700] [尝试次数=6]

  # 需要「前后对照」时用配对模式：一个进程里连拍两张，工具条统计必然一致
  python shot_cdp.py after.png toggle-water --pair before.png

流程（Day 11 调整过，顺序很关键）:
  启动干净 Edge → 找窗口并「预热激活」到工具条反差稳定 → [配对时先拍动作前那张]
  → Node 经 CDP 做动作 → **立刻**抓图。
  激活放在动作之前，是为了能拍到只活两三秒的短暂反馈（提示条、动画）。

要点（Day 9 踩过的坑，别改）：
  * --window-size 是逻辑像素；1.5 倍屏 → 抓到的是物理像素的 1.5 倍。
  * 前后两张必须用完全相同的参数（含 profile 之外的每一项）。
  * PrintWindow 偶尔抓到「失活灰化」的窗口：连抓几张，用顶部工具条反差挑最好的一张。
  * 必须优雅关闭（WM_CLOSE 等它自己退出），否则下次启动会恢复出多余标签页。
"""
import ctypes
import os
import struct
import subprocess
import sys
import time
import zlib

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
NODE = r"C:\Users\LM\.workbuddy\binaries\node\versions\22.22.2\node.exe"
NODE_MODULES = r"C:\Users\LM\WorkBuddy\2026-09-24-18-32-42\pw\node_modules"
HERE = os.path.dirname(os.path.abspath(__file__))
CDP_JS = os.path.join(HERE, "cdp_click.js")
PORT = "9333"

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
try:
    user32.SetProcessDPIAware()
except Exception:
    pass

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
DIB_RGB_COLORS = 0
WM_CLOSE = 0x0010
ASFW_ANY = -1


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", ctypes.c_uint32), ("biWidth", ctypes.c_int32),
                ("biHeight", ctypes.c_int32), ("biPlanes", ctypes.c_uint16),
                ("biBitCount", ctypes.c_uint16), ("biCompression", ctypes.c_uint32),
                ("biSizeImage", ctypes.c_uint32),
                ("biXPelsPerMeter", ctypes.c_int32), ("biYPelsPerMeter", ctypes.c_int32),
                ("biClrUsed", ctypes.c_uint32), ("biClrImportant", ctypes.c_uint32)]


def find_windows(keyword):
    found = []

    def cb(hwnd, lparam):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                b = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, b, n + 1)
                if keyword in b.value:
                    found.append(hwnd)
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def windows_of_pid(pid):
    """只认「这个进程自己的」可见顶层窗口 —— 比按标题关键字找稳得多。

    Day 15 为什么非加不可：目标站点（CloudBase 默认域名）会先给一张「页面访问提示」中间页，
    要点掉它才露出真实页面。而脚本是**在动作之前**按标题找窗口的 ——
    那一刻标题还是「页面访问提示」，等动作点完标题才变成真实页面标题。
    按标题找必然失配，表现是 `RESULT=FAIL 没找到浏览器窗口`
    （看着像启动太慢，其实是关键字从一开始就注定匹配不上）。
    """
    found = []

    def cb(hwnd, lparam):
        if user32.IsWindowVisible(hwnd):
            p = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
            if p.value == pid:
                found.append(hwnd)
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def close_stale(keyword):
    for hwnd in find_windows(keyword):
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)


def activate(hwnd):
    for _ in range(4):
        user32.ShowWindow(hwnd, 9)          # SW_RESTORE
        user32.BringWindowToTop(hwnd)
        try:
            user32.AllowSetForegroundWindow(ASFW_ANY)
        except Exception:
            pass
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.8)
        if not user32.IsIconic(hwnd):
            return True
    return False


def click_to_focus(hwnd):
    """用真鼠标点一下窗口的标题栏，把窗口真正带到前台。

    为什么非这样不可（Day 10 实测）：SetForegroundWindow 在**没有前台权限**的进程里
    会静默失败 —— 窗口一直保持灰色失活态，抓出来的图整张被压暗
    （工具条均值 91 vs 正常 228）。而模拟一次真实鼠标点击属于「用户输入」，
    Windows 会正常把窗口激活。点标题栏正中间，避开了右上角的窗口按钮。
    """
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    x = r.left + (r.right - r.left) // 2
    y = r.top + 10
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.3)
    user32.mouse_event(0x0002, 0, 0, 0, 0)   # LEFTDOWN
    time.sleep(0.08)
    user32.mouse_event(0x0004, 0, 0, 0, 0)   # LEFTUP
    time.sleep(1.2)


def _to_rgb(buf, w, h):
    raw = buf.raw
    out = bytearray()
    for row in range(h):
        line = raw[row * w * 4:(row + 1) * w * 4]
        rowb = bytearray(w * 3)
        rowb[0::3] = line[2::4]
        rowb[1::3] = line[1::4]
        rowb[2::3] = line[0::4]
        out += rowb
    return bytes(out)


def capture_window(hwnd, w, h):
    hdc_win = user32.GetWindowDC(hwnd)
    memdc = gdi32.CreateCompatibleDC(hdc_win)
    bmp = gdi32.CreateCompatibleBitmap(hdc_win, w, h)
    gdi32.SelectObject(memdc, bmp)
    ok = user32.PrintWindow(hwnd, memdc, 2)   # PW_RENDERFULLCONTENT

    bi = BITMAPINFOHEADER()
    bi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bi.biWidth = w
    bi.biHeight = -h
    bi.biPlanes = 1
    bi.biBitCount = 32

    buf = ctypes.create_string_buffer(w * h * 4)
    got = gdi32.GetDIBits(memdc, bmp, 0, h, buf, ctypes.byref(bi), DIB_RGB_COLORS)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(memdc)
    user32.ReleaseDC(hwnd, hdc_win)
    if not got:
        return None
    if ok == 0 or all(b == 0 for b in buf.raw[::997]):
        return None
    return _to_rgb(buf, w, h)


def chrome_score(rgb, w, h):
    """顶部工具条（标签页 + 地址栏）的明暗反差：越大 = 越像激活态。"""
    y0, y1 = 18, min(34, h - 1)
    x0, x1 = 100, min(950, w - 1)
    vals = []
    for y in range(y0, y1):
        base = y * w * 3
        for x in range(x0, x1):
            i = base + x * 3
            vals.append(0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2])
    n = len(vals)
    mean = sum(vals) / n
    var = sum((v - mean) ** 2 for v in vals) / n
    lo = sorted(vals)[int(n * 0.02)]
    hi = sorted(vals)[int(n * 0.98)]
    return var ** 0.5, mean, hi - lo


def shot_looks_normal(sd, mean):
    """
    这张图里的工具条，像不像「一个正常激活的浏览器窗口」？

    三种实测读数（Day 13 补）：
        失活灰化    ≈ sd 16  / mean 91
        正常激活    ≈ sd 40  / mean 228~238
        全黑或最小化 ≈ sd 89  / mean 39   ← 反差反而最高，
                                            所以「sd 够大就算合格」这种判据抓不出它
    因此判据要同时卡住上下界和亮度。
    """
    return 25 <= sd <= 70 and mean >= 150


def write_png(path, w, h, rgb):
    raw = bytearray()
    stride = w * 3
    for row in range(h):
        raw.append(0)
        raw += rgb[row * stride:(row + 1) * stride]

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    args = sys.argv[1:]
    pair_out = None
    if "--pair" in args:
        i = args.index("--pair")
        pair_out = os.path.abspath(args[i + 1])
        del args[i:i + 2]

    out_path = os.path.abspath(args[0])
    action = args[1] if len(args) > 1 else "none"
    w_want = int(args[2]) if len(args) > 2 else 1240
    h_want = int(args[3]) if len(args) > 3 else 960
    cap = int(args[4]) if len(args) > 4 else 1700
    tries = int(args[5]) if len(args) > 5 else 6

    # 目标地址可用环境变量 SHOT_URL 覆盖 —— 换项目、或要用 http://localhost 而不是
    # file:// 时（两者是**不同的存储区**，数据不通用），不用改脚本
    url = os.environ.get("SHOT_URL") or \
        "file:///C:/Users/LM/WorkBuddy/2026-09-17-21-37-40/my-website/dashboard.html"
    # 窗口标题关键字同样会因为换页面而失配 —— Windows 的窗口标题就是页面的 <title>。
    # 默认那两页的 <title> 里分别有「习惯看板」/「dashboard」；
    # 今日页 index.html 的 <title> 是「习惯养成规划板」，两个都不含 → 必须能覆盖，
    # 否则表现是「RESULT=FAIL 没找到浏览器窗口」，看着像启动太慢，其实是关键词不对。
    title_kw = os.environ.get("SHOT_TITLE") or ""
    profile = os.path.join(HERE, "..", ".edgeprofile-" + (action or "none"))

    if not os.path.exists(EDGE):
        raise SystemExit("找不到 Edge: " + EDGE)
    os.makedirs(profile, exist_ok=True)

    # Day 24：这一轮要拍的是「F12 里长什么样」—— 让 Edge 起窗口就把 DevTools 一起打开，
    # 并预先把面板拨到 Console（全新 profile 默认停在 Elements，得靠 Preferences 提前设好）。
    # ⚠️ DevTools 自己的偏好躺在这个 profile 的 Default/Preferences 里；值是**被 JSON 再编码一次的字符串**，
    #    所以 "console" 得写成 \"console\"。
    try:
        import json as _json
        _d = os.path.join(profile, "Default")
        os.makedirs(_d, exist_ok=True)
        with open(os.path.join(_d, "Preferences"), "w", encoding="utf-8") as _f:
            _json.dump({
                "devtools": {
                    "preferences": {
                        "currentDockState": '"right"',
                        "panel-selectedTab": '"console"',
                    }
                }
            }, _f)
        print("[shot24dev] 已把 DevTools 面板预设成 console")
    except Exception as _e:
        print("[shot24dev] 预设 DevTools 面板失败（不影响抓图）：" + str(_e))

    for kw in ([title_kw] if title_kw else ["习惯看板", "dashboard"]):
        close_stale(kw)
    time.sleep(2)

    proc = subprocess.Popen([
        EDGE,
        "--user-data-dir=" + os.path.abspath(profile),
        "--remote-debugging-port=" + PORT,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate,OptimizationHints",
        "--auto-open-devtools-for-tabs",
        "--window-position=100,10",
        "--window-size=%d,%d" % (w_want, h_want),
        url,
    ])
    time.sleep(14)   # 等浏览器起窗口 + 页面 load 完

    # ② 先找窗口，把它弄到前台并「预热」到确实处于激活态
    #    为什么把激活提到动作之前（Day 11 改的）：
    #    动作可能触发只活两三秒的短暂反馈（提示条、动画）。原来「动作 → 激活 → 拍」
    #    的顺序里，光是激活加真鼠标点标题栏就要两三秒，等真正抓图时提示条早收走了。
    #    改成「预热激活 → 动作 → 立刻拍」，中间不留任何多余等待。
    hwnds = find_windows(title_kw) if title_kw else (
        find_windows("习惯看板") or find_windows("dashboard"))
    if not hwnds:
        # Day 15 补的兜底：标题会随页面变化（中间页 → 真实页面），
        # 而找窗口发生在动作之前，按标题可能从一开始就匹配不上。
        # 按「自己启动的那个进程」找就不会错。
        hwnds = windows_of_pid(proc.pid)
        if hwnds:
            print("按标题没找到，改用进程 PID 匹配到 %d 个窗口（pid=%d）" % (len(hwnds), proc.pid))
    if not hwnds:
        print("RESULT=FAIL 没找到浏览器窗口")
        proc.terminate()
        return

    # Day 15 补：一个浏览器进程可能有不止一个可见顶层窗口（还有尺寸很小的辅助窗口）。
    # 抓错了会得到一张 786x741 的小图，而且后续动作会做在别的窗口里 —— 整轮白拍。
    # 主窗口就是面积最大的那个：显式挑出来，并把每个候选的尺寸打出来（便于事后核对）。
    def _win_area(hw):
        rr = RECT()
        user32.GetWindowRect(hw, ctypes.byref(rr))
        return max(0, rr.right - rr.left) * max(0, rr.bottom - rr.top)

    hwnds = sorted(hwnds, key=_win_area, reverse=True)
    for _h in hwnds:
        _r = RECT()
        user32.GetWindowRect(_h, ctypes.byref(_r))
        print("候选窗口 hwnd=%d 尺寸=%dx%d" % (_h, _r.right - _r.left, _r.bottom - _r.top))
    hwnd = hwnds[0]
    if not activate(hwnd):
        print("RESULT=WARN 窗口还原失败")

    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    print("window rect:", r.left, r.top, w, h)
    if w < 300 or h < 200:
        print("RESULT=FAIL 窗口尺寸异常 %dx%d" % (w, h))
        proc.terminate()
        return
    h = min(h, cap)

    # 预热：反复激活 + 真鼠标点标题栏，直到**连续两次读数一致**为止。
    # 为什么要「连续两次一致」而不只是「达标一次」（Day 11 实测）：
    #   刚被激活的那一两张图处在一个过渡态 —— 标签栏的亮暗还在变，
    #   于是同一个窗口会读出 均值228.3 和 均值238.6 两个稳定值（sd 都在 40 上下，都在阈值之上）。
    #   前后两张如果各落在一档，工具条统计就对不上，可比性直接没了。
    #   要求连续两次一致，等于等到窗口状态真的稳住了再往下走。
    # 这一步抓到的图不保存，纯粹是探路 —— 好处是不占用动作之后的宝贵时间。
    pre_ok = False
    prev = None
    pre_ref = None
    for attempt in range(1, tries + 1):
        activate(hwnd)
        click_to_focus(hwnd)
        rgb = capture_window(hwnd, w, h)
        if rgb is None:
            print("预热 %d: 抓取失败" % attempt)
            prev = None
            continue
        sd, mean, rng = chrome_score(rgb, w, h)
        print("预热 %d: 工具条反差 sd=%.1f 均值=%.1f 极差=%.1f" % (attempt, sd, mean, rng))
        # 灰化态约 16，正常激活态约 40，所以 30 是可靠的分界线（Day 10 实测）
        if sd >= 30:
            if prev is not None and abs(prev[0] - sd) < 1.0 and abs(prev[1] - mean) < 1.0:
                pre_ok = True
                pre_ref = (sd, mean)
                break
            prev = (sd, mean)
        else:
            prev = None
    if not pre_ok:
        print("WARN 预热没等到稳定状态，仍按当前状态拍，可能与前一张不可比")

    # ②.5 配对模式：先在「动作之前」拍一张。
    #   为什么两张要挤在同一个进程里（Day 11 实测，代价是白拍两轮）：
    #   同一个窗口会读出两个**都很稳定**的工具条档位 —— 均值 228.3 和 238.6。
    #   两次独立运行很容易一张落一档，工具条统计对不上、可比性直接没了；
    #   靠「预热到稳定」也消不掉它（两次运行各自稳定在不同档）。
    #   同一个会话里隔几秒连拍，窗口状态必然一致，剩下差异就只剩页面内容本身。
    if pair_out:
        rgb = capture_window(hwnd, w, h)
        if rgb is None:
            print("WARN 配对的第一张（动作前）抓取失败")
        else:
            sd, mean, rng = chrome_score(rgb, w, h)
            write_png(pair_out, w, h, rgb)
            print("动作前: 工具条反差 sd=%.1f 均值=%.1f 极差=%.1f → %s"
                  % (sd, mean, rng, pair_out))

    # ③ 让 Node 经 CDP 做动作
    env = dict(os.environ)
    env["NODE_PATH"] = NODE_MODULES
    node_run = subprocess.run(
        [NODE, CDP_JS, PORT, action],
        env=env, capture_output=True, text=True, timeout=180, cwd=HERE
    )
    print("[node] " + (node_run.stdout or "").strip())
    if node_run.stderr and node_run.stderr.strip():
        print("[node stderr] " + node_run.stderr.strip())

    # ④ 抓图。
    #
    #   例外之一：SHOT_SETTLE_MS > 0 时，先重新激活窗口、等一会儿再拍。
    #   什么时候需要：要拍的是**静态页面**（没有转眼就没的提示条），
    #   而动作里夹着页面跳转这类耗时操作 —— 期间焦点容易被别的窗口抢走。
    settle = int(os.environ.get("SHOT_SETTLE_MS") or 0)
    if settle:
        activate(hwnd)
        click_to_focus(hwnd)
        time.sleep(settle / 1000.0)

    #   例外之二：连拍挑合格（Day 13 加）。
    #   PrintWindow 会**间歇性**抓回一张全黑 / 最小化的图 —— 同一份代码、同一份参数，
    #   上一分钟拍的是正常窗口，下一分钟就拍回一片黑，而且两次黑图的统计**完全相同**
    #   （sd=89.3 / mean=39.2），说明那是个确定性的坏状态，不是随机噪声。
    #   旧判据只看「sd 够不够大」，恰恰漏掉它 —— 黑图的反差比正常图还高。
    #   ✅ 改成：连拍几张，挑第一张「像正常窗口」的；都不合格就用第一张，不比原来更差。
    #   ⚠️ 根因**待确认**（没有一次抓到「窗口确实最小化」的直接证据），
    #      目前按「间歇性坏状态」处理，靠重拍绕过。
    best = None
    for k in range(1, tries + 1):
        rgb = capture_window(hwnd, w, h)
        if rgb is None:
            print("正式拍 %d: 抓取失败" % k)
            continue
        sd, mean, rng = chrome_score(rgb, w, h)
        print("正式拍 %d: 工具条反差 sd=%.1f 均值=%.1f 极差=%.1f" % (k, sd, mean, rng))

        if best is None:
            best = (sd, mean, rng, rgb)
        if shot_looks_normal(sd, mean):
            best = (sd, mean, rng, rgb)
            break

        activate(hwnd)
        click_to_focus(hwnd)
        time.sleep(0.9)

    if best is None:
        print("RESULT=FAIL 动作之后抓取失败")
    else:
        sd, mean, rng, rgb = best
        write_png(out_path, w, h, rgb)
        print("RESULT=OK saved=%s %dx%d 反差=%.1f" % (out_path, w, h, sd))

    # 优雅关闭
    close_stale("习惯看板")
    close_stale("dashboard")
    # Day 15：标题会随页面变（习惯养成规划板 / 页面访问提示 …），按关键字可能一个都匹配不上，
    # 结果浏览器没被优雅关掉 → 下次启动恢复出多余标签页。按 pid 兜一层最保险。
    for _hwnd in windows_of_pid(proc.pid):
        user32.PostMessageW(_hwnd, WM_CLOSE, 0, 0)
    for _ in range(10):
        time.sleep(1)
        if proc.poll() is not None:
            break
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
