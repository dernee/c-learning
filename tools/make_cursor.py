#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
像素剑光标生成脚本
==================

把一张「像素风武器」PNG 转成网站用的鼠标光标资源。

原图:Minecraft Enchanted Diamond Sword(SweezyCursors 包)
  - 128x128, P 模式 + tRNS 透明
  - 剑尖朝左上、剑柄朝右下
  - 逻辑像素8px(即 16x16 的像素画被放大 8倍)

处理三件事:
  1. 半透明毛边二值化 —— 原图边缘有 alpha=13/241/242/243 的过渡像素。
     直接当光标用，在深色背景上会显出一圈灰边（"脏边"），必须按阈值切干净。
  2. 定位剑尖 —— 热点要落在剑尖上，鼠标点才正好指着剑尖而不是剑身中间。
  3. 缩到 64px —— 浏览器光标上限是 128px，但 128 的剑会挡住大片内容。
     用整数倍(128->64)缩放，像素块 8px->4px，保持锐利不糊。

用法:
  python tools/make_cursor.py                      # 用默认源图
  python tools/make_cursor.py "路径/另一张图.png"    # 换图

换图后必须同步修改 css/style.css 里 --cursor-sword 的热点数值，
脚本结束时会把该打印出来。
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('缺少 Pillow，先装：pip install Pillow')

# 源图：桌面上的原始素材
DEFAULT_SRC = os.path.join(
    os.path.expanduser('~'),
    'Desktop',
    'Minecraft Enchanted Diamond Sword Animated Cursor--cursor--SweezyCursors.png'
)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
OUT_NAME = 'cursor-sword.png'

TARGET = 64        # 输出尺寸；浏览器上限 128，日常用 64 足够醒目
ALPHA_CUT = 128# alpha 阈值：>=此值保留，<此值归零


def locate_tip(al, w, h):
    """返回剑尖坐标 (x, y)：最上一行非透明像素区间的中点。

    之所以取「区间中点」而不是最左像素：剑尖是个有宽度的斜切块，
    取中点视觉上才真正落在剑尖中央。
    """
    top = None
    for y in range(h):
        if any(al.getpixel((x, y)) > 0 for x in range(w)):
            top = y
            break
    if top is None:
        raise SystemExit('图片全透明，无法定位剑尖')

    xs = [x for x in range(w) if al.getpixel((x, top)) > 0]
    return (min(xs) + max(xs)) // 2, top


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.isfile(src):
        raise SystemExit('找不到源图：%s' % src)

    im = Image.open(src).convert('RGBA')
    w, h = im.size
    print('源图%s  %dx%d' % (os.path.basename(src), w, h))

    # ---- 1. alpha 二值化，砍掉半透明毛边 ----
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= ALPHA_CUT else (0, 0, 0, 0)

    # ---- 2. 定位剑尖 ----
    tip_x, tip_y = locate_tip(im.split()[3], w, h)
    print('剑尖(原图)  = (%d, %d)' % (tip_x, tip_y))

    # ---- 3. 缩放 + 换算热点 ----
    scaled = im.resize((TARGET, TARGET), Image.NEAREST)   # NEAREST 保持像素锐利
    hx = tip_x * TARGET // w
    hy = tip_y * TARGET // h

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, OUT_NAME)
    scaled.save(out, optimize=True)
    print('已写出      %s  (%d bytes)' % (out, os.path.getsize(out)))

    print('')
    print('★ 请把下面这行同步到 css/style.css 的 :root：')
    print('  --cursor-sword: url("../assets/%s") %d %d, default;' % (OUT_NAME, hx, hy))


if __name__ == '__main__':
    main()
