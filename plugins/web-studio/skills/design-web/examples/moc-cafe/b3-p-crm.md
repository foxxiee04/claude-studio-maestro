# W3 admin: Khách hàng + Khuyến mãi + Cài đặt

## Scope
Create only: `src/app/admin/customers/`, `src/app/admin/promotions/`, `src/app/admin/settings/` (page.tsx +
`_components/` each). Do NOT touch anything else.

## `/admin/customers` - Khách hàng thân thiết
- PageHeader "Khách hàng thân thiết" + description "24 thành viên" (computed) + actions outline "Xuất danh sách" (toast),
  primary pill "Thêm khách".
- Tier cards row (4): Đồng / Bạc / Vàng / Kim cương with count, share %, and a tinted gradient chip per tier
  (đồng #B0793F, bạc #8C9198, vàng #C9A227, kim cương #5B8DB8 - soft tints only), clickable to filter.
- Table: UserAvatar + tên, SĐT, hạng (StatusBadge tier), điểm (formatNumber), số lần ghé, tổng chi tiêu (vnd), lần cuối
  (relative), actions. Search, tier filter, sort Select (Chi tiêu, Điểm, Gần đây).
- Row click -> Sheet: profile header (avatar, name, tier badge, member since), stats (điểm, lượt ghé, tổng chi), món yêu
  thích (image + name from `menuItems`), sinh nhật, next-tier progress (Progress: e.g. Vàng -> Kim cương needs 5.000 điểm),
  recent orders of that customer from `orders` (or "Chưa có đơn gần đây"), buttons "Tặng điểm" (Dialog number input ->
  toast) and "Gửi ưu đãi" (toast).

## `/admin/promotions` - Khuyến mãi
- PageHeader "Khuyến mãi" + primary pill "Tạo khuyến mãi".
- Tabs: Tất cả / Đang chạy / Sắp diễn ra / Hết hạn with counts.
- Cards grid (1/2/3): code in a mono dashed "ticket" pill with copy button (navigator.clipboard + toast "Đã sao chép
  mã"), name, description, value label ("Giảm 20%", "Giảm 15.000 ₫", "Mua 2 tặng 1"), đơn tối thiểu, dates range,
  usage Progress (used / usageLimit) with numbers, StatusBadge, DropdownMenu (Sửa, Tạm dừng, Xoá). Expired cards muted.
- "Tạo khuyến mãi" Dialog: Tên, Mã (uppercase input with "Tạo mã ngẫu nhiên" button that builds a code from fixed
  syllables, not Math.random at render - use it only inside the click handler), Loại (ToggleGroup phần trăm / số tiền /
  mua X tặng Y), Giá trị, Đơn tối thiểu, Từ ngày / Đến ngày, Giới hạn lượt dùng, Áp dụng cho (Select: Tất cả món / Cà phê /
  Trà & khác / Bánh) -> toast.

## `/admin/settings` - Cài đặt
- PageHeader "Cài đặt" + primary pill "Lưu thay đổi" (toast).
- Tabs (vertical list on desktop, horizontal scroll on mobile): Thông tin quán, Giờ mở cửa, Thanh toán, Thông báo, Tài khoản.
  - Thông tin quán: logo placeholder (wordmark "Mộc" in font-hand inside a rounded square + "Đổi logo"), Tên quán
    "Mộc Café", Địa chỉ, Hotline, Email, Mô tả ngắn (Textarea), Wi-Fi password field.
  - Giờ mở cửa: 7 rows (Thứ 2..Chủ nhật) with Switch mở/đóng + time inputs từ/đến (07:00-22:00).
  - Thanh toán: Switches for Tiền mặt, Thẻ, Chuyển khoản (VietQR - show a QR placeholder block), Ví điện tử (MoMo,
    ZaloPay); VAT % input; Switch "Làm tròn tổng tiền đến 1.000 ₫".
  - Thông báo: Switches (Đơn mới, Sắp hết nguyên liệu, Đổi ca, Báo cáo cuối ngày qua email) with descriptions.
  - Tài khoản: profile (UserAvatar large, name, email, phone), change password fields, "Đăng xuất mọi thiết bị" outline destructive.

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
