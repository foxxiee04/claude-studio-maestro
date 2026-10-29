# Design brief - <Project>

Chosen direction: <A/B/C name> (+ mixes). Options page: design/template-options.html
References: <links>

## Tokens
| Token | Value | Use |
|---|---|---|
| --bg | #... | page background |
| --surface | #... | cards, sheets |
| --surface-2 | #... | raised / hover |
| --text | #... | body + headings |
| --muted | #... | secondary text |
| --accent | #... | CTA, highlights (sparingly) |
| --line | rgb(... / 0.08) | hairline borders |
| --radius | ...px | cards; buttons ...px |
| --shadow-soft | 0 20px 60px -20px rgb(... / 0.15) | raised cards |

## Typography
- Display: <font>, weights <..>; Body: <font>, weights <..> (load with next/font or @fontsource)
- Scale: hero clamp(48px, 7vw, 96px) / h2 clamp(32px, 4vw, 56px) / h3 24px / body 17px / small 14px
- Display tracking -0.02em, line-height 1.02-1.1; body line-height 1.6, max 65ch

## Layout
- Container max-width ..px, side padding 24px (16px mobile); section padding ..px desktop / ..px mobile
- Grid / breakpoints: ...

## Sections (main page)
For each section:
### <n>. <Section name>
- Content: <copy, images, data>
- Layout: <desktop> / <mobile>
- Motion: <recipe id from premium-motion> - trigger <load|in-view|scroll|hover>, duration .., easing .., stagger ..
- Icons: <itshover icon names, trigger>

## Motion system
- Library: `motion` (import from "motion/react"); smooth scroll: lenis (yes/no)
- Easings: entrance cubic-bezier(0.22, 1, 0.36, 1); exit cubic-bezier(0.64, 0, 0.78, 0); spring { stiffness 300, damping 30 }
- Durations: micro 0.2-0.3s, reveal 0.6-0.9s, hero sequence <= 1.6s total
- Reduced motion: MotionConfig reducedMotion="user"; parallax and marquee off, reveals become fades

## Imagery & assets
- <photo direction, product shots, textures, where assets come from>

## Quality budget
- LCP < 2.5s, CLS < 0.1, no layout-thrashing animations (transform/opacity only)
- Contrast AA, focus states visible, keyboard reachable
