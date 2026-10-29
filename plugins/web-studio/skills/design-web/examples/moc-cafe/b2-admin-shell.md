# W2 admin shell: sidebar, topbar, shared admin components

## Goal
Build the admin frame every management page sits in, plus small shared components the page jobs will reuse.
Spec: `design/design-brief.md` (sections Admin, Tokens, Motion). Data from `@/lib/mock` (`currentUser`,
`notifications`), helpers from `@/lib/format`, motion from `@/components/motion`. Read `AGENTS.md` (Next.js 16).

## Scope
Create only: `src/app/admin/layout.tsx`, `src/components/admin/` (new files).
Do NOT touch: `src/components/ui/*`, `src/components/motion/*`, `src/lib/*`, `src/app/globals.css`, any other route.
Other jobs create `src/app/admin/<route>/page.tsx` files later - do not create them.

## Build
1. `src/components/admin/nav-config.ts`: export `adminNav` = groups `{ label, items: { title, href, icon } }[]` exactly as
   in the design brief (Tổng quan: Tổng quan `/admin`, Báo cáo `/admin/reports`; Bán hàng: POS `/admin/pos`, Đơn hàng
   `/admin/orders`, Sơ đồ bàn `/admin/tables`; Thực đơn & Kho: Thực đơn `/admin/menu`, Kho nguyên liệu `/admin/inventory`;
   Nhân sự: Nhân viên `/admin/staff`, Ca làm `/admin/shifts`; Khách hàng: Khách hàng `/admin/customers`, Khuyến mãi
   `/admin/promotions`; Hệ thống: Cài đặt `/admin/settings`) and a helper `findNavItem(pathname)`.
   Icons: itshover components where available (layout-dashboard -> Tổng quan, flame -> Báo cáo, shopping-cart -> POS,
   coffee -> Thực đơn, map-pin -> Sơ đồ bàn, users -> Nhân viên, clock -> Ca làm, user -> Khách hàng, sparkles -> Khuyến
   mãi, gear -> Cài đặt); lucide icons for the rest (Đơn hàng: ReceiptText, Kho: Package). Store the icon as a component
   reference plus a flag `animated: boolean`.
2. `app-sidebar.tsx` ("use client"): shadcn `Sidebar` with `collapsible="icon"`. Header: wordmark "Mộc" in `font-hand`
   (text-3xl) + small "Quản lý quán" label (hidden when collapsed). Groups from `adminNav`; active item from
   `usePathname()` (exact match for `/admin`, prefix match for others) uses `isActive`. Each animated icon gets a ref
   and starts/stops its animation on the menu item's mouseenter/mouseleave and focus/blur. Footer: user card
   (initials avatar on `currentUser.avatarColor`, name, role "Quản lý") with a DropdownMenu (Hồ sơ, Về trang chủ `/`,
   Đăng xuất `/login`). Also a small "Mở trang bán hàng" pill linking to `/admin/pos` above the footer (hidden collapsed).
3. `topbar.tsx` ("use client"): sticky, cream glass (`bg-background/80 backdrop-blur border-b`). Left: `SidebarTrigger`,
   separator, current page title from `findNavItem`. Middle/right: search input with a search icon and a "⌘K" kbd hint
   (UI only, hidden < md), today's date via `formatDateLong("2026-10-28T08:00:00+07:00")` (hidden < lg),
   notifications button (lucide Bell, aria-label "Thông báo", dot when unread) opening a Popover that lists
   `notifications` (title, body, relative time, unread dot, "Đánh dấu đã đọc" link), avatar dropdown.
4. `admin-content.tsx` ("use client"): wraps page content; re-animates on pathname change (fade + y 8px, 0.4s, EASE_OUT)
   with `motion.div` keyed by pathname; padding `p-4 md:p-6 lg:p-8`, `max-w-[1400px] mx-auto w-full`.
5. `src/app/admin/layout.tsx`: `SidebarProvider` > `AppSidebar` + `SidebarInset` (bg-background) > `Topbar` + `AdminContent`.
   metadata title template "%s · Mộc Café Admin".
6. Shared components for pages (export from `src/components/admin/index.ts`):
   - `PageHeader({ title, description?, actions? })` - title 26-28px semibold, muted description, actions right (wrap on mobile).
   - `StatCard({ label, value, prefix?, suffix?, format?: "vnd" | "number", delta?, icon?, hint? })` ("use client") -
     card with icon chip (bg-secondary), value via `Counter` (VND formatted when format "vnd"), delta pill green when
     >= 0 ("+12,4% so với hôm qua") red when negative.
   - `StatusBadge({ status })` covering every status union in `@/lib/types` (OrderStatus, TableStatus, staff status,
     promotion status) plus `"sap-het" | "du-hang"` stock states and customer tiers; Vietnamese labels
     (cho-xac-nhan "Chờ xác nhận", dang-pha "Đang pha", san-sang "Sẵn sàng", da-phuc-vu "Đã phục vụ", hoan-tat
     "Hoàn tất", da-huy "Đã hủy", trong "Trống", dang-phuc-vu "Đang phục vụ", da-dat "Đã đặt", can-don "Cần dọn",
     dang-lam "Đang làm", nghi "Nghỉ", nghi-phep "Nghỉ phép", dang-chay "Đang chạy", sap-dien-ra "Sắp diễn ra",
     het-han "Hết hạn", sap-het "Sắp hết", du-hang "Đủ hàng", dong "Đồng", bac "Bạc", vang "Vàng", kim-cuong "Kim cương")
     and the status colors from the design brief (soft tint bg + colored text + small dot, pill).
   - `SectionCard({ title, description?, action?, children, className? })` - admin card with header row.
   - `EmptyState({ icon?, title, description?, action? })`.
   - `UserAvatar({ name, color, size? })` - initials (via `initials()`) on a colored circle.

## Acceptance checks (run them yourself)
- `pnpm exec tsc --noEmit` and `pnpm build` pass.
- `/admin` has no page yet (404 is expected); do not add one.
