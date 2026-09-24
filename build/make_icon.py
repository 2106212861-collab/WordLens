# -*- coding: utf-8 -*-
"""词镜 WordLens 图标 v2 —— 真 squircle + 对角渐变 + 顶部高光 + 简洁书本符号"""
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512          # 高分辨率生成，最后缩到 256 抗锯齿
N = 5.0             # squircle 超椭圆指数（iOS 约 4.7~5）
MARGIN = SIZE * 0.03

c = SIZE / 2.0
r = SIZE / 2.0 - MARGIN

# ---- 1. squircle 蒙版（逐像素，超椭圆 |x/r|^n + |y/r|^n <= 1）----
mask = Image.new('L', (SIZE, SIZE), 0)
mp = mask.load()
for y in range(SIZE):
    for x in range(SIZE):
        dx = abs(x - c) / r
        dy = abs(y - c) / r
        if dx ** N + dy ** N <= 1.0:
            mp[x, y] = 255

# ---- 2. 对角渐变（左上亮蓝 -> 右下紫）----
top = (64, 156, 255)     # #409CFF
bottom = (92, 82, 232)   # #5C52E8
grad = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
gp = grad.load()
for y in range(SIZE):
    for x in range(SIZE):
        t = (x + y) / (2.0 * (SIZE - 1))          # 对角插值
        rr = int(top[0] + (bottom[0] - top[0]) * t)
        gg = int(top[1] + (bottom[1] - top[1]) * t)
        bb = int(top[2] + (bottom[2] - top[2]) * t)
        gp[x, y] = (rr, gg, bb, 255)
grad.putalpha(mask)

d = ImageDraw.Draw(grad)

# ---- 3. 顶部高光（玻璃反光感）----
highlight = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
hd = ImageDraw.Draw(highlight)
for y in range(0, int(SIZE * 0.42)):
    a = int(70 * (1 - y / (SIZE * 0.42)))          # 从上到下衰减
    hd.line([(0, y), (SIZE, y)], fill=(255, 255, 255, a))
highlight = highlight.filter(ImageFilter.GaussianBlur(8))
highlight.putalpha(mask)
grad = Image.alpha_composite(grad, highlight)

# ---- 4. 底部柔光（立体感）----
d = ImageDraw.Draw(grad)
shade = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shade)
for y in range(int(SIZE * 0.78), SIZE):
    a = int(45 * ((y - SIZE * 0.78) / (SIZE * 0.22)))
    sd.line([(0, y), (SIZE, y)], fill=(40, 30, 120, a))
shade = shade.filter(ImageFilter.GaussianBlur(10))
shade.putalpha(mask)
grad = Image.alpha_composite(grad, shade)

# ---- 5. 白色书本符号（打开的书 + 光点）----
d = ImageDraw.Draw(grad)
# 左页 / 右页
d.polygon([(180, 208), (256, 188), (256, 340), (180, 356)], fill=(255, 255, 255, 255))
d.polygon([(332, 208), (256, 188), (256, 340), (332, 356)], fill=(255, 255, 255, 255))
# 书脊中线
d.line([(256, 188), (256, 340)], fill=(216, 226, 250, 255), width=4)
# 书页文字线（浅蓝，营造质感）
for yy in range(216, 332, 22):
    d.line([(196, yy), (248, yy - 3)], fill=(130, 160, 225, 150), width=6)
    d.line([(264, yy - 3), (316, yy)], fill=(130, 160, 225, 150), width=6)
# 右上角"镜"光点
d.ellipse([352, 148, 396, 192], fill=(255, 255, 255, 235))
d.ellipse([362, 158, 386, 182], fill=(255, 255, 255, 255))

# ---- 6. 缩到 256 并输出 ----
icon = grad.resize((256, 256), Image.LANCZOS)
icon.save('build/icon.png')
icon.save('build/icon.ico', format='ICO',
           sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('OK: icon.png + icon.ico (v2 squircle)')
