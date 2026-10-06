# -*- coding: utf-8 -*-
"""
把角色处理成「圆形头像」。

为什么必须这么做
----------------
源图 1791262464516.png 是超近景头像特写：头发被上边缘切平、脸颊被左右
边缘切掉，四个角全是背景色。去背后剩下的必然是一个**贴满画布的矩形**，
叠在彩色爆炸框上就成了一块突兀的方板（原型阶段在深色背景上不明显，
部署到网站后非常刺眼）。

rage-comic 风格本身大量使用「圆形头像」，所以把角色收进圆里既解决了
硬边，又更契合画风。

做法
----
1. 取最大内接圆（实测 r=280，圆心 279,279）
2. 圆外 alpha 归零
3. 圆边加一圈极粗黑描边：既吃掉锯齿，又和画风里的粗描边呼应
"""
from PIL import Image, ImageDraw
import numpy as np
import os

SRC = os.path.join(os.path.dirname(__file__), '..', 'assets', 'fx-face.png')
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'fx-face.png')

R = 280          # 最大内接圆半径
CX = CY = 279# 圆心（源图内坐标）
SS = 4           # 超采样倍数，边缘更平滑
BORDER = 12      # 描边粗细（输出像素）
BORDER_RGB = (18, 18, 20)

im = Image.open(SRC).convert('RGBA')
W, H = im.size

# ★ 关键：R+BORDER=292 大于源图半宽半高（315/280），圆会贴到画布边上被裁。
#   所以把画布向外扩出PAD，再把圆心同步平移，保证整个圆（含描边）完整落位。
NEED = R + BORDER + 2# 每侧最少留的透明边
PAD = max(0, NEED - min(CX, CY), NEED - (W - 1 - CX), NEED - (H - 1 - CY))
PAD = int(max(PAD, 4))                     # 至少留4px，避免再被裁
NW, NH = W + PAD * 2, H + PAD * 2
CX, CY = CX + PAD, CY + PAD               # 圆心随画布一起平移

print('源图 %dx%d  ->  新画布 %dx%d（各边补 %d px）' % (W, H, NW, NH, PAD))
print('圆心 (%d,%d)  半径 %d + 描边 %d = %d' % (CX, CY, R, BORDER, R + BORDER))

big = (NW * SS, NH * SS)
im2 = im.resize((W * SS, H * SS), Image.LANCZOS)
im2.paste((0, 0, 0, 0), (0, 0, big)) if False else None
# 把原图贴到扩大的画布上（右下角补透明）
stage = Image.new('RGBA', big, (0, 0, 0, 0))
stage.paste(im2, (PAD * SS, PAD * SS))

# --- 1. 圆形遮罩（超采样下画，再缩回 = 抗锯齿）---
mask = Image.new('L', big, 0)
ImageDraw.Draw(mask).ellipse(
    [(CX - R) * SS, (CY - R) * SS, (CX + R) * SS, (CY + R) * SS], fill=255)

# --- 2. 描边：比圆略大的实心圆做黑环，再把内圆挖回去 ---
ring = Image.new('L', big, 0)
ImageDraw.Draw(ring).ellipse(
    [(CX - R - BORDER) * SS, (CY - R - BORDER) * SS,
     (CX + R + BORDER) * SS, (CY + R + BORDER) * SS], fill=255)
ring = Image.composite(Image.new('L', big, 0), ring, mask)  # 环 = 大圆 - 内圆

# --- 3. 合成：先铺黑环，再叠原图 ---
canvas = Image.new('RGBA', big, BORDER_RGB + (0,))
canvas.paste(BORDER_RGB + (255,), (0, 0), ring)   # 黑色描边环
canvas.paste(stage, (0, 0), mask)                 # 圆内原图

out = canvas.resize((NW, NH), Image.LANCZOS)
out.save(OUT, optimize=True)

# --- 校验 ---
a = np.array(out)
al = a[:, :, 3]
ys, xs = np.where(al > 128)
corners = [int(al[0, 0]), int(al[0, -1]), int(al[-1, 0]), int(al[-1, -1])]
print('输出      :', OUT)
print('尺寸      : %dx%d' % (NW, NH))
print('全透明占比: %.1f%%' % (100 * (al < 8).mean()))
print('不透明 bbox: x[%d,%d] y[%d,%d]' % (xs.min(), xs.max(), ys.min(), ys.max()))
print('四边留白  : 左%d 右%d 上%d 下%d（都应>0=圆没被裁）' %
      (xs.min(), NW - 1 - xs.max(), ys.min(), NH - 1 - ys.max()))
print('四角 alpha :', corners)
print('无残留方角:', all(c == 0 for c in corners))