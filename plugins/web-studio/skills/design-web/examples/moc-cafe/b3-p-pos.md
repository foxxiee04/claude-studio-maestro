# W3 admin: POS (bán hàng tại quầy)

## Scope
Create only: `src/app/admin/pos/` (page.tsx + `_components/`). Do NOT touch anything else.

## `/admin/pos`
A fast, touch-friendly order screen. Client state for the cart.
- Layout desktop: left = menu (flex-1), right = order panel (w-[380px], sticky, full height of the content area,
  rounded-xl card). Below lg: the order panel becomes a bottom bar showing "n món · tổng" that opens a Sheet (side bottom)
  with the full panel.
- Menu side: search input ("Tìm món…"), category chips (Tất cả + `categories`, with counts), grid of product tiles
  (2/3/4 cols): image (aspect 4/3, rounded-lg), name, price (`formatVND`), "Bán chạy" mini badge, disabled look +
  "Hết hàng" when `!isAvailable`. Tap tile -> if the item has more than one size, a Popover/Dialog to pick size S/M/L
  (price with delta), optional toppings (checkboxes), note input, quantity stepper, "Thêm vào đơn"; else add directly.
  A tiny scale "pop" animation on add.
- Order panel: header with order type ToggleGroup (Tại quán / Mang đi / GrabFood / ShopeeFood); when Tại quán a Select of
  tables from `tables` (only `trong` or `dang-phuc-vu`); customer field (Select/command of `customers`, shows tier badge
  and points when chosen, "Khách lẻ" default). Line items: name, size, toppings, note (muted), unit price, qty stepper
  (- / +), remove (trash icon button, aria-label). Empty state: coffee illustration via the itshover coffee icon +
  "Chưa có món nào". Discount code input + "Áp dụng" (valid codes from `promotions` with status dang-chay; show
  applied promo pill; percent or fixed amount respecting minOrder). Summary: Tạm tính, Giảm giá, VAT 8% (toggle switch,
  default off), Tổng cộng (large). Payment method ToggleGroup (Tiền mặt / Thẻ / Chuyển khoản / Ví điện tử). Buttons:
  outline "Lưu tạm" (toast), primary pill "Thanh toán · <total>" -> Dialog "Thanh toán thành công" with order code
  "#MC2441", total, method, "In hoá đơn" (toast) and "Đơn mới" (clears the cart).
- Keyboard: "/" focuses search.

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
