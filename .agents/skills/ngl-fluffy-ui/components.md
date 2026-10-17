# NGL Fluffy & Volumetric UI Components

Copy-paste recipes for the signature NGL (`ngl.link`) components upgraded with happy, puffy volumetric depth.

---

## 1. The Signature NGL Split "Bubble Card"

The centerpiece of `ngl.link` is a two-piece rounded card:
1. **Top Cap**: Crisp white (`#FFFFFF`), `border-radius: 32px 32px 0 0`, housing a `44px` circular avatar, light `@handle`, and bold prompt.
2. **Frosted Body**: Translucent blurred glass (`rgba(255, 255, 255, 0.45)`, `backdrop-filter: blur(24px)`), `border-radius: 0 0 28px 28px`, bold `20px` input or content area, and a floating circular corner orb (`🎲`).

### CSS Recipe

```css
.ngl-stage {
  min-height: 100dvh;
  background: #EC1187 linear-gradient(135deg, #EC1187 0%, #FF8D10 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  font-family: var(--ngl-font-body);
}

.ngl-bubble {
  width: 100%;
  max-width: 420px;
  border-radius: 32px 32px 28px 28px;
  filter: drop-shadow(0 20px 36px rgba(140, 0, 70, 0.28));
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ngl-bubble:hover {
  transform: translateY(-3px) scale(1.008);
}

/* Solid White Volumetric Top Cap */
.ngl-bubble-header {
  background: #FFFFFF;
  border-radius: 32px 32px 0 0;
  padding: 18px 20px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow:
    inset 0 4px 6px rgba(255, 255, 255, 1),
    inset 0 -3px 6px rgba(236, 17, 135, 0.06);
}

.ngl-avatar {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  background: linear-gradient(135deg, #FFE0F0, #FFF0D9);
  box-shadow:
    inset 0 2px 4px rgba(255, 255, 255, 0.9),
    0 4px 10px rgba(236, 17, 135, 0.2);
  object-fit: cover;
  flex-shrink: 0;
}

.ngl-handle {
  font-size: 14px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.55);
  line-height: 1.2;
}

.ngl-prompt {
  font-size: 16px;
  font-weight: 800;
  color: #000000;
  line-height: 1.25;
}

/* Frosted Fluffy Lower Body */
.ngl-bubble-body {
  position: relative;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius: 0 0 28px 28px;
  padding: 20px 24px 28px;
  min-height: 150px;
  box-shadow:
    inset 0 2px 4px rgba(255, 255, 255, 0.65),
    inset 0 -6px 12px rgba(255, 141, 16, 0.14);
}

.ngl-textarea {
  width: 100%;
  min-height: 110px;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-size: 20px;
  font-weight: 700;
  color: #000000;
  line-height: 1.35;
}

.ngl-textarea::placeholder {
  color: rgba(0, 0, 0, 0.28);
}

/* Floating Corner Dice / Action Orb */
.ngl-orb-btn {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  border: none;
  background: rgba(255, 255, 255, 0.45);
  box-shadow:
    inset 0 2px 4px rgba(255, 255, 255, 0.9),
    inset 0 -3px 5px rgba(0, 0, 0, 0.08),
    0 6px 14px rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ngl-orb-btn:hover {
  transform: scale(1.12) rotate(12deg);
}

.ngl-orb-btn:active {
  transform: scale(0.92) rotate(-8deg);
}
```

---

## 2. Volumetric Fluffy Pill Buttons & Wobble Animation

Every primary CTA in NGL is a chunky `60px`-tall full pill (`border-radius: 9999px`) with `font-weight: 800` and a subtle periodic attention wobble.

```css
.ngl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 420px;
  min-height: 60px;
  padding: 14px 28px;
  border-radius: 9999px;
  border: none;
  font-family: var(--ngl-font-display);
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.01em;
  text-decoration: none;
  cursor: pointer;
  user-select: none;
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.2s ease;
}

/* Variant A: Pitch Black Puffy Pill (Classic Send! CTA) */
.ngl-btn-black {
  background: #000000;
  color: #FFFFFF;
  box-shadow:
    inset 0 3px 6px rgba(255, 255, 255, 0.28),
    inset 0 -4px 8px rgba(255, 255, 255, 0.06),
    0 12px 24px -4px rgba(0, 0, 0, 0.35);
}

/* Variant B: Marshmallow White Pill */
.ngl-btn-white {
  background: #FFFFFF;
  color: #000000;
  box-shadow:
    inset 0 4px 6px rgba(255, 255, 255, 1),
    inset 0 -5px 10px rgba(236, 17, 135, 0.14),
    0 14px 28px -6px rgba(140, 0, 70, 0.28);
}

/* Variant C: Volumetric Candy Gradient Pill */
.ngl-btn-candy {
  background: linear-gradient(135deg, #FF2A95 0%, #FF9419 100%);
  color: #FFFFFF;
  box-shadow:
    inset 0 4px 8px rgba(255, 255, 255, 0.6),
    inset 0 -5px 10px rgba(160, 0, 70, 0.35),
    0 14px 28px -6px rgba(236, 17, 135, 0.5);
}

.ngl-btn:hover {
  transform: translateY(-2px) scale(1.03);
}

.ngl-btn:active {
  transform: translateY(1px) scale(0.95);
}

/* NGL Signature Periodic Wobble/Pulse */
.ngl-wobble {
  animation: ngl-wobble-shake 2.2s ease-in-out infinite;
}

@keyframes ngl-wobble-shake {
  0%, 12%, 65%, 100% {
    transform: rotate(0deg) scale(1);
  }
  30%, 40% {
    transform: rotate(-1.2deg) scale(1.05);
  }
  35%, 45% {
    transform: rotate(1.2deg) scale(1.05);
  }
}
```

---

## 3. Sticker-Outlined Display Text & Tilted Badges

NGL's landing and campus/boost screens use thick white or lime sticker strokes around extrabold text, plus tilted floating avatar frames:

```css
/* Thick White Sticker Text Outline */
.ngl-sticker-title {
  font-family: var(--ngl-font-display);
  font-weight: 900;
  font-size: clamp(2.25rem, 6vw, 4.25rem);
  line-height: 1.08;
  letter-spacing: -0.03em;
  color: #000000;
  -webkit-text-stroke: 10px #FFFFFF;
  paint-order: stroke fill;
  filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.18));
}

/* Tilted Volumetric Sticker Frame */
.ngl-tilted-sticker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 20px;
  border-radius: 24px;
  background: #FFFFFF;
  border: 4px solid rgba(255, 255, 255, 0.65);
  transform: rotate(-6deg);
  box-shadow:
    inset 0 3px 6px rgba(255, 255, 255, 0.9),
    inset 0 -4px 8px rgba(236, 17, 135, 0.12),
    0 14px 28px rgba(0, 0, 0, 0.22);
}
```

---

## 4. React + Tailwind Quick Component Blueprint

When building in React + Tailwind CSS, use this ready-to-drop component structure:

```tsx
export function NglFluffyCard({
  username = "@bestie",
  prompt = "send me anonymous messages!",
  placeholder = "send me something nice & fluffy...",
  ctaText = "Send! ✨",
  friendsCount = 244,
}: {
  username?: string;
  prompt?: string;
  placeholder?: string;
  ctaText?: string;
  friendsCount?: number;
}) {
  return (
    <div className="min-h-dvh w-full bg-gradient-to-br from-[#EC1187] to-[#FF8D10] flex flex-col items-center justify-between px-5 py-10 text-black select-none relative overflow-hidden">
      {/* Ambient Fluffy Glow Blobs */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-white/25 blur-3xl mix-blend-overlay" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-[#FFE600]/25 blur-3xl mix-blend-overlay" />

      {/* Main Prompt Column */}
      <div className="w-full max-w-[400px] flex flex-col items-center z-10 mt-4">
        {/* Two-part Volumetric Bubble */}
        <div className="w-full rounded-[32px] shadow-[0_22px_44px_-10px_rgba(120,0,60,0.38)] transition-transform duration-300 hover:-translate-y-1">
          {/* Solid White Cap */}
          <div className="bg-white rounded-t-[32px] px-5 pt-4 pb-3.5 flex items-center gap-3 shadow-[inset_0_4px_6px_rgba(255,255,255,1),inset_0_-3px_6px_rgba(236,17,135,0.08)]">
            <div className="h-11 w-11 rounded-full bg-gradient-to-tr from-[#EC1187] to-[#FF8D10] p-0.5 shadow-md shrink-0">
              <div className="h-full w-full rounded-full bg-white flex items-center justify-center text-xl">
                🐣
              </div>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-black/55">{username}</span>
              <span className="text-base font-extrabold text-black">{prompt}</span>
            </div>
          </div>

          {/* Frosted Volumetric Body */}
          <div className="relative bg-white/45 backdrop-blur-xl rounded-b-[28px] px-6 pt-5 pb-7 min-h-[156px] shadow-[inset_0_2px_4px_rgba(255,255,255,0.7),inset_0_-6px_12px_rgba(255,141,16,0.16)]">
            <textarea
              rows={3}
              placeholder={placeholder}
              className="w-full bg-transparent border-none outline-none resize-none text-xl font-bold text-black placeholder:text-black/30 leading-snug"
            />
            <button
              type="button"
              aria-label="Random prompt"
              className="absolute bottom-4 right-4 h-10 w-10 rounded-full bg-white/45 flex items-center justify-center text-lg shadow-[inset_0_2px_4px_rgba(255,255,255,0.9),0_6px_14px_rgba(0,0,0,0.12)] transition-transform hover:scale-110 hover:rotate-12 active:scale-90"
            >
              🎲
            </button>
          </div>
        </div>

        {/* Trust Sub-label */}
        <div className="my-3.5 text-sm font-semibold text-white/95 flex items-center gap-1.5 drop-shadow-sm">
          <span>🔒</span>
          <span>anonymous &amp; happy vibes</span>
        </div>

        {/* Volumetric Black Pill Submit */}
        <button
          type="button"
          className="w-full h-[60px] rounded-full bg-black text-white text-lg font-extrabold tracking-tight shadow-[inset_0_3px_6px_rgba(255,255,255,0.3),0_12px_24px_-4px_rgba(0,0,0,0.38)] transition-transform hover:scale-[1.02] active:scale-95 cursor-pointer"
        >
          {ctaText}
        </button>
      </div>

      {/* Bottom Social Proof + Pulsing Secondary Pill */}
      <div className="w-full max-w-[400px] flex flex-col items-center gap-3.5 z-10 mt-8">
        <p className="text-base font-extrabold text-white text-center drop-shadow-sm">
          👇 {friendsCount} friends just tapped the button 👇
        </p>
        <button
          type="button"
          className="w-full h-[60px] rounded-full bg-black text-white text-lg font-extrabold shadow-[inset_0_3px_6px_rgba(255,255,255,0.3),0_12px_24px_-4px_rgba(0,0,0,0.38)] animate-[ngl-wobble-shake_2.2s_ease-in-out_infinite] cursor-pointer"
        >
          Get your own messages!
        </button>
      </div>
    </div>
  );
}
```
