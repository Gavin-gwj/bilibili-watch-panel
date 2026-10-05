"""Generate the README banner from real project screenshots and real fonts.

Deterministic: no network, no image-generation API. Re-run after UI changes:

    python docs/assets/build-banner.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
ASSETS = ROOT / "docs" / "assets"
SHOTS = ROOT / "docs" / "screenshots"

W, H = 1600, 500

# Design tokens copied from TOKENS_CSS in bilibili-watch-panel.user.js
BG = (246, 247, 249)
SURFACE = (255, 255, 255)
TEXT = (24, 25, 28)
TEXT_2 = (97, 102, 109)
TEXT_3 = (148, 153, 160)
PINK = (251, 114, 153)
PINK_STRONG = (224, 92, 130)
PINK_SOFT = (255, 241, 245)
BORDER = (232, 234, 237)

FONT_REG = "C:/Windows/Fonts/Alibaba-PuHuiTi-Regular.otf"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_LIGHT = "C:/Windows/Fonts/msyhl.ttc"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def rounded_card(size: tuple[int, int], radius: int, fill=SURFACE) -> Image.Image:
    card = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=fill + (255,)
    )
    return card


def build_background() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Subtle grid, matching the panel's faint chart grid.
    for x in range(0, W, 40):
        draw.line([(x, 0), (x, H)], fill=(240, 241, 243), width=1)
    for y in range(0, H, 40):
        draw.line([(0, y), (W, y)], fill=(240, 241, 243), width=1)

    # Soft pink glow anchored on the right, where the panel card sits.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((900, -140, 1900, 640), fill=PINK + (58,))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    # Thin pink baseline accent across the bottom edge.
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, H - 6, W, H), fill=PINK)
    return img


def build_panel_card() -> Image.Image:
    """Crop the top of the real week panel and scale it into a card."""
    shot = Image.open(SHOTS / "panel-week.png").convert("RGB")
    # Top band of the real panel: header, tabs, weekly goal and the first chart.
    crop = shot.crop((0, 0, shot.width, min(620, shot.height)))
    card_w = 560
    scale = card_w / crop.width
    crop = crop.resize((card_w, int(crop.height * scale)), Image.LANCZOS)

    pad = 10
    card = rounded_card((crop.width + pad * 2, crop.height + pad * 2), 18)
    inner = rounded_card(crop.size, 12)
    inner.paste(crop, (0, 0))
    card.alpha_composite(inner, (pad, pad))
    return card


def main() -> None:
    img = build_background().convert("RGBA")
    draw = ImageDraw.Draw(img)

    f_pill = font(FONT_REG, 20)
    f_title = font(FONT_BOLD, 66)
    f_sub = font(FONT_REG, 27)
    f_feat = font(FONT_REG, 21)
    f_chip = font(FONT_REG, 20)

    left = 88

    # Eyebrow pill
    pill_text = "Tampermonkey  ·  纯本地运行  ·  零数据上传"
    pw = draw.textbbox((0, 0), pill_text, font=f_pill)[2] + 44
    draw.rounded_rectangle((left, 74, left + pw, 122), radius=24, fill=PINK_SOFT)
    draw.text((left + 22, 88), pill_text, font=f_pill, fill=PINK_STRONG)

    # Title
    draw.text((left, 146), "Bilibili Watch Panel", font=f_title, fill=TEXT)

    # Subtitle
    draw.text((left, 238), "本地优先的 B 站个人观看数据面板", font=f_sub, fill=TEXT_2)

    # Pink rule
    draw.rounded_rectangle((left, 292, left + 96, 298), radius=3, fill=PINK)

    # Feature line
    draw.text(
        (left, 322),
        "观看时长  ·  完播率  ·  播放会话  ·  UP 主排行  ·  周报导出",
        font=f_feat,
        fill=TEXT_3,
    )

    # Tab chips
    chips = ["今日", "本周", "全部", "报告"]
    cx = left
    for name in chips:
        tw = draw.textbbox((0, 0), name, font=f_chip)[2]
        bw = tw + 40
        draw.rounded_rectangle((cx, 380, cx + bw, 430), radius=12, fill=SURFACE, outline=BORDER)
        draw.text((cx + 20, 393), name, font=f_chip, fill=TEXT_2)
        cx += bw + 12

    # Real product screenshot card, right side.
    card = build_panel_card()
    cx0 = W - card.width - 76
    cy0 = 62
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (cx0 + 6, cy0 + 14, cx0 + card.width + 6, cy0 + card.height + 14),
        radius=20,
        fill=(24, 25, 28, 46),
    )
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(26)))
    img.alpha_composite(card, (cx0, cy0))

    out = ASSETS / "banner.png"
    img.convert("RGB").save(out, "PNG", optimize=True)

    print(f"wrote {out} ({img.width}x{img.height})")
    print(f"panel card at ({cx0},{cy0}) size {card.width}x{card.height}")


if __name__ == "__main__":
    main()
