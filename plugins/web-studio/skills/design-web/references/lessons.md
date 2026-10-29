# Lessons from real runs (keep adding)

## Tooling
- create-next-app makes a version-control repo and a first commit by default: scaffold.sh disables that. Agents never
  create commits; if the user wants a repo they set it up.
- opencode cannot read outside the project folder (external_directory is denied per run): anything a job must read
  (motion recipes, design brief, examples) has to be copied into the project first.
- The guard hook blocks any tool input where the version-control tool's name appears before the words add/commit/push
  (even in prose like "<tool> Bash" followed by "pnpm add"). Write "bash", "version control" instead.
- sharp `toFile()` fails on long Windows paths (the session scratchpad path is ~250 chars): use short temp folders or
  `toBuffer()` + `fs.writeFileSync`.
- itshover registry: use `https://www.itshover.com/r/<name>-icon.json` (the bare domain answers 307). Installed icons
  land in `src/components/ui/`, have no "use client", default export, ref `startAnimation/stopAnimation`.
- scaffold.sh stops with the failing step when `ui.shadcn.com` times out (network): just run it again on a fresh folder.
- preview_start may reuse a previous folder's launch config -> run the dev server in a Terminal tab instead.
- The browser pane's batch actions run on the fronted tab: close stale tabs or always pass `tabId`.
- Next.js 16: dev and build can run side by side; `AGENTS.md` warns that APIs changed - tell jobs to read it.
- When the session moves folders, the app copies scratch files into the new project root: tidy them (move useful ones to
  `design/`, delete the rest).

## Design / UI
- Fonts must support Vietnamese (check the Google Fonts CSS for a vietnamese block) - many display serifs do not.
- shadcn `SidebarInset` needs `min-w-0`, and every grid/flex child holding a table or chart needs `min-w-0`; tables
  inside `overflow-x-auto`. Otherwise admin pages overflow horizontally at laptop widths.
- Reveal animations start at opacity 0: screenshots taken too early look empty - wait or scroll before judging.
- Lenis owns scrolling on the landing page: `window.scrollTo` does nothing; scroll with the mouse wheel or Lenis.
- Counters animate from 0: a mid-animation screenshot shows odd numbers (999 for 2018).
- Weekdays: compute (2026-10-28 is a Wednesday); a free model caught the brief's wrong "Thứ Ba".

## opencode jobs (free models, deepseek-v4.1-flash ranked first in Oct 2026)
- Foundation + mock data in ~4-9 min each; landing halves / admin shell / pages ~5-12 min; big screens (POS) longer.
- Max 3 jobs run at once across ALL sessions (other projects may hold slots) - extra jobs wait automatically.
- Out-of-scope warnings: check what the file is - build artifacts (`*.tsbuildinfo`) are now ignored, scratch files in
  `.oc-tmp/` too; copies made by the app or Claude's own edits also show up.
- Give mock data a strict contract (exact type/export names) so page jobs can run in parallel against it.
