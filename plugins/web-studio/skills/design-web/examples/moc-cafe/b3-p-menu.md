# W3 admin: Thực đơn + Kho nguyên liệu

## Scope
Create only: `src/app/admin/menu/` and `src/app/admin/inventory/` (page.tsx + `_components/` each). Do NOT touch anything else.

## `/admin/menu` - Thực đơn
- PageHeader "Thực đơn" + description "18 món · 3 danh mục" (computed) + actions: outline "Quản lý danh mục" (Dialog
  listing categories with edit inputs, toast on save) and primary pill "Thêm món".
- Toolbar: category Tabs with counts, search input, Select sort (Bán chạy, Giá tăng, Giá giảm, Tên A-Z), ToggleGroup
  view Lưới / Bảng.
- Grid view: cards (image 4/3 with hover zoom, "Bán chạy" badge, "Hết hàng" overlay), name, category, price, sizes
  summary "S · M · L", rating, sold today; footer row: Switch "Đang bán" (local state, toast "Đã ẩn món" / "Đã mở bán") and a
  DropdownMenu (Sửa, Nhân bản, Xoá -> AlertDialog-like confirm Dialog).
- Table view: image thumb, tên, danh mục, giá, giá vốn, biên lợi nhuận %, đã bán hôm nay, trạng thái switch, actions.
- "Thêm món"/"Sửa" Dialog (max-w-2xl): image drop zone placeholder (dashed border, upload icon, "Kéo thả ảnh hoặc bấm để
  chọn"), Tên món, Danh mục (Select), Giá bán, Giá vốn, Mô tả (Textarea), sizes (checkboxes S/M/L with price delta
  inputs), toppings (repeatable rows name + price with add/remove), Switch "Bán chạy", Switch "Đang bán"; footer
  Huỷ / Lưu món (toast). Prefill when editing.

## `/admin/inventory` - Kho nguyên liệu
- PageHeader "Kho nguyên liệu" + actions: outline "Kiểm kho" (toast) and primary pill "Nhập kho".
- StatCard row: Tổng mặt hàng (count), Sắp hết (count stock < minStock, red hint), Giá trị tồn kho (sum stock x
  costPerUnit, vnd), Nhập trong tuần (sum of `nhap` movements qty count or value).
- Main table (lg:col-span-2): tên + group, tồn kho with unit and a Progress bar (stock / (minStock*3)) colored red when
  below minStock, amber when < 1.5x min, green otherwise; tối thiểu; đơn giá (`formatVND`/unit); nhà cung cấp; nhập lần
  cuối (`formatDate`); status (StatusBadge sap-het/du-hang); actions (Nhập thêm, Điều chỉnh). Filters: group chips,
  search, Switch "Chỉ hiện sắp hết".
- Side card "Lịch sử kho": `stockMovements` timeline (icon per type: nhập green ArrowDownToLine, xuất ArrowUpFromLine,
  hao hụt amber TriangleAlert; ingredient name, qty + unit, by, time relative, note).
- "Nhập kho" Dialog: Select nguyên liệu, số lượng + unit suffix, đơn giá, nhà cung cấp, ngày nhập, ghi chú -> toast.

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
