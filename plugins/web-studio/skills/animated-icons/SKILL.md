---
name: animated-icons
description: Animated (motion) icons for React/Next.js projects using itshover (itshover.com, built on motion/react, installed through the shadcn registry). Use when a UI needs icons that animate on hover/click/state - buttons, nav, feature cards, empty states - or when choosing an icon set for a premium site.
---

# Animated icons (itshover)

Source: https://www.itshover.com/icons - React components animated with `motion/react`, editable source copied into
your project (shadcn-style). Repo: https://github.com/itshover/itshover.
License: repo metadata says Apache-2.0 but its README also says "MIT" (not verified as of 2026-10-22). Both allow
commercial use, but tell the user to confirm the LICENSE file before a commercial launch.

## Install

1. Find the icon name on the site (slugs end in `-icon`, e.g. `heart-icon`).
2. Install with the shadcn CLI (needs `components.json`; run `npx shadcn@latest init` first if missing):
   ```bash
   npx shadcn@latest add https://itshover.com/r/heart-icon.json
   ```
   This adds `icons/heart-icon.tsx` + shared `icons/types.ts` and installs `motion`.
   Several at once: list several URLs in one `add` command.
3. Manual alternative: `npm i motion`, copy the component and `types.ts` from the repo's `icons/` folder.

In Maestro plans, icon installs go in the **setup** job (they touch package.json and shared `icons/types.ts`).

## Use

```tsx
import HeartIcon from "@/icons/heart-icon";

<HeartIcon className="size-5" />   // animates on its own hover
```

Each icon is a `forwardRef` component exposing an imperative handle with `startAnimation()` / `stopAnimation()`
(types `AnimatedIconHandle`, `AnimatedIconProps` in `icons/types.ts`). Use it to animate the icon when the **whole
button/card** is hovered, which feels more premium than hovering the tiny icon:

```tsx
"use client";
import { useRef } from "react";
import SendIcon from "@/icons/send-icon";
import type { AnimatedIconHandle } from "@/icons/types";

export function SendButton() {
  const icon = useRef<AnimatedIconHandle>(null);
  return (
    <button
      onMouseEnter={() => icon.current?.startAnimation()}
      onMouseLeave={() => icon.current?.stopAnimation()}
      onFocus={() => icon.current?.startAnimation()}
      onBlur={() => icon.current?.stopAnimation()}
      className="inline-flex items-center gap-2 rounded-full px-5 py-2.5"
    >
      Gửi <SendIcon ref={icon} className="size-4" aria-hidden />
    </button>
  );
}
```
Check the generated file for the exact prop names (size, strokeWidth, easing) before relying on them - read `icons/types.ts`.

## Style rules (premium look)

- One icon family per site; same stroke width everywhere (match the body text weight). Color via `currentColor`.
- Sizes: 16px inline, 20px buttons/nav, 24-32px feature cards. Keep optical alignment with text (`size-[1.1em]`).
- Animate on intent only (hover/focus/press/state change), never on loop - except a single "live" indicator.
- Decorative icons: `aria-hidden`; icon-only buttons need `aria-label`.
- Reduced motion: `MotionConfig reducedMotion="user"` (from `premium-motion` setup) disables the transform parts.
- Static fallback for icons itshover lacks: `lucide-react` with the same stroke width; wrap in `motion.span` with a
  `whileHover` micro-animation (scale 1.1 / rotate 8deg, 0.25s) if it needs motion.
