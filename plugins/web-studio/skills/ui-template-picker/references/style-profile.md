# User style profile (default taste - override only when the project or user says so)

**Wants:** modern, bright/light, luxurious, "premium brand" feel, with refined, rich motion.
**Does not want:** generic template look, dark neon, purple-gradient "AI startup" look, effects for their own sake.

## Visual defaults

- Background: light and warm or cool neutrals - ivory, porcelain, pearl, stone-50. Never pure #FFFFFF everywhere: use
  2-3 close neutrals (page / surface / raised) for depth.
- Text: deep ink, not pure black (e.g. #14110F, #1C1917, #0F172A). Muted text ~ 55-60% contrast steps.
- One accent, used sparingly: champagne gold, deep sage, ink blue, terracotta or a brand color. Accent is for CTA,
  small highlights, active states - not big fills.
- Typography: a characterful display face + a quiet sans.
  Good pairs (Google Fonts): Fraunces + Inter · Instrument Serif + Inter · Playfair Display + Manrope ·
  Cormorant Garamond + Geist · DM Serif Display + DM Sans · (all-sans) Satoshi-like: Manrope / Plus Jakarta Sans + Inter.
  Big display sizes (clamp 48-96px hero), tight tracking on display (-0.02em), generous line-height on body (1.6).
- Space: generous. Section padding 96-160px desktop. Max text width ~ 65ch. Fewer, larger elements.
- Shape: radius 12-20px on cards, pill CTAs or 10-12px buttons; hairline borders (1px, 6-10% ink) instead of heavy shadows.
- Shadows: soft and large, low opacity (e.g. 0 20px 60px -20px rgb(20 17 15 / 0.15)).
- Glass: only subtle (backdrop-blur 12-20px, white 60-70%), mainly for nav and floating chips.
- Imagery: large, high quality, consistent color grading; product shots on soft gradients; grain/noise texture at 2-4% is ok.

## Motion defaults (details in the `premium-motion` skill)

- Calm and expensive: slower and smoother than default UI (500-900ms for reveals, 200-300ms for hovers).
- Easing: soft expo-out `cubic-bezier(0.22, 1, 0.36, 1)` for entrances; springs with no visible bounce for interaction.
- Signature moments: one hero entrance choreography, text mask reveals, staggered scroll reveals, gentle parallax
  on imagery, hover lift on cards, magnetic CTA, smooth scroll.
- Everything respects `prefers-reduced-motion`.
