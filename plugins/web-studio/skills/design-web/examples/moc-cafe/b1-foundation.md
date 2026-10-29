# W1 foundation: theme tokens, fonts, providers, motion primitives

## Goal
Set up the visual foundation of the Mộc Café UI so every later job only builds pages. Read `design/design-brief.md`
first (sections Tokens, Typography, Motion) - it is the spec. Read `AGENTS.md` (Next.js 16 notes).

## Scope
Create/edit only: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/providers.tsx`,
`src/components/motion/` (new files), `src/lib/format.ts`.
Do NOT touch: `src/components/ui/*` (shadcn + icons), `src/lib/utils.ts`, `src/lib/types.ts`, `src/lib/mock/`
(another job writes those right now), `src/app/page.tsx`, `package.json`.

## Steps
1. `src/app/globals.css`: keep the existing imports and the `@theme inline` block structure; replace the `:root` values
   with the tokens table from the design brief (hex values are fine). Delete the `.dark { ... }` block (light only).
   In `@theme inline` set `--font-sans: var(--font-be-vietnam);`, `--font-heading: var(--font-be-vietnam);` and add
   `--font-hand: var(--font-patrick-hand);` so `font-hand` works. Add `@import "lenis/dist/lenis.css";` after the other imports.
   Add the extra tokens (`--caramel`, `--cream-deep`, `--shadow-soft`, `--shadow-pill`) to `:root`, and Tailwind v4
   utilities: `@utility shadow-soft { box-shadow: var(--shadow-soft); }`, `@utility shadow-pill { box-shadow: var(--shadow-pill); }`.
   Add marquee CSS from `design/motion-recipes.md` (section marquee) and the `body` base: `bg-background text-foreground`,
   `::selection` caramel tint.
2. `src/app/layout.tsx`: fonts with `next/font/google`: `Be_Vietnam_Pro` (weights 400,500,600,700, subsets
   ["vietnamese","latin"], variable `--font-be-vietnam`) and `Patrick_Hand` (weight 400, subsets ["vietnamese","latin"],
   variable `--font-patrick-hand`). Remove Geist. `<html lang="vi">`, metadata title "Mộc Café — Cà phê rang mộc",
   description "Cà phê rang mộc mỗi sáng, bánh nướng tại quầy và một góc yên để ngồi thật lâu.". Body classes:
   `min-h-full bg-background text-foreground font-sans antialiased`. Wrap children in `<Providers>`.
3. `src/components/providers.tsx` ("use client"): `MotionProvider` (from motion folder) > shadcn `TooltipProvider` >
   children, plus shadcn `Toaster` from `@/components/ui/sonner` (position "top-center", richColors off).
4. `src/components/motion/`: create files exactly as in `design/motion-recipes.md`: `tokens.ts`, `motion-provider.tsx`,
   `smooth-scroll.tsx`, `reveal.tsx`, `stagger.tsx`, `mask-lines.tsx`, `parallax-image.tsx` (use `next/image` with `fill`
   inside the motion wrapper, prop `sizes`), `magnetic.tsx`, `counter.tsx` (support optional `prefix`/`suffix` props and a
   `decimals` prop), `scroll-progress.tsx`. Also `float.tsx`: `<Float delay={0} amplitude={8} duration={6.5}>` that loops
   `y: [0, -amplitude, 0]` with easeInOut, disabled when `useReducedMotion()`. And `index.ts` re-exporting everything.
   All client components ("use client").
5. `src/lib/format.ts`: `formatVND(n)` -> "120.000 ₫" (Intl vi-VN, no decimals), `formatNumber(n)`, `formatDate(iso)`
   -> "28/10/2026", `formatDateLong(iso)` -> "Thứ Ba, 28 tháng 10, 2026", `formatTime(iso)` -> "08:45",
   `formatRelative(iso, now = "2026-10-28T10:00:00+07:00")` -> "5 phút trước" / "2 giờ trước" / "Hôm qua",
   `initials(name)` -> "MA" for "Nguyễn Minh Anh" (last two words). Use timeZone "Asia/Ho_Chi_Minh" in Intl calls.

## Acceptance checks (run them yourself)
- `pnpm exec tsc --noEmit` passes (ignore errors only if they come from files outside your scope that another job is
  writing at the same time; say so in the summary).
- `pnpm build` passes.
