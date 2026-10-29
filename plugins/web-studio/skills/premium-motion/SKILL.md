---
name: premium-motion
description: Motion system for premium, bright, luxury-feel websites in React/Next.js with the `motion` library (motion/react) - motion tokens, choreography rules, and ready recipes (hero entrance, mask text reveal, staggered scroll reveal, parallax, magnetic button, hover lift, marquee, counters, smooth scroll with Lenis, page enter). Use when planning or implementing animations for a site/landing/web app, when writing the motion part of a design brief or an opencode brief, or when animation feels cheap, janky or inconsistent.
---

# Premium motion

Goal: motion that feels **calm, precise and expensive** - never bouncy, busy or random.
Code recipes live in `references/recipes.md` (copy them into the project's `components/motion/`).
For API details search the Motion docs (`motion` MCP / `motion` skill) instead of guessing.

## Tokens (use everywhere, never ad-hoc values)

| Token | Value |
|---|---|
| `EASE_OUT` (entrances) | `[0.22, 1, 0.36, 1]` - CSS `cubic-bezier(0.22, 1, 0.36, 1)` |
| `EASE_IN_OUT` (moves, page) | `[0.65, 0, 0.35, 1]` |
| `EASE_IN` (exits) | `[0.64, 0, 0.78, 0]` |
| micro (hover, press, icon) | 0.2-0.3s |
| base (UI state change) | 0.4s |
| reveal (scroll-in) | 0.7-0.9s, distance 16-32px |
| hero sequence | whole choreography <= 1.6s |
| stagger | 0.06-0.1s between items, max ~8 items staggered |
| spring (interactive) | `{ type: "spring", stiffness: 260, damping: 30 }` or `{ type: "spring", visualDuration: 0.4, bounce: 0 }` |

## Choreography rules

1. **One hero moment.** Order: eyebrow -> headline lines (mask reveal) -> subtext -> CTAs -> media (slow scale 1.04 -> 1).
2. **Scroll reveals happen once** (`viewport={{ once: true }}`), trigger a bit before the element is fully in view.
3. **Group, don't sprinkle.** Animate a section's group with one stagger, not every element separately.
4. **One ambient effect per viewport** at most (floating blob, gradient drift, marquee). Ambient = slow (6-30s loops).
5. **Hover = small and fast:** lift 4-6px, shadow deepen, image scale 1.03-1.05, icon animates. No color flashes.
6. **Direction is consistent:** content enters upward; exits are faster than entrances (~60-70%).
7. **Text stays readable:** never animate body copy letter by letter; split text only for short display headlines.

## Performance & accessibility (non-negotiable)

- Animate `transform` and `opacity` only (`x`, `y`, `scale`, `rotate`, `opacity`). Never width/height/top/left/margin.
  `filter: blur()` only on small elements or once on load.
- Wrap the app in `<MotionConfig reducedMotion="user">`; Lenis, parallax, marquee and ambient loops turn off when
  `useReducedMotion()` is true; reveals degrade to opacity.
- Initial states must not shift layout (use transforms, not margins) -> no CLS.
- The hero headline is often the LCP element: keep its reveal <= 0.9s and start it immediately (no delay > 0.15s).
- Many motion components on a page -> consider `LazyMotion` + `m` to cut bundle size.
- Audit after building: the `motion` skill's MotionScore audit, plus browser checks at mobile width and with
  reduced motion emulated.

## Recipe index (`references/recipes.md`)

| id | What | Options-page demo id |
|---|---|---|
| `setup` | motion tokens file, `MotionProvider` (MotionConfig) | - |
| `smooth-scroll` | Lenis driven by Motion's frame loop, off for reduced motion | - |
| `reveal` | fade-up on scroll into view | `stagger-up` |
| `stagger` | container + item variants with `delayChildren: stagger()` | `stagger-up` |
| `mask-lines` | headline lines rise from a mask | `mask-reveal` |
| `blur-in` | blur -> sharp entrance for hero media/text | `blur-in` |
| `scale-in` | media settles from 0.94/1.04 | `scale-in` |
| `parallax` | image drifts inside its frame on scroll | - |
| `hover-lift` | card lift + shadow (pure CSS/Tailwind) | `hover-lift` |
| `magnetic` | CTA follows the pointer slightly (mouse only) | - |
| `marquee` | infinite logo/text strip, edge fade, pause on hover | `marquee` |
| `counter` | number counts up when in view | - |
| `scroll-progress` | thin progress bar | - |
| `page-enter` | Next.js `app/template.tsx` page fade-up | - |
| `ambient` | floating blob / gradient drift (CSS) | `float`, `gradient-drift` |
| `layout-expand` | card expands to detail with `layoutId` | - |

More ideas: prompt-motion.com (motion prompts), examples.motion.dev (free examples, MotionScore graded),
Motion+ (paid: Motion UI "Editorial stagger hero", "Stagger reveal" - only if the user has a license),
GSAP skills for pinned/scrubbed scroll stories, `3d-web-experience` for WebGL heroes.

## Writing the motion part of an opencode brief

Name the recipe ids, the exact element, trigger and tokens, e.g.:
"Hero: `mask-lines` on h1 (2 lines, EASE_OUT, 0.9s, line stagger 0.08), then `reveal` on subtext (delay 0.35) and
CTAs (0.45); hero image `scale-in` 1.04->1 over 1.2s. Use components from `components/motion/` (created by the setup job).
Reduced motion: opacity only." Tell opencode it can search the Motion docs MCP.
