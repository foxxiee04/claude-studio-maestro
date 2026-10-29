# W4 integration: assemble the landing page, make every route build cleanly

## Goal
All parts of the Mộc Café UI exist now (landing components, admin shell, admin pages, login). Assemble the landing
page, fix anything that breaks the build or the links, and polish small inconsistencies. Spec: `design/design-brief.md`.
Read `AGENTS.md` (Next.js 16).

## Scope
Edit: `src/app/page.tsx`, `src/app/not-found.tsx` (create), and any file under `src/app/` or `src/components/landing/`,
`src/components/admin/` ONLY to fix build/type/lint errors or broken links. Do NOT change `src/components/ui/*`,
`src/lib/mock/*`, `src/lib/types.ts`, `src/components/motion/*`, `src/app/globals.css` unless a build error forces it
(then make the smallest change and mention it).

## Steps
1. `src/app/page.tsx`: inside `SmoothScroll` > `main`: SiteHeader, Hero, MarqueeStrip, Story, MenuSection,
   SpaceGallery, Reviews, Booking, SiteFooter (from `src/components/landing/*`). Remove the placeholder comment.
2. Check every nav link: landing header/footer anchors (`#thuc-don`, `#cau-chuyen`, `#khong-gian`, `#dat-ban`) match the
   section ids; `/login` and `/admin` links; every admin sidebar item has a page (`/admin`, reports, pos, orders, tables,
   menu, inventory, staff, shifts, customers, promotions, settings). If a page is missing, create a simple placeholder
   with PageHeader + EmptyState "Trang đang được hoàn thiện" and say so in the summary.
3. `src/app/not-found.tsx`: cream page, wordmark "Mộc" (font-hand), "Không tìm thấy trang", buttons "Về trang chủ" (/) and "Vào trang quản lý" (/admin).
4. Horizontal overflow pass on every admin page and the landing page (found on `/admin`: the "Đơn gần đây" table pushes
   the page to 898px in a 777px window). Rules: every grid/flex child that holds a table, chart or long row gets
   `min-w-0`; every `<Table>` sits inside a wrapper with `overflow-x-auto` (shadcn Table already wraps in a container -
   make sure its parent card/section has `min-w-0` and no fixed width); charts use `w-full` with `min-w-0` parents;
   toolbars use `flex-wrap`. Read each page's `_components` and fix them. Do not change the admin layout
   (`SidebarInset` already has `min-w-0`).
5. Run `pnpm lint` and fix errors (warnings may stay). Run `pnpm build` and fix every error until it passes.
   Typical issues: missing "use client" on components using hooks/motion/itshover icons, server components passing
   functions to client components, unescaped quotes in JSX, unused imports.
6. Report the final `pnpm build` route table in the summary.

## Acceptance checks (run them yourself)
- `pnpm lint` has no errors; `pnpm build` passes and lists all routes.
