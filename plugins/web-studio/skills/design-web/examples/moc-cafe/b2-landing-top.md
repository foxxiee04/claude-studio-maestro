# W2 landing (top half): header, hero, marquee, story, menu

## Goal
Build the first half of the Mộc Café landing page in the chosen "Kem Espresso" style: cream background, dark espresso
pill buttons with soft shadow, handwritten wordmark, floating drink cards, cursor trail, filterable menu.
Spec: `design/design-brief.md` (Landing sections 1-5, Tokens, Typography, Motion). Data: `@/lib/mock`
(`menuItems`, `categories`, `storyStats`), helpers `@/lib/format`, motion primitives `@/components/motion`
(Reveal, StaggerGroup/StaggerItem, ParallaxImage, Magnetic, Counter, Float, SmoothScroll, tokens). Read `AGENTS.md`.

## Scope
Create/edit only: `src/components/landing/site-header.tsx`, `hero.tsx`, `cursor-trail.tsx`, `marquee-strip.tsx`,
`story.tsx`, `menu-section.tsx`, and `src/app/page.tsx`.
Do NOT touch anything else (other jobs build the rest of the landing and the admin area in parallel).

## Build
- `site-header.tsx`, `hero.tsx`, `marquee-strip.tsx`, `story.tsx`, `menu-section.tsx` as described in the design brief
  (Landing sections 1-5). Content is Vietnamese. Section ids: `thuc-don`, `cau-chuyen` (and nav links to `#khong-gian`,
  `#dat-ban` which another job creates).
- Hero details: wordmark "Mộc Café" in `font-hand` across the container, color #2A1A13; paragraph right-aligned on
  desktop (left on mobile), max-w 30ch; CTAs: "Đặt bàn" (`#dat-ban`, primary pill + `shadow-pill`, wrapped in `Magnetic`)
  and "Xem thực đơn" (`#thuc-don`, white pill). Photo block: `next/image` `/images/hero-interior.webp`, `priority`,
  rounded-[28px], aspect 16/9 on desktop, 4/5 on mobile. Floating cards: white card p-2 rounded-2xl shadow-soft with a
  square image (rounded-xl) + font-hand label under it; left card overlaps the photo's left edge near the top, right card
  overlaps the right edge near the bottom; both inside `Float` with different delays; on mobile they shrink (w-28) and
  stay inside the viewport. Entrance: stagger (eyebrow, wordmark, paragraph, CTAs) then the photo scales 1.04 -> 1.
- `cursor-trail.tsx`: client; listens to pointermove on its parent (the hero section), renders 7 small dots
  (6-10px, caramel #C08A5B, decreasing opacity) that follow with springs; only for `pointerType === "mouse"`,
  `pointer-events-none`, hidden when reduced motion.
- `menu-section.tsx`: client; chips "Tất cả" + each category with counts; grid 1/2/3/4 columns; cards (image 4/3
  rounded-xl with hover zoom, name, 2-line description, price via `formatVND`, size chips for drinks, "Bán chạy" badge,
  "Hết hàng" overlay when `!isAvailable`); `motion` `layout` + `AnimatePresence` for filtering; hover-lift.
- `src/app/page.tsx` (server component): `<SmoothScroll>` wrapping `<main>` with SiteHeader, Hero, MarqueeStrip, Story,
  MenuSection - in that order. Leave a comment `{/* more sections are added by the integration job */}` at the end.

## Acceptance checks (run them yourself)
- `pnpm exec tsc --noEmit` and `pnpm build` pass.
- No horizontal overflow at 375px (keep floating cards inside the viewport; use overflow-x-clip on the hero section).
