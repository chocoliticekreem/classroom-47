---
name: ngl-fluffy-ui
description: >-
  Design and build interfaces in the NGL (ngl.link) aesthetic combined with a happy,
  fluffy, volumetric, and radically simple style. Use this skill whenever asked to build
  or style UI, landing pages, cards, HUDs, overlays, buttons, or 3D/2D visuals with an
  NGL vibe, fluffy/puffy/volumetric feel, playful candy gradients, frosted bubble cards,
  or bouncy simple interfaces.
---

# NGL Fluffy & Volumetric UI Skill

Goal: Build interfaces that feel like **ngl.link meets a squishy, sun-lit marshmallow toy** — hyper-friendly, candy-colored, volumetric, tactile, and radically simple. Zero corporate clutter, zero sharp edges, 100% happy energy.

---

## The 7 Rules of NGL Fluffy Volumetric Style

1. **Candy Sunset Gradients as the Stage.** Never use sterile gray (`#f5f5f5`) or flat corporate blue backgrounds. The canvas is either a rich diagonal candy gradient (`#EC1187 → #FF8D10`) with soft floating glow blobs, or pitch-black (`#000000`) / marshmallow-cream (`#FFF8FA`) where gradient cards pop like neon pillows.
2. **The Two-Part "Bubble Card" Architecture.** Inspired directly by `ngl.link`'s signature prompt card:
   - **Top Cap (`.ngl-bubble-header`)**: Solid crisp white (`#FFFFFF`) with extra-round top corners (`32px 32px 0 0`), holding a circular avatar pill, `@username`, and an extrabold prompt.
   - **Frosted Body (`.ngl-bubble-body`)**: Translucent frosted glass (`rgba(255, 255, 255, 0.45)`, `backdrop-filter: blur(24px)`) with rounded bottom corners (`0 0 28px 28px`) and soft inner volumetric highlights.
3. **Volumetric Pillow Lighting (3-Layer Shadows).** Every card, button, and badge must feel **inflated and touchable** using a 3-part `box-shadow`:
   - *Top-left specular rim*: `inset 0 3px 6px rgba(255, 255, 255, 0.85)`
   - *Bottom inner cushion*: `inset 0 -4px 8px rgba(0, 0, 0, 0.12)`
   - *Soft colored ambient drop*: `0 16px 32px -8px rgba(236, 17, 135, 0.35)` (or `0 10px 24px rgba(0, 0, 0, 0.22)`).
4. **Chunky Pill CTAs (`border-radius: 9999px`) with Wobble.** Primary buttons are full-width or generous pills (`height: 60px`), styled in either **Pitch Black (`#000`)**, **Marshmallow White (`#FFF`)**, or **Inflated Candy Gradient**, paired with playful idle micro-motions (a periodic gentle tilt-shake `±1.5deg` + `scale(1.05)`) and squishy `:active` press (`scale(0.95)`).
5. **Extrabold Grotesque + Sticker Outlines.** Use heavy, rounded-feeling sans/grotesque fonts (`"ES Rebond Grotesque"`, `"Plus Jakarta Sans"`, `"Fredoka"`, `"Avenir Next"`, `"Inter"` at weights `700`–`900`). For hero numbers, ranks, or floating callouts, apply the **NGL Sticker Stroke**: `-webkit-text-stroke: 8px #fff; paint-order: stroke fill;`.
6. **Tilted Floating Stickers & Emoji Orbs.** Break rigid grids by tilting avatars, badges, or 3D icons (`transform: rotate(-6deg)` or `rotate(12deg)`) and tucking translucent circular emoji buttons (like NGL's `🎲` dice orb: `rgba(255, 255, 255, 0.35)`, `border-radius: 9999px`) inside card corners.
7. **Radical Simplicity (One Hero Action per View).** Follow NGL's mobile-first discipline: `85%` width column (`max-width: 440px` for cards, `640px` for containers), generous vertical rhythm, short lowercase or punchy conversational copy (`"send me anonymous messages..."`, `"🔒 anonymous vibes"`, `"👇 244 friends just tapped 👇"`), and **never** use thin `1px solid #e5e7eb` borders or dense multi-column forms.

---

## Core Design Tokens (Drop-in CSS Variables)

Add these tokens to `:root` or your global stylesheet:

```css
:root {
  /* === NGL Signature Gradients === */
  --ngl-grad-primary: linear-gradient(135deg, #EC1187 0%, #FF8D10 100%);
  --ngl-grad-vertical: linear-gradient(180deg, #FE831B 0%, #ED1980 100%);
  --ngl-grad-berry: linear-gradient(157deg, #FF4079 0%, #5403D9 100%);
  --ngl-grad-violet: linear-gradient(180deg, #2D0049 0%, #8E00E5 100%);
  --ngl-grad-cyber: linear-gradient(131deg, #5F0055 0%, #00FFFF 100%);
  --ngl-grad-cherry: linear-gradient(180deg, #FF008A 0%, #D30000 100%);
  --ngl-grad-cloud: linear-gradient(180deg, #FFF5F9 0%, #FFE3EE 100%);

  /* === Solid & Translucent Surfaces === */
  --ngl-pink: #EC1187;
  --ngl-orange: #FF8D10;
  --ngl-black: #000000;
  --ngl-white: #FFFFFF;
  --ngl-glass-light: rgba(255, 255, 255, 0.45);
  --ngl-glass-strong: rgba(255, 255, 255, 0.72);
  --ngl-glass-pill: rgba(255, 255, 255, 0.28);
  --ngl-text-muted-dark: rgba(0, 0, 0, 0.32);
  --ngl-text-muted-light: rgba(255, 255, 255, 0.75);

  /* === Fluffy Volumetric Shadows === */
  --ngl-shadow-fluffy-white:
    inset 0 4px 8px rgba(255, 255, 255, 0.95),
    inset 0 -5px 10px rgba(236, 17, 135, 0.08),
    0 16px 32px -6px rgba(0, 0, 0, 0.18),
    0 4px 12px rgba(236, 17, 135, 0.15);

  --ngl-shadow-fluffy-glass:
    inset 0 2px 4px rgba(255, 255, 255, 0.7),
    inset 0 -4px 8px rgba(255, 141, 16, 0.12),
    0 20px 40px -10px rgba(180, 10, 90, 0.28);

  --ngl-shadow-fluffy-black:
    inset 0 3px 6px rgba(255, 255, 255, 0.28),
    inset 0 -4px 8px rgba(0, 0, 0, 0.6),
    0 10px 24px -4px rgba(0, 0, 0, 0.35);

  --ngl-shadow-fluffy-candy:
    inset 0 4px 8px rgba(255, 255, 255, 0.55),
    inset 0 -5px 10px rgba(140, 0, 70, 0.3),
    0 14px 28px -6px rgba(236, 17, 135, 0.45);

  /* === Radii & Typography === */
  --ngl-radius-card-top: 32px 32px 0 0;
  --ngl-radius-card-bottom: 0 0 28px 28px;
  --ngl-radius-card: 32px;
  --ngl-radius-pill: 9999px;
  --ngl-font-display: "Plus Jakarta Sans", "Fredoka", "Avenir Next", "Inter", system-ui, sans-serif;
  --ngl-font-body: "Avenir Next", "Plus Jakarta Sans", "Inter", system-ui, sans-serif;
}
```

---

## Quick Visual Checklist (Do This Every Time)

- **Surfaces**: Are containers using `28px–36px` border-radius with soft inner + outer volumetric shadows instead of flat `1px` borders?
- **Buttons**: Are CTAs `60px` tall `9999px` pills with `font-weight: 800`, top specular shine, and bouncy hover/active states (`scale(1.03)` / `scale(0.95)`)?
- **Vibe**: Is there at least one playful detail — an emoji orb (`🎲`, `✨`, `🔥`), a tilted badge (`rotate(-4deg)`), a sticker-outlined title, or a friendly social proof line (`"👇 friends just tapped 👇"`)?
- **Clarity**: Can you understand the screen in 0.5 seconds? Keep copy short, bold, and human.

---

## Reference Guides (Load When Needed)

- [components.md](./components.md) — Copy-paste CSS & React/Tailwind recipes for the NGL Split Bubble Card, Fluffy Pill Buttons, Wobble Keyframes, Dice/Emoji Action Orbs, Sticker Text, and Floating HUDs.
- [volumetric-and-3d.md](./volumetric-and-3d.md) — How to achieve puffy marshmallow/clay depth in CSS, ambient cloud layers, spring physics, and translating the NGL Fluffy Volumetric style into Three.js / React Three Fiber 3D scenes.
