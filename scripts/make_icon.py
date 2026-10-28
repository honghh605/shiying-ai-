"""生成「拾影」双层选片标识与 Windows 图标；仅需项目现有的 Pillow。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "app" / "web"
GREEN = "#226b5b"
PAPER = "#f7f8f4"
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)

# 所有输出共用 128 × 128 几何；透明 SVG 用于界面，实底图标用于任务栏。
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" color="#226b5b" role="img" aria-label="拾影">
  <title>拾影</title>
  <rect class="logo-back" x="18" y="20" width="78" height="70" rx="9" fill="none" stroke="currentColor" stroke-width="8"/>
  <rect class="logo-front" x="34" y="38" width="78" height="70" rx="9" fill="currentColor"/>
  <path class="logo-check" d="M52 72 L65 85 L94 57" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
'''


def draw_icon(size: int = 1024) -> Image.Image:
    """按统一几何超采样，让小尺寸的双层照片轮廓保持清楚。"""
    scale = max(4, size / 128 * 2)
    canvas_size = round(128 * scale)
    icon = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)

    def box(coords: tuple[float, ...]) -> tuple[int, ...]:
        return tuple(round(value * scale) for value in coords)

    def rounded_rect(coords: tuple[float, ...], radius: float, fill: str) -> None:
        draw.rounded_rectangle(box(coords), round(radius * scale), fill=fill)

    # 平面深青绿底，无渐变、投影或光晕。
    rounded_rect((3, 3, 125, 125), 26, GREEN)
    # SVG 描边在路径两侧各 4 单位，等价为以下外轮廓和内镂空。
    rounded_rect((14, 16, 100, 94), 13, PAPER)
    rounded_rect((22, 24, 92, 86), 5, GREEN)
    rounded_rect((34, 38, 112, 108), 9, PAPER)

    points = [(52, 72), (65, 85), (94, 57)]
    draw.line([box(point) for point in points], fill=GREEN, width=round(8 * scale), joint="curve")
    for x, y in points:
        draw.ellipse(box((x - 4, y - 4, x + 4, y + 4)), fill=GREEN)
    return icon.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / "logo.svg").write_text(SVG, encoding="utf-8", newline="\n")
    big = draw_icon(1024)
    big.save(WEB / "icon.png", optimize=True)
    big.save(WEB / "icon.ico", sizes=[(size, size) for size in ICO_SIZES])
    print(f"拾影标识已生成：{WEB / 'logo.svg'}")
    print(f"应用图标：{WEB / 'icon.png'} / {WEB / 'icon.ico'}")


if __name__ == "__main__":
    main()
