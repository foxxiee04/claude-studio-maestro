---
name: ui-template-picker
description: First step of any UI work (new website, landing page, web app screens, dashboard, or a redesign) - before writing or delegating UI code. Crawls the user's saved template sites (GetLayers, HorizonX, Webild, ui.live, RudraByte, Prompt Motion) into a catalog, filters it to the project and the user's taste (modern, bright, luxurious, rich motion), shows a card gallery from many sites for the user to pick from, turns the picks into 3 design directions with live motion previews, then writes design-brief.md that drives implementation.
---

# UI template picker

The user wants to **choose the look before anything is built**. Do not start UI implementation
(or delegate it to opencode) until the user has picked a direction and `design-brief.md` exists.
Skip only for tiny UI tweaks inside an existing design system, or when the user says to.

Files in this skill:
- `references/style-profile.md` - the user's default taste (bright, modern, luxury, refined motion) + anti-patterns.
- `references/toolbox.md` - the sources the user collected (GetLayers, HorizonX, Webild, ui.live, Motion, prompt-motion,
  itshover, Bklit, video-shotcraft, awesome-llm-apps, tunnels) with what each is good for, cost and license notes.
- `scout/scout.mjs` - crawler + catalog (`scout/catalog.json`, thumbnails in `scout/thumbs/`) + gallery builder.
- `assets/gallery.html` - card gallery template (filled by `scout.mjs gallery`).
- `assets/options.html` - reusable comparison page for the 3 directions. You only replace the DATA block.
- `assets/design-brief-template.md` - output format.

## Workflow

### 1. Brief (one round max)
Collect: product + audience, pages/sections needed, brand assets (logo, colors, fonts, photos), must-haves, deadline/budget
for paid sources. Read the repo first (existing stack, tailwind config, components). Ask only what is missing, in one
AskUserQuestion. Taste defaults come from `style-profile.md` - do not ask about them again.

### 2. Template gallery from the user's sources (real cards, the user picks)
The scout crawls the user's saved sites into a catalog with thumbnails, brightness and color:
GetLayers (templates, sections, 3D scenes, gradients), HorizonX (~300 templates/heroes/kits + tools), Webild (industry
templates), ui.live (community designs), RudraByte (real client sites), Prompt Motion (~240 motion videos with prompts).
`SCOUT` = `node "$WEB_STUDIO/skills/ui-template-picker/scout/scout.mjs"`.

1. Freshness: `SCOUT stats`. If `updatedAt` is older than 14 days or a source shows `ok: false`, refresh:
   `SCOUT update` (several minutes; run it with run_in_terminal so it is not cut off, or `--sources x,y` for a few).
2. Shortlist for this project: `SCOUT list --theme light,mid --q "<keywords>"` (keywords from the brief: industry, mood,
   section type). Read titles/categories and decide filters; keep 40-120 candidates across several sources. Add
   `--category hero,section` when the user needs pieces rather than whole sites.
3. Build the gallery into the project: `SCOUT gallery --out design/template-gallery.html --theme light,mid --q "..."
   --title "<Project> - chọn mẫu" --note "<1 line: what to look for>"` (or `--ids a,b,c` for a hand-picked set).
   Show it: serve the folder with a static server + preview tools, or `SendUserFile` with `display: "render"`.
   The page has filters (source, sáng/tối, loại, giá, search) and multi-select; "Copy lựa chọn" gives the user a list
   to paste back.
4. When the user pastes the selection: open each chosen `url` in the built-in browser (screenshot + page text) to study
   layout, type, color, motion. Paid items (GetLayers Premium, HorizonX) only show previews publicly; if the user wants the
   real prompt/code, ask them to sign in themselves in the built-in browser - never type their password.
5. Also check `SCOUT list --category motion --q "<mood>"` for Prompt Motion references when choosing the motion style.
Never buy, sign up or accept terms on these sites. Recreate looks in the project's own code; do not paste paid code.

### 3. Compose 3 directions (from the user's picks)
Base the directions on the cards the user selected (mix them when the picks differ), not on generic ideas.
Three clearly different directions, not three shades of one. Each needs:
- name + one-line mood
- palette: `bg, surface, text, muted, accent` (hex)
- fonts: display + body (Google Fonts names, so the preview can load them)
- radius
- 3-4 signature motions, using the demo ids the preview supports:
  `mask-reveal, stagger-up, blur-in, scale-in, float, gradient-drift, marquee, hover-lift`
  (map them to recipes in the `premium-motion` skill)
- section outline for the main page
- 1-3 reference links (template or page that inspired it)
- icon approach (usually itshover, see `animated-icons`), effort S/M/L, cost (free / paid source / recreated)

### 4. Show the options page
1. Copy `assets/options.html` into the project at `design/template-options.html` (create `design/`).
   If there is no project folder yet, use the session folder.
2. Replace only the block between `/* ===== DATA` and `END DATA ===== */`: `PROJECT` (name, tagline, eyebrow) and `OPTIONS`.
   Write the text in Vietnamese.
3. Show it: open it with the preview/browser tools (serve the folder with a static server if `file://` is refused)
   and/or `SendUserFile` with `display: "render"`. Take a screenshot to check that fonts loaded and nothing is clipped.
4. Ask the user to choose with AskUserQuestion: A / B / C, plus "Other" for mixes ("A + motion của C").
   Put a short spec (palette, fonts, motions) in each option's `preview`.

### 5. Write design-brief.md
From `assets/design-brief-template.md`, save to `design/design-brief.md` in the project. It must be concrete enough
that an opencode job can implement a section without asking: tokens, type scale, layout per section,
motion spec per section (recipe id + duration/easing/trigger), icons, image direction, references, a11y/perf budget.

### 6. Hand off to implementation (Maestro)
Typical job split:
1. **Setup** (single job): fonts, tokens into tailwind/globals.css, `motion` + `lenis` install, `MotionConfig reducedMotion="user"`,
   shared motion primitives (`components/motion/*` from `premium-motion` recipes), icon setup.
2. **Sections** (parallel wave, one job per section, disjoint scopes): each brief quotes its part of design-brief.md.
3. **Integration**: page assembly, nav, responsive pass.
Then verify in the browser against the chosen option (desktop + mobile screenshots, reduced motion, Lighthouse/`core-web-vitals`).

## Rules
- Free sources first; mark paid ones clearly. Recreate the look in the project's own code - do not paste
  paid/licensed code into a repo unless the user owns a license for it.
- Respect the anti-patterns in `style-profile.md`.
- Related skills: `frontend-design` (aesthetic reasoning), `premium-motion` (motion spec + code), `animated-icons`,
  `motion` (Motion docs/API), `shadcn`, `3d-web-experience` (3D hero), `web-design-guidelines` (review).
