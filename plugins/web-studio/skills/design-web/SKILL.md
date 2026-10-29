---
name: design-web
description: /design-web - build a web UI end to end the user's way. Shows a gallery of real templates crawled from the user's saved sources to pick from, turns the picks into 3 design directions with live motion to choose, scaffolds a Next.js + shadcn + motion project, gathers free photos, writes the design brief, has opencode build it in waves (landing, auth, admin/dashboard or app pages) with the user watching the job dashboard, verifies everything in the browser and hands over a running dev server. Use when the user types /design-web, or asks to build a website, landing page, dashboard or admin UI from scratch.
---

# /design-web

The user's arguments describe what to build (e.g. "landing + trang quản lý + admin dashboard cho quán cà phê").
Talk to the user in their language. **Claude plans, picks, verifies; opencode writes the code** (Maestro plugin, `maestro` command).
Worked example of a full run: `examples/moc-cafe/` (design brief, every job brief, batch plans, data check, options page).
Pitfalls that already cost time are in `references/lessons.md` - read it once at the start.

There are exactly **three stops** where the user decides. Everything else runs without asking:
- **S1** template picks in the gallery, **S2** design direction + scope, **S3** final review of the running site.

## Phase 0 - Intake (one AskUserQuestion at most)
Ask only what the arguments do not answer: brand/product name (or "dùng tên tạm"), which areas (landing, đăng nhập,
admin/dashboard, app pages), content language (default Vietnamese). Default: UI only with typed mock data; no version
control setup (the user handles that) unless they ask.
Project folder: if the session is not already in an empty/new project folder, call `request_directory` with no path so
the user picks or creates one, then `change_directory` to it. Use absolute paths until the turn ends.

## Phase 1 - Gallery from the user's sources -> S1
Follow `ui-template-picker` steps 2.1-2.3 (`SCOUT` = `node "$WEB_STUDIO/skills/ui-template-picker/scout/scout.mjs"`):
`SCOUT stats` (refresh with `SCOUT update` in a Terminal tab when older than 14 days) -> `SCOUT list --theme light,mid --q "<keywords>"`
-> `SCOUT gallery --out <project>/design/template-gallery.html --theme light,mid [--category ...] --limit 120
--title "<Tên> - chọn mẫu" --note "<what to look for>"`. Show it with `SendUserFile` (`display: "render"`).
Tell the user: bấm chọn vài mẫu -> "Copy lựa chọn" -> dán vào chat. **Stop and wait (S1).**

## Phase 2 - Study the picks
For each picked id: read its catalog entry (`scout/catalog.json`: title, desc, image). Download the full image with sharp
into a SHORT temp folder (e.g. `$TEMP/<project>-refs`; long paths break sharp's `toFile`) and view it. Open real pages
(HorizonX, GetLayers) in the built-in browser for motion/layout details. Paid items: previews only; never sign in for the user.

## Phase 3 - Directions -> S2
Compose 3 clearly different directions from the picks (`ui-template-picker` step 3). Fonts MUST support the content
language: for Vietnamese check `https://fonts.googleapis.com/css2?family=<Font>` contains a `/* vietnamese */` block
(known OK: Be Vietnam Pro, Inter, Manrope, Plus Jakarta Sans, Fraunces, Playfair Display, Cormorant Garamond, Lora,
Newsreader, Patrick Hand, Itim; NOT OK: Instrument Serif, DM Serif Display, Bodoni Moda, Young Serif).
Copy `$WEB_STUDIO/skills/ui-template-picker/assets/options.html` to `<project>/design/template-options.html`, replace only
the DATA block (Vietnamese text, real brand name), check it renders (fonts, accents), then ONE AskUserQuestion with:
direction A/B/C (preview = palette, fonts, radius, motions), **motion level** ("Tinh tế" = premium-motion recipes;
"Điện ảnh" = video/3D/shader hero, pinned scroll story, split-text - see
`$WEB_STUDIO/skills/premium-motion/references/cinematic.md`; default to "Điện ảnh" when the user picked MotionSites or
HorizonX hero cards) and, for admin/app projects, a multi-select of module groups.
**Stop and wait (S2).**

## Phase 4 - Scaffold
`bash "$WEB_STUDIO/skills/design-web/scripts/scaffold.sh" <project> --port 3100` (Next.js latest, TS, Tailwind v4, shadcn
radix + 27 components, motion, lenis, 17 itshover icons, motion recipes copied to `design/motion-recipes.md`, dev config).
Read the generated `AGENTS.md` note (new Next.js majors change APIs) and the icon API (`src/components/ui/*-icon.tsx`).

## Phase 5 - Photos
`node "$WEB_STUDIO/skills/ui-template-picker/scout/photos.mjs --out <project>/public/images --q "<query>|landscape|4" ...`
(6-10 queries for hero, space, products, people). Read `_contact-sheet.png`, keep images that fit the direction (bright/warm
for the user's taste), rename them to semantic names (`hero-*.webp`, `space-*.webp`, `product-*.webp`), delete the rest
and the sheet. Unsplash License: free, no attribution required (credit is a nice touch in the footer).
**Motion level "Điện ảnh" -> media plan**: the wow of cinematic sites is moving footage (hero loop + 2-4 card loops), see
"What actually makes these sites look xịn" in `cinematic.md`. List the clips; take free stock video first; for AI
clips (skills `kling-ai`, `runway-api`) show the user the prompts and estimated credits and ask before generating;
encode to small mp4/webm + webp posters in `public/videos/`.

## Phase 6 - Design brief
Write `<project>/design/design-brief.md` (structure: `examples/moc-cafe/design-brief.md`): chosen direction + refs, stack,
tokens mapped onto the shadcn CSS variables (light only), typography (next/font with the right subsets), motion (landing
vs admin), information architecture table (every route), landing sections, admin shell + nav groups + shared components,
mock-data contract, images list, quality bar. Compute weekdays with a tool, never by memory.

## Phase 7 - Build in waves (Maestro)
Briefs go in a short temp folder (e.g. `$TEMP/<project>-briefs`). Every brief must be self-contained: append
`templates/common-page-rules.md` (adapted) to each page brief; reference `design/design-brief.md` and `AGENTS.md`.
Model by kind: foundation/mock `code`, UI pieces `ui`, big interactive screens (POS, editors) `hard`, auth `quick`,
integration `hard`. Timeouts 1800-2100 s.
1. **W1** (batch): foundation (tokens, fonts, providers, `src/components/motion/*` from the copied recipes, format
   helpers) + mock data (types + `src/lib/mock/*`, deterministic, reference date). Then verify yourself: `tsc`, and a
   data-integrity script like `examples/moc-cafe/check-mock.ts` run with `pnpm dlx tsx` (fix its import path).
2. **W2-W4** (one batch with `after`): admin shell, landing halves, auth -> pages (one job per 1-3 related routes, scopes
   are the route folders) -> integration (assemble landing, missing pages, not-found, horizontal-overflow pass on
   every page, lint + build). Always `--dry-run` first.
3. **Motion level "Điện ảnh"**: before W2, copy the references listed in `cinematic.md` into `design/` (GSAP/3D skill
   docs, `scout.mjs prompt <id>` of the picked MotionSites cards, cinematic.md itself). The cinematic hero (and any pinned
   scroll story) becomes its own W2 job (kind `hard`, timeout 2400 s, scope = that section's component file), separate
   from the rest of the landing; it installs its own packages (gsap, @gsap/react, three/R3F) and must keep the
   performance budget (text first, heavy layers lazy, poster fallback, reduced motion).
Start the batch detached (`(maestro batch plan.json < /dev/null > log 2>&1 &)`) and watch it with a Monitor that
greps DONE/FAIL lines; keep working on the next briefs meanwhile.
Show progress to the user: open the Maestro dashboard (`maestro web --app`) and/or the Terminal tab
`oc dash`. Tell them where to look.

## Phase 8 - Live preview and verification
Start the dev server in a Terminal tab: `run_in_terminal` with `cwd` = project, command `pnpm dev --port 3100`
(do not rely on preview_start; it can reuse another folder's launch config). Tell the user the URL as soon as the
landing exists - they will browse it while waves run. Do your checks in a separate browser tab (`tabs_create`) so you
do not fight their scrolling. Per page: screenshot, console errors, horizontal overflow
(`document.documentElement.scrollWidth > clientWidth` and find the widest elements), mobile 375px, reduced motion.
Fix trivial issues directly (a few lines); otherwise add the fix to a pending brief (e.g. integration) or run a fix job.
Rate every job (`maestro rate <id> good|bad --note`).

## Phase 9 - Handover -> S3
Report: URL + routes, what each area contains, what is mock, how to run (`pnpm dev`), jobs/models used, known gaps.
The user does version control; offer commands only if they ask. If they want to discard the project: stop the dev
server tab, stop running jobs of that folder (`oc stop <id>`; never other projects' jobs), then delete the folder.
