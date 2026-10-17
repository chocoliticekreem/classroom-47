# Volumetric, Fluffy & 3D Style Guide

How to make any 2D UI or 3D scene feel **fluffy, puffy, volumetric, and cheerful** in the NGL universe.

---

## 1. The Anatomy of "Fluffy Volumetric" in 2D CSS

Flat UI looks cold because surfaces have uniform brightness and single dark drop shadows. **Volumetric puffy UI** simulates a soft, rounded 3D cushion lit from above:

1. **Curvature Rim (`inset 0 4px 8px rgba(255, 255, 255, 0.9)`)**: A bright white inner top highlight makes the top edge look curved toward the sky.
2. **Subsurface Bounce (`inset 0 -6px 12px rgba(236, 17, 135, 0.15)`)**: Instead of dirty gray/black inner shadows, use **pink, peach, or violet** inner bottom shadows so light appears to scatter *inside* the marshmallow surface.
3. **Colored Ambient Shadow (`0 18px 36px -8px rgba(180, 10, 90, 0.32)`)**: Cast shadows carry the hue of the background gradient rather than pure black.
4. **Super-Rounded Geometry**:
   - Small badges & chips: `border-radius: 9999px`
   - Cards & modals: `border-radius: 28px` to `36px`
   - Avatars & icon buttons: `border-radius: 9999px` or `22px` squircles.

### Puffy Clay Badge / Floating Pill Helper

```css
.ngl-puffy-pill {
  background: linear-gradient(180deg, #FFFFFF 0%, #FFF0F6 100%);
  border-radius: 9999px;
  padding: 10px 22px;
  font-weight: 800;
  color: #111111;
  box-shadow:
    inset 0 4px 6px rgba(255, 255, 255, 1),
    inset 0 -4px 8px rgba(236, 17, 135, 0.18),
    0 10px 22px -4px rgba(236, 17, 135, 0.28);
}
```

---

## 2. Fluffy Clouds & Color-Dodge Glow Layers

On NGL's confirmation and celebration screens (`#sent-boost-success`), fluffy clouds sit at the top of the viewport using `mix-blend-mode: color-dodge` or `overlay` so the warm pink/orange gradient shines right through them.

### Pure CSS Fluffy Cloud / Glow Backdrop

```css
.ngl-cloud-band {
  position: absolute;
  inset: -40px 0 auto 0;
  height: 260px;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 30%, rgba(255, 255, 255, 0.65) 0%, transparent 55%),
    radial-gradient(circle at 50% 15%, rgba(255, 230, 245, 0.75) 0%, transparent 60%),
    radial-gradient(circle at 82% 35%, rgba(255, 210, 180, 0.65) 0%, transparent 55%);
  filter: blur(20px);
  mix-blend-mode: overlay;
}
```

---

## 3. Happy Spring Physics & Entrance Stagger

Animations should feel **bouncy, weightless, and polite**:
- **Hover / Tap**: Use an overshoot spring curve `cubic-bezier(0.34, 1.56, 0.64, 1)` so elements puff up slightly before settling.
- **Staggered Entrance (`boost-rise`)**: Rise `12px` with `opacity: 0 → 1` over `420ms cubic-bezier(0.22, 1, 0.36, 1)`.
- **Respect Reduced Motion**: Wrap continuous wobbles and entrance rises in `@media (prefers-reduced-motion: no-preference)`.

---

## 4. Translating NGL Fluffy Volumetric to Three.js / React Three Fiber

When pairing this skill with 3D scenes (e.g., alongside `threejs-world-speedrun`), apply the NGL Fluffy Volumetric look to both the **3D meshes** and the **HTML HUD**:

### A. 3D Geometry & Materials (Puffy Toy Aesthetic)
- **No sharp boxes**: Use `<RoundedBox radius={0.25} smoothness={4}>` from `@react-three/drei`, spheres, capsules, and toruses.
- **Warm Subsurface / Matte Clay Materials**:
  - Avoid cold metallic/mirror PBR (`metalness: 0`, `roughness: 0.65` to `0.85`).
  - Add a subtle warm emissive tint (`emissive="#ff4079"`, `emissiveIntensity={0.12}`) so shadows never turn muddy gray or dead black.
- **Candy Sky & Lighting**:
  - Use a warm pink/orange/violet gradient sky dome (`#EC1187` zenith blending into `#FF8D10` horizon, or dreamy pastel `#FFB8E0 → #FFF0D0`).
  - Pair a warm key `directionalLight` (`#FFF5EB`) with a pink/violet `hemisphereLight` (`skyColor="#FF9CE3"`, `groundColor="#FF8D10"`, `intensity={0.9}`).

### B. 3D Floating Bubbles & HUD Overlays
- Render in-world callouts with `@react-three/drei`'s `<Html center distanceFactor={15}>` using the `.ngl-bubble` or `.ngl-puffy-pill` classes.
- Give 3D collectibles, avatars, or icons a gentle bobbing + tilted floating motion:
  ```tsx
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    ref.current.position.y = baseY + Math.sin(t * 2.2) * 0.15;
    ref.current.rotation.z = -0.1 + Math.sin(t * 1.5) * 0.05;
  });
  ```
