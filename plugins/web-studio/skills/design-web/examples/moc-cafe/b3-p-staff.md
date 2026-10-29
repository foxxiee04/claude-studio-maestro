# W3 admin: Nhân viên + Ca làm

## Scope
Create only: `src/app/admin/staff/` and `src/app/admin/shifts/` (page.tsx + `_components/` each). Do NOT touch anything else.

## `/admin/staff` - Nhân viên
- PageHeader "Nhân viên" + description "10 người · 4 vai trò" (computed) + primary pill "Thêm nhân viên".
- StatCard row: Tổng nhân viên, Đang trong ca (status dang-lam), Tổng giờ tuần này (sum hoursThisWeek), Quỹ lương tuần
  (sum hoursThisWeek x hourlyRate, vnd).
- Toolbar: role chips (Tất cả, Quản lý, Barista, Thu ngân, Phục vụ) with counts, search, ToggleGroup Bảng / Thẻ.
- Table: UserAvatar + name + email, vai trò (soft badge per role), SĐT, trạng thái (StatusBadge), giờ tuần này with a
  Progress to 48h, lương/giờ (`formatVND`), ngày vào làm, actions (Xem hồ sơ, Sửa, Xếp ca -> link `/admin/shifts`).
- Cards view: grid of profile cards (big avatar, name, role, status, phone, hours progress).
- Row click opens a Sheet profile: avatar, name, role, contact, joined date, this week's shifts (from `shifts` for that
  staffId), hours & estimated pay, notes Textarea, buttons Sửa / Vô hiệu hoá (toast).
- "Thêm nhân viên" Dialog: Họ tên, SĐT, Email, Vai trò (Select), Lương/giờ, Ngày bắt đầu, Switch "Gửi lời mời đăng nhập" -> toast.

## `/admin/shifts` - Ca làm
- PageHeader "Lịch ca làm" + description "Tuần 26/10 – 01/11/2026" + actions: week navigation (ChevronLeft/Right icon
  buttons with aria-labels, label "Tuần này"; UI only) and primary pill "Xếp ca".
- Week grid card: columns Thứ 2 .. Chủ nhật with dates (26/10 .. 01/11), today's column (28/10) highlighted with a soft
  espresso tint and a "Hôm nay" chip; two rows "Ca sáng 06:30–14:30" and "Ca tối 14:00–22:30"; each cell lists staff
  chips (UserAvatar small + short name, colored left border by role) from `shifts`; empty cell shows a dashed "+ Thêm"
  button (opens the Xếp ca dialog prefilled). On mobile: a day selector (horizontal scroll chips) + list for that day.
- Side card "Tổng giờ trong tuần": per staff hours computed from shifts (sorted desc) with Progress to 48h, warning
  color above 44h.
- Role legend chips. "Xếp ca" Dialog: Nhân viên (Select), Ngày (Select of the 7 days), Ca (ToggleGroup sáng/tối), Ghi
  chú -> toast "Đã xếp ca".

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
