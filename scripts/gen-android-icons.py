#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把桌面端已发布的品牌图标派生成 Android 的图标与启动图。

背景：`npx cap add android` 铺出来的 `res/` 里**全是 Capacitor 默认素材**（白底圆角方块 +
品牌无关的 X 形 logo，启动图同理）。这一层**所有门禁都看不见**：9 个 UI 套件、472 个单测、
全部 CI 守卫都会绿，可装到真机上，桌面图标和启动屏仍然写着 Capacitor —— 属于"只能在设备上
看见"的那一类。本脚本把它换成 Rain Music 的品牌素材。

不引入新美术：源图就是桌面端已经在用的 `resources/icons/icon.png`（RGBA，黑底 + 白色音符/
播放三角，四角透明）。这里只做确定性的重采样与合成。

产物（尺寸与 `cap add` 原产逐一同尺寸，避免动到任何布局/拉伸行为）：
  * mipmap-*/ic_launcher.png            传统图标：API 24–25 与不做自适应图标的启动器用它
  * mipmap-*/ic_launcher_round.png      圆形传统图标
  * mipmap-*/ic_launcher_foreground.png 自适应图标前景：把白色字形从黑底提出来做成 alpha
                                        （**亮度即不透明度**），缩进 108dp 画布的 66dp 安全区
  * values/ic_launcher_background.xml   自适应图标背景色 -> #000000（原来是 #FFFFFF）
  * drawable*/splash.png                启动图：品牌黑底 + 居中字形

未被引用的 `drawable/ic_launcher_background.xml`（默认那张网格矢量）与
`drawable-v24/ic_launcher_foreground.xml` 是 `cap add` 留下的死文件，本脚本不动它们。

用法（在仓库根目录）：python scripts/gen-android-icons.py

产物是**已提交**的 PNG（Android 构建直接读 `res/`，没有生成步骤），所以换素材要跑本脚本并把
产物一起提交；`tests/unit/android-brand-assets.test.cjs` 会逐张校验尺寸 / alpha / 背景色，
并拒绝那 6 张脚手架默认图回来。
"""

import hashlib
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
SOURCE = ROOT / 'resources' / 'icons' / 'icon.png'

BRAND = (0, 0, 0)          # 品牌黑，与源图底色一致：自适应背景色也用它
GLYPH = (255, 255, 255)    # 源图里的白色字形
FOREGROUND_RATIO = 0.58    # 字形最大边 / 108dp 画布。自适应图标的安全区是 66dp 圆，取 0.58 留出余量
SPLASH_RATIO = 0.30        # 启动图里字形最大边 / 短边

# 与 `cap add` 原产逐一同尺寸（见 .design/android-icon-manifest.txt 之外的尺寸表）
LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
SPLASH = {
    'drawable': (480, 320),
    'drawable-port-mdpi': (320, 480),
    'drawable-port-hdpi': (480, 800),
    'drawable-port-xhdpi': (720, 1280),
    'drawable-port-xxhdpi': (960, 1600),
    'drawable-port-xxxhdpi': (1280, 1920),
    'drawable-land-mdpi': (480, 320),
    'drawable-land-hdpi': (800, 480),
    'drawable-land-xhdpi': (1280, 720),
    'drawable-land-xxhdpi': (1600, 960),
    'drawable-land-xxxhdpi': (1920, 1280),
}


def glyph_layer(source):
    """把白色字形从黑底里提出来：亮度当不透明度，颜色一律纯白。

    源图是单色（黑底 + 白字形 + 抗锯齿灰边），所以 `L` 通道天然就是字形的 alpha：
    黑底 -> 0（透明），白字 -> 255（不透明），灰边 -> 半透明。这样得到的字形既没有黑底，
    也不会在自适应图标的黑背景上糊出一圈方块。

    **黑场要抬一刀**：源图的黑底并非严格的 0（有损压缩留下 RGB 1–3 的噪声），直接当 alpha
    会让整个方块蒙上一层 1‰ 的白色 —— 在纯黑背景上就是一圈**肉眼可辨的方框接缝**
    （已用自适应图标的合成预览看到）。把 0–7 压成 0、其余线性拉开，既抹掉这层雾，
    又保留抗锯齿边的过渡。
    """
    lift = [0 if value < 8 else round((value - 8) * 255 / 247) for value in range(256)]
    layer = Image.new('RGBA', source.size, GLYPH + (0,))
    layer.putalpha(source.convert('L').point(lift))
    return layer


def fit(layer, box):
    """按最大边等比缩放 layer 到 box（长边贴合），返回新图。"""
    scale = box / max(layer.size)
    size = (max(1, round(layer.width * scale)), max(1, round(layer.height * scale)))
    return layer.resize(size, Image.LANCZOS)


def centered(layer, canvas_size, box):
    """在透明画布正中放一个缩放到 box 的 layer。"""
    canvas = Image.new('RGBA', (canvas_size, canvas_size), GLYPH + (0,))
    art = fit(layer, box)
    canvas.alpha_composite(art, ((canvas_size - art.width) // 2, (canvas_size - art.height) // 2))
    return canvas


def legacy_icon(source, size):
    return source.resize((size, size), Image.LANCZOS)


def round_icon(source, size):
    """圆形图标：4 倍超采样画遮罩，边缘才不会出现锯齿。"""
    big = size * 4
    art = source.resize((big, big), Image.LANCZOS)
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    art.putalpha(ImageChops.multiply(art.getchannel('A'), mask))
    return art.resize((size, size), Image.LANCZOS)


def splash(glyph, size):
    """启动图：品牌黑底 + 居中字形（`AppTheme.NoActionBarLaunch` 的 windowBackground）。"""
    canvas = Image.new('RGB', size, BRAND)
    art = fit(glyph, round(min(size) * SPLASH_RATIO))
    canvas.paste(art, ((size[0] - art.width) // 2, (size[1] - art.height) // 2), art)
    return canvas


def main():
    if not SOURCE.exists():
        sys.exit('源图不存在：%s' % SOURCE)
    source = Image.open(SOURCE).convert('RGBA')
    if source.size != (512, 512):
        sys.exit('源图尺寸变了（%s），请先确认版权与用法' % (source.size,))
    glyph = glyph_layer(source)
    if glyph.getchannel('A').getbbox() is None:
        sys.exit('源图里提取不出字形（整张透明？）')

    written = []

    def emit(path, image, mode='RGBA'):
        path.parent.mkdir(parents=True, exist_ok=True)
        image.convert(mode).save(path, 'PNG', optimize=True)
        written.append(path)

    for density, size in LEGACY.items():
        base = RES / ('mipmap-%s' % density)
        emit(base / 'ic_launcher.png', legacy_icon(source, size))
        emit(base / 'ic_launcher_round.png', round_icon(source, size))
    for density, size in FOREGROUND.items():
        base = RES / ('mipmap-%s' % density)
        emit(base / 'ic_launcher_foreground.png', centered(glyph, size, size * FOREGROUND_RATIO))
    for folder, size in SPLASH.items():
        emit(RES / folder / 'splash.png', splash(glyph, size), mode='RGB')

    # 自适应图标的背景色：默认是 #FFFFFF，和源图的黑底正好相反
    color_file = RES / 'values' / 'ic_launcher_background.xml'
    color_file.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <color name="ic_launcher_background">#%02X%02X%02X</color>\n'
        '</resources>\n' % BRAND,
        encoding='utf-8',
    )
    written.append(color_file)

    print('源图 %s  %dx%d' % (SOURCE.relative_to(ROOT), source.width, source.height))
    print('写出 %d 个文件：' % len(written))
    for path in written:
        data = path.read_bytes()
        print('  %-58s %7d B  %s' % (
            str(path.relative_to(ROOT)).replace('\\', '/'),
            len(data),
            hashlib.sha256(data).hexdigest()[:16],
        ))


if __name__ == '__main__':
    main()
