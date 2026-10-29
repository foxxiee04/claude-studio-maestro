# W3 admin: Tổng quan (dashboard) + Báo cáo

## Scope
Create only: `src/app/admin/page.tsx`, `src/app/admin/_components/` (dashboard sections), `src/app/admin/reports/`.
Do NOT touch other routes, `src/app/admin/layout.tsx`, `src/components/*`, `src/lib/*`.

## `/admin` - Tổng quan
- PageHeader: title "Chào buổi sáng, Minh Anh 👋", description "Thứ Tư, 28/10/2026 · Mộc Café Phú Nhuận", actions:
  outline button "Xuất báo cáo" (toast) and primary pill "Tạo đơn mới" linking to `/admin/pos`.
- KPI row (grid 1/2/4): 4 `StatCard` from `kpis`: Doanh thu hôm nay (vnd), Số đơn, Giá trị TB/đơn (vnd), Khách mới; with deltas.
- Row: "Doanh thu" area chart (lg:col-span-2) from `dailyRevenue` with a ToggleGroup 7 ngày / 30 ngày, gradient fill
  chart-1 -> transparent, y axis in triệu (e.g. "8tr"), tooltip in VND; next to it "Kênh bán" donut (`channelShare`,
  chart-1..4) with legend and percentages.
- Row: "Đơn theo giờ (hôm nay)" bar chart (`hourlySales`, chart-2, rounded bars) + "Món bán chạy" list (`topItems` top 5
  with image from the matching `menuItems` entry, name, sold count, revenue, thin progress bar relative to #1).
- Row: "Đơn gần đây" table (8 newest `orders`: mã, giờ, bàn/kênh, món (first item + "+n"), tổng, trạng thái via
  StatusBadge) with "Xem tất cả" link to `/admin/orders`; side cards: "Sắp hết hàng" (ingredients with stock < minStock:
  name, stock/min with a red Progress, link to `/admin/inventory`) and "Ca hôm nay" (staff with shifts on 2026-10-28:
  UserAvatar, name, role, shift time).
- Cards stagger in once.

## `/admin/reports` - Báo cáo
- PageHeader "Báo cáo kinh doanh" + actions: Tabs-like ToggleGroup (7 ngày / 30 ngày / Tháng này) and "Xuất Excel" (toast).
- KPI row: Doanh thu, Số đơn, Lợi nhuận gộp (revenue - cost estimate from menu `cost` ratio, keep simple: 62% of
  revenue), Khách quay lại (%). Values derived from `dailyRevenue` for the selected range.
- Composed chart: revenue bars + orders line (two y axes) over the selected range.
- "Theo danh mục" horizontal bar chart (revenue per category computed from `topItems`/`menuItems`), "Phương thức thanh
  toán" donut computed from `orders` paymentMethod counts (labels: Tiền mặt, Thẻ, Chuyển khoản, Ví điện tử).
- Table "Hiệu quả món" for all `topItems`: món, đã bán, doanh thu, giá vốn (cost x sold), biên lợi nhuận % with a small
  colored bar; sortable by clicking headers (client state).

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
