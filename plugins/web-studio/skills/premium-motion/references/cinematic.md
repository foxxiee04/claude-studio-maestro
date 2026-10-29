# Cinematic motion level ("hiệu ứng điện ảnh")

The default premium-motion level is calm (reveals, parallax, hover, counters). The cinematic level is for heroes and
landing pages that should feel like MotionSites / HorizonX heroes: moving video or 3D backgrounds, pinned scroll stories,
split-text reveals, cursor-reactive light. Use it when the user asks for "hiệu ứng xịn", "như motionsites", a 3D hero,
or picks a cinematic template. Keep admin/app screens on the calm level.

## What actually makes these sites look "xịn" (studied 2026-10-28)
Frame-by-frame look at MotionSites "NOVA Space Systems" (9.2 s preview, 132 frames): the hero is a **video loop**
(capsule separating from the rocket over Earth), the two cards below are **video loops** too (launch smoke growing,
a launch trail drawing an arc across the night sky), and the type is static: a giant bold "ROCKETS" across the
width, a staggered two-line "ROCKET / SCIENCE", small editorial body text on black. The wow comes from good moving
footage inside a calm, typographic layout - not from complex code.
So the cinematic level starts with a **media plan**: list the 3-6 clips the page needs (hero loop, 2-4 card loops),
each 6-10 s, seamless loop, matching the palette. Sources, in order:
1. free stock video (Pexels, Mixkit, Coverr - check each clip's license, prefer "free to use, no attribution");
2. AI-generated clips with the user's installed skills `kling-ai` / `runway-api` (text-to-video or image-to-video from a
   project photo). These spend the user's credits: list clip prompts + estimated cost and ask before generating;
3. still photos with slow Ken Burns zoom/pan as the zero-cost fallback.
Then encode: H.264 mp4 + VP9/AV1 webm, 720-1080p, no audio, <= 2-4 MB each (`ffmpeg -an -vf scale=-2:1080 -c:v libx264
-crf 26 -preset slow -movflags +faststart`), poster = first frame as webp.

## Building blocks
| Effect | How | Notes |
|---|---|---|
| Video background hero | `<video autoPlay muted loop playsInline poster>` + dark/light gradient overlay for text contrast | 8-12 s loop, 1080p, H.264 mp4 + webm, <= 4 MB; poster image = LCP; reduced motion or Save-Data -> poster only. Free sources: Pexels / Coverr / Mixkit (check each video's license); MotionSites "Backgrounds" are paid. |
| 3D / WebGL scene | three.js + `@react-three/fiber` + `@react-three/drei`, loaded with `next/dynamic(..., { ssr: false })` | DPR capped `[1, 1.5]`, pause when off-screen (`frameloop="demand"` or IntersectionObserver), static image fallback on mobile/low-power. See skill `3d-web-experience`. |
| Shader gradient / noise | small fragment shader on a full-screen plane (R3F) or CSS animated gradients + SVG grain overlay | Animate uniforms with time; keep < 1 ms per frame. |
| Pinned scroll story | GSAP `ScrollTrigger` (pin + scrub) with `useGSAP` in React; Lenis drives scroll (`lenis.on("scroll", ScrollTrigger.update)`, `gsap.ticker.add(t => lenis.raf(t * 1000))`, `gsap.ticker.lagSmoothing(0)`) | See skills `gsap-scrolltrigger`, `gsap-react`, `gsap-timeline`. GSAP and its plugins are free to use. |
| Split-text reveal | GSAP `SplitText` (lines/words/chars, `mask: "lines"`) or the free `mask-lines` recipe for short headlines | Keep the H1 readable for SEO/a11y (aria-label on the parent). |
| Cursor light / spotlight | pointer position -> CSS variables `--x --y` on the hero -> `radial-gradient` layer; magnetic buttons | mouse only; off for reduced motion. |
| Scroll-scrubbed video (Apple style) | GSAP ScrollTrigger `scrub` mapping progress to `video.currentTime` (encode with a keyframe every frame: `-g 1`), or an image sequence drawn on `<canvas>` | image sequences are smoother but heavier: 60-120 webp frames, preload progressively. |
| Horizontal scroll gallery | pinned section translating a track with ScrollTrigger scrub | mobile: native horizontal swipe instead. |
| Number / marquee / logo walls | existing recipes (`counter`, `marquee`) | |

## Performance and accessibility budget
- The headline text must be in the HTML and visible within ~1 s (LCP): never wait for 3D/video to show text.
- Heavy layers (3D, video, shaders) load after first paint and only on capable devices; provide a poster/image fallback.
- One heavy effect per viewport. Pause everything off-screen. Respect `prefers-reduced-motion` everywhere.
- Test on a mid-range phone width (375 px) and with CPU throttling in DevTools.

## Handing it to opencode (it cannot read files outside the project)
Copy what the job needs into `<project>/design/` before the job starts:
- the `gsap-scrolltrigger` skill (if installed: its SKILL.md) -> `design/ref-gsap-scrolltrigger.md`, same for `gsap-react`,
  `gsap-timeline`, and `3d-web-experience` when 3D is used;
- the chosen MotionSites prompt saved as `design/hero-prompt.md`: get it with the `motionsites` MCP tools (connected
  to the user's account), or as a fallback `node "$WEB_STUDIO/skills/ui-template-picker/scout/scout.mjs prompt <id>`
  (free prompts only); never sign in for the user;
- this file -> `design/ref-cinematic.md`.
Then one job per cinematic section (kind `hard`, timeout 2400 s) whose brief says: recreate the effect described in
`design/hero-prompt.md` with the project's tokens and content (do not copy brand names/assets from the prompt), follow
`design/ref-*.md`, respect the budget above, and add the needed packages (`gsap`, `@gsap/react`, three/R3F) itself.
