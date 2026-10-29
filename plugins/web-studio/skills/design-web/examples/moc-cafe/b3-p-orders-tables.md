# W3 admin: Đơn hàng + Sơ đồ bàn

## Scope
Create only: `src/app/admin/orders/` and `src/app/admin/tables/` (page.tsx + `_components/` each). Do NOT touch anything else.

## `/admin/orders` - Đơn hàng
- PageHeader "Đơn hàng" + description "Theo dõi và cập nhật đơn trong ngày" + primary pill "Tạo đơn" -> `/admin/pos`.
- Summary chips row: counts per status (Chờ xác nhận, Đang pha, Sẵn sàng, Hoàn tất, Đã hủy) - clicking one filters.
- Tabs: "Danh sách" | "Bảng trạng thái".
  - Danh sách: toolbar (search by code/customer, Select kênh, Select trạng thái, date chip "Hôm nay"/"Hôm qua"); table:
    Mã (mono), Thời gian (`formatTime` + relative), Bàn/Kênh (table name or channel label), Món (first item + "+n món"),
    Khách (customer name or "Khách lẻ"), Thanh toán (method label), Tổng (`formatVND`, right aligned), Trạng thái
    (StatusBadge), actions (DropdownMenu: Xem chi tiết, Cập nhật trạng thái submenu, In hoá đơn, Huỷ đơn). Pagination UI
    (10 per page, client).
  - Bảng trạng thái (kanban): columns Chờ xác nhận / Đang pha / Sẵn sàng / Đã phục vụ with counts; order cards (code,
    time, table/channel, item lines, total, elapsed time chip colored amber when > 10 phút); buttons on each card move it
    to the next status (local state, animated with `layout`).
- Row click / "Xem chi tiết" opens a Sheet (right): header code + status, info grid (thời gian, bàn/kênh, nhân viên,
  khách, thanh toán), items table, subtotal/discount/total, timeline of status steps (dots + times), actions.

## `/admin/tables` - Sơ đồ bàn
- PageHeader "Sơ đồ bàn" + legend chips with counts per TableStatus (Trống, Đang phục vụ, Đã đặt, Cần dọn) + outline
  button "Đặt bàn mới" (Dialog form: tên khách, SĐT, giờ, số khách, chọn bàn -> toast).
- Tabs per area (Tầng trệt / Sân vườn / Tầng 2). Floor plan: a large card with a subtle dotted background
  (radial-gradient), aspect 16/10 (min-h-[420px]), tables absolutely positioned with `left/top/width/height` in % from
  `x/y/w/h`; shape round (rounded-full) / square (rounded-xl) / rect (rounded-xl); fill tinted by status color, label
  (name, seats "4 chỗ"), occupied tables show the elapsed time and order total; reserved show `reservedFor`. Decorative
  labels per area (e.g. "Quầy pha chế", "Lối vào", "Cửa sổ") as muted text blocks. Hover lift, selected ring.
  On mobile the plan becomes a grid of table cards instead.
- Clicking a table opens a side panel (Sheet on mobile, sticky card on desktop at the right of the plan): name, area,
  seats, status badge; if occupied: order items + total from the linked order and buttons "Thêm món" (link `/admin/pos`),
  "Thanh toán" (toast), "Chuyển bàn" (toast); if free: "Mở bàn" (status -> dang-phuc-vu locally); if can-don: "Đã dọn xong".

## Common rules for admin pages (Mộc Café)
- Spec: `design/design-brief.md` (Admin, Tokens, Motion). Read `AGENTS.md` (Next.js 16 differs from older versions).
- The admin shell exists: `src/app/admin/layout.tsx` gives sidebar + topbar + padded content. Do not edit it.
- Shared admin components: `import { PageHeader, StatCard, StatusBadge, SectionCard, EmptyState, UserAvatar } from "@/components/admin"` -
  read `src/components/admin/*` to see their props. Do not edit them; if one is missing something, build a local
  component inside your route folder instead.
- UI kit: shadcn components in `src/components/ui/*` (Button, Card, Input, Table, Tabs, Dialog, Sheet, Select, Badge,
  DropdownMenu, Switch, Checkbox, Progress, Popover, ScrollArea, Tooltip, ToggleGroup, Calendar, Chart...). Do not edit them.
  Read the component file before using it (this is the radix-nova style). Charts: `ChartContainer`, `ChartTooltip`,
  `ChartTooltipContent`, `ChartLegend` from `@/components/ui/chart` with recharts; colors `var(--chart-1..5)`.
- Data only from `@/lib/mock` (types in `@/lib/types`); helpers from `@/lib/format` (`formatVND`, `formatDate`,
  `formatTime`, `formatRelative`, `initials`, `formatNumber`). Never use `Math.random()`/`Date.now()` in render.
- Icons: lucide-react; itshover icons from `@/components/ui/*-icon` only inside client components.
- Interactions are UI-only: dialogs/forms close and call `toast.success(...)` from `sonner`; local `useState` is fine.
- Each route: `page.tsx` is a server component exporting `metadata = { title: "<Vietnamese page name>" }` and rendering
  client sections from a private folder `_components/` inside the route (e.g. `src/app/admin/menu/_components/menu-grid.tsx`).
- Vietnamese text everywhere. Responsive from 375px: tables scroll horizontally inside their card (`overflow-x-auto`),
  grids collapse to 1 column, toolbars wrap. Calm motion only (stagger cards with `StaggerGroup` once; no loops).
- Acceptance: `pnpm exec tsc --noEmit` and `pnpm build` pass (other admin routes may be created by parallel jobs; if a
  build error is in a file outside your scope, report it instead of editing that file).
