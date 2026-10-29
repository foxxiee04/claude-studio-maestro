# Toolbox - sources the user collected (checked 2026-10-22)

The six template/motion sources below are crawled automatically by `scout/scout.mjs` (catalog of ~2,000 items on
2026-10-22: GetLayers 45, HorizonX 529, Webild 23, ui.live 1,317, RudraByte 13, Prompt Motion 125). Use
`scout.mjs list|gallery` instead of browsing them by hand; open individual pages only for the items the user picked.

Use this list first when looking for UI/motion references. Prices and licenses change: re-check before
recommending a paid source, and never buy, sign up or sign in for the user.

## UI templates & sections (main candidates for the picker)

| Source | What to take from it | Access | Fit for "bright, luxury, rich motion" |
|---|---|---|---|
| https://www.getlayers.ai/ | Copy-paste **prompts** that recreate cinematic sections (3D scenes, animated backgrounds, gradients) in Next.js/HTML/Vue. Has in-browser tweak of colors before copying, Figma plugin, MCP. | Some free layers; paid plans give commercial license | High - best source of hero/background ideas; pick light variants |
| https://horizonx.so/ | UI kits, web templates, WebGL heroes (particles, tunnels, plasma orb), liquid-glass Figma kit, shaders, textures, mockups. Code export (.zip) and Figma (.fig). Has MCP. | Paid only: $24.99-$99.99/mo, commercial license | High for hero/3D wow-moments; many are dark - check light versions |
| https://motionsites.ai/ | ~120 cinematic AI-website prompts (heroes, landing pages, footers, features, video backgrounds, 3D). Cards marked "Copy prompt" are free; "Unlock prompt" = paid. **The user connected the MotionSites MCP (server `motionsites`, OAuth, 2026-10-28): use its tools first to search items and read prompts** (premium ones too if their plan allows). The scout's clipboard capture only stored 4 of 64 free prompts (`scout.mjs prompt <id>`), so treat it as a fallback. | Free prompts + paid plan | High for "hiệu ứng điện ảnh" heroes; many are dark - pick light ones or restyle |
| https://www.webild.io/ | AI website builder (prompt -> full multi-section site, visual editor, 3D/animation leaning). Third-party reviews only; product page is JS-rendered. | Unknown pricing | Medium - use for section/layout ideas, not as code source |
| https://ui.live/ | Community design feed with leaderboard/trending. | Free to browse | Inspiration only (layouts, typography, color) |
| https://www.rudrabyte.site/projects | Agency portfolio of 13 real Next.js + Tailwind business sites. | Free to browse | Low - reference for ordinary business-site structure |
| https://manus.im/ | General AI agent that can generate a website/slides quickly. | Account needed | Low - throwaway prototypes, not a code source for the repo |

Well-known free React section libraries that fit the same stack (not from the user's list - verify license per component):
- Magic UI - https://magicui.design (shadcn-style animated components)
- Aceternity UI - https://ui.aceternity.com (hero/background effects, many dark - choose light ones)
- React Bits - https://reactbits.dev (text/background animations)

## Motion

| Source | Use |
|---|---|
| https://motion.dev/ | THE animation library: package `motion`, import from `motion/react`. Free/open source. Motion+ (paid) adds Motion UI components, examples, Motion Studio. Docs searchable through the `motion` MCP (Claude and opencode both have it) and the `motion` skill. |
| https://prompt-motion.com/ | Gallery of motion videos made with Claude, each with its prompt/skill. Use for motion ideas and prompt wording. |
| GSAP skills (installed) | `gsap-scrolltrigger`, `gsap-timeline` - use when a scroll story needs pinning/scrub timelines beyond motion's `useScroll`. |
| `3d-web-experience` skill | Three.js / R3F / Spline when a 3D hero is chosen. |

## Icons

| Source | Use |
|---|---|
| https://www.itshover.com/icons | Animated React icons built on `motion/react`; shadcn registry install. See the `animated-icons` skill. |

## Charts / dashboards

| Source | Use |
|---|---|
| https://bklit.com/ | Bklit UI: 180+ chart components (area, bar, sankey, funnel, gauge, candlestick...), Studio, blocks. Open source. Use when a page shows data. Also see the `dataviz` skill. |

## Video / promo

| Source | Use |
|---|---|
| https://github.com/Vincentwei1021/video-shotcraft | Claude Code skill that makes a cinematic product promo video with Remotion from real screenshots (124+ shot recipes, beat sync, MP4 1920x1080). Install: `npx skills add Vincentwei1021/video-shotcraft`. Needs Node, ffmpeg, uv. Apache-2.0. |

## AI app references

| Source | Use |
|---|---|
| https://github.com/shubhamsaboo/awesome-llm-apps | 100+ runnable AI agents / RAG / MCP / voice / generative-UI examples (Apache-2.0). Look here when a project needs an AI feature; copy patterns, not whole apps. |

## Share a local build (demo, webhook, phone test)

- Cloudflare quick tunnel (no account): `cloudflared tunnel --url http://localhost:3000` -> random `*.trycloudflare.com` URL.
  Fixed URL needs a domain on Cloudflare + named tunnel.
- tunnl.gg (SSH only, nothing to install): `ssh -t -R 80:localhost:3000 proxy.tunnl.gg`. Free: random subdomain, 2h idle / 24h max.
- Real hosting: Vercel / Cloudflare Pages / Netlify. Tunnels are for demos only.
