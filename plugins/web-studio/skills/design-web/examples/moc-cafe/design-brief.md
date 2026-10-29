# Design brief - Mộc Café (UI only)

Chosen direction: **A · Kem Espresso** (user's pick on 2026-10-28). Options page: `design/template-options.html`.
References the user picked: Webild "Coffee Shop" (cream background, espresso pill buttons, handwritten wordmark,
floating drink cards, cursor trail, filterable menu), Webild "Product Showcase" (overlay parallax, highlight sections,
variant product cards), HorizonX "ELLISON" (editorial spacing, smooth Lenis scroll, directional reveals).

Scope: a Next.js app with a public **landing page** and an **admin area** for running the café. UI only: all data
comes from typed mock modules in `src/lib/mock/`; forms show a toast instead of saving. All UI text in **Vietnamese**,
money in VND (`120.000 ₫`), dates `vi-VN`.

## Stack (installed)
Next.js 16.4 App Router + TypeScript, Tailwind CSS v4 (`src/app/globals.css`, no tailwind.config), shadcn/ui
(radix-nova style, components in `src/components/ui/`), `motion` 14 (import from `"motion/react"`), `lenis`,
`recharts` (through the shadcn `chart` component), `lucide-react`. Read `AGENTS.md`: Next 16 differs from older
versions - check `node_modules/next/dist/docs/` before using an API you are unsure about.
Animated icons from itshover are in `src/components/ui/*-icon.tsx` (default export, props `size`, `color`,
`strokeWidth`, `className`; ref handle `startAnimation()` / `stopAnimation()`; types in `src/components/ui/types.ts`).
They have no `"use client"` directive: only import them from client components. Available: coffee, heart, star,
sparkles, gear, users, shopping-cart, home, layout-dashboard, map-pin, clock, send, refresh, user, flame, bookmark, like.

## Tokens (shadcn CSS variables in `:root` of globals.css - light only, no dark mode)
| Variable | Value | Use |
|---|---|---|
| --background | #F3EEE6 | page (cream) |
| --foreground | #2A1A13 | text (dark espresso) |
| --card / --popover | #FFFCF7 | cards, sheets |
| --card-foreground / --popover-foreground | #2A1A13 | |
| --primary | #3B2016 | espresso: primary buttons, active nav |
| --primary-foreground | #FFF8EF | |
| --secondary | #EAE2D6 | secondary buttons, chips |
| --secondary-foreground | #3B2016 | |
| --muted | #ECE5DA | subtle fills |
| --muted-foreground | #7B6A5E | secondary text |
| --accent | #E7DCCB | hover fills |
| --accent-foreground | #3B2016 | |
| --destructive | #B4412F | |
| --border / --input | #E2D8CA | hairlines |
| --ring | #8A5A3B | focus |
| --chart-1..5 | #3B2016, #C08A5B, #8A9A5B, #D9B98F, #6F4E37 | charts |
| --sidebar | #EFE8DD | admin sidebar; --sidebar-primary #3B2016, --sidebar-primary-foreground #FFF8EF, --sidebar-accent #E7DCCB, --sidebar-border #E2D8CA, --sidebar-foreground #2A1A13 |
| --radius | 1rem | Card = rounded-xl (22px); buttons pill (`rounded-full`) |
Extra: `--caramel: #C08A5B`, `--cream-deep: #EAE2D6`, `--shadow-soft: 0 24px 60px -28px rgb(59 32 22 / 0.35)`,
`--shadow-pill: 0 10px 24px -10px rgb(59 32 22 / 0.55)` (the dark pill buttons in the reference carry this shadow).
Status colors (badges): xanh lá #4F7A4A (sẵn sàng/hoàn tất), hổ phách #C08A2E (đang pha/chờ), đỏ #B4412F (hủy/hết hàng),
xanh dương xám #5B6E8C (đã đặt/info). Badges = soft tint background (12% alpha) + colored text, pill.

## Typography
- Body/UI: **Be Vietnam Pro** (next/font/google, weights 400/500/600/700, subsets `["vietnamese","latin"]`) -> `--font-sans`.
- Hand: **Patrick Hand** (400, subsets vietnamese+latin) -> `--font-hand`, Tailwind utility `font-hand`. Only for the
  "Mộc" wordmark, the hero headline, drink-card labels and small eyebrow notes. Never for body text or admin data.
- Scale: hero wordmark clamp(72px, 13vw, 168px) line-height .9 tracking -0.01em; h2 clamp(32px, 4.5vw, 52px) semibold
  tracking -0.02em; h3 20-24px semibold; body 16-17px/1.6; small 13-14px. Admin page titles 26-28px semibold.

## Motion (use `src/components/motion/*`, built from the `premium-motion` recipes)
Tokens: EASE_OUT [0.22,1,0.36,1], DUR micro .25 / base .4 / reveal .8 / hero .9. `MotionConfig reducedMotion="user"`.
- Landing: Lenis smooth scroll (landing only, never in admin); hero stagger (eyebrow -> wordmark -> paragraph -> CTAs ->
  photo scale-in 1.04->1); floating drink cards (gentle y ±8px loop 6-7s, offset phases, plus slight pointer parallax on
  desktop); cursor trail on the hero (6-8 small caramel dots fading, mouse only, off for reduced motion); scroll reveals
  (`Reveal`, `StaggerGroup`) once per section; menu filter with `layout` + `AnimatePresence` (cards re-flow smoothly);
  marquee strip of drink names; hover-lift on cards (CSS); magnetic primary CTA.
- Admin: calm. Page content fade-up (y 8px, .4s); stat cards stagger .06s; KPI numbers use `Counter`; sidebar icons
  animate on hover via the itshover ref; dialogs/sheets use shadcn defaults. No parallax, no loops.

## Information architecture
| Route | Page |
|---|---|
| `/` | Landing |
| `/login` | Đăng nhập quản lý (UI only, button links to /admin) |
| `/admin` | Tổng quan (dashboard) |
| `/admin/reports` | Báo cáo |
| `/admin/pos` | Bán hàng tại quầy (POS) |
| `/admin/orders` | Đơn hàng |
| `/admin/tables` | Sơ đồ bàn |
| `/admin/menu` | Thực đơn |
| `/admin/inventory` | Kho nguyên liệu |
| `/admin/staff` | Nhân viên |
| `/admin/shifts` | Ca làm |
| `/admin/customers` | Khách hàng thân thiết |
| `/admin/promotions` | Khuyến mãi |
| `/admin/settings` | Cài đặt |

## Landing sections (`src/components/landing/*`, assembled in `src/app/page.tsx`)
1. **SiteHeader** - wordmark "Mộc" (font-hand) left; nav: Thực đơn, Câu chuyện, Không gian, Đặt bàn (anchor links);
   right: pill "Đặt bàn" (primary, shadow-pill) + round icon button menu on mobile (Sheet) + small link "Quản lý" -> /login.
   Transparent at top, becomes cream glass (backdrop-blur, border-b) after scrolling 24px.
2. **Hero** - like the Coffee Shop reference: huge handwritten "Mộc Café" spanning the width; under it, right-aligned
   paragraph "Cà phê rang mộc mỗi sáng, bánh nướng tại quầy và một góc yên cho bạn ngồi thật lâu." + CTAs "Đặt bàn"
   (primary) and "Xem thực đơn" (white pill). Below: large rounded (28px) photo `/images/hero-interior.webp` with two
   floating drink cards overlapping its edges (`drink-ca-phe-sua-da` label "Cà phê sữa đá", `drink-latte-da` label
   "Latte đá"), each a white rounded card with the photo and a font-hand label. Cursor trail over the hero.
3. **MarqueeStrip** - drink names separated by small coffee-bean dots, slow, pauses on hover.
4. **Story** (#cau-chuyen) - 2 columns: photo `/images/barista-pour.webp` (parallax) + text "Câu chuyện của Mộc", short copy,
   3 counters: "2018" Năm mở cửa, "12" Loại hạt tuyển chọn, "4.9★" Đánh giá trung bình; small photo `/images/beans-shelf.webp`.
5. **MenuSection** (#thuc-don) - filter chips Tất cả / Cà phê / Trà & khác / Bánh; grid of menu cards from mock menu
   (image, name, short description, price, size chips S/M/L, "Bán chạy" badge); layout animation on filter.
6. **SpaceGallery** (#khong-gian) - bento grid of `/images/space-*.webp` + `hero-interior` with captions
   (Tầng trệt, Góc sofa, Quầy pha chế, Bàn gỗ), hover zoom 1.04, reveal stagger.
7. **Reviews** - 6 review cards (name, initials avatar on colored circle, stars, text) in two rows, gentle marquee or grid.
8. **Booking** (#dat-ban) - card with form (Họ tên, Số điện thoại, Ngày, Giờ, Số khách, Ghi chú) + info column (địa chỉ
   "18 Nguyễn Văn Trỗi, Phú Nhuận, TP.HCM", giờ mở cửa 7:00-22:00, hotline) + map placeholder (cream block with map-pin).
   Submit shows a sonner toast "Đã nhận yêu cầu đặt bàn".
9. **SiteFooter** - wordmark, short line, columns (Thực đơn, Ghé quán, Theo dõi), copyright.

## Admin (`src/app/admin/*`)
Shell: shadcn `Sidebar` (collapsible to icons) on cream `--sidebar`; groups and items:
Tổng quan (Tổng quan /admin, Báo cáo) · Bán hàng (POS, Đơn hàng, Sơ đồ bàn) · Thực đơn & Kho (Thực đơn, Kho nguyên liệu) ·
Nhân sự (Nhân viên, Ca làm) · Khách hàng (Khách hàng, Khuyến mãi) · Hệ thống (Cài đặt). Footer: user card
"Nguyễn Minh Anh · Quản lý". Topbar: sidebar trigger, breadcrumb/page title, search input (⌘K look, UI only),
today's date, notification button with dot, avatar menu (Hồ sơ, Về trang chủ, Đăng xuất -> /login).
Shared admin components (`src/components/admin/`): PageHeader (title, description, actions slot), StatCard (label,
value, delta % with up/down color, icon, optional sparkline), StatusBadge (maps status -> color + Vietnamese label),
EmptyState. Admin cards: `bg-card rounded-xl border shadow-[var(--shadow-soft)]`-style but lighter; tables use shadcn Table
with zebra-free rows, row hover `bg-accent/40`, sticky header.

## Mock data (`src/lib/mock/*`, types in `src/lib/types.ts`)
Deterministic (no Math.random / Date.now at module level - hydration safe). Reference date: 2026-10-28 (Thứ Tư).
See the mock-data job brief for exact exports. Format helpers in `src/lib/format.ts`: `formatVND(n)`, `formatDate(iso)`,
`formatTime(iso)`, `formatRelative(iso)`, `initials(name)`.

## Images (`public/images/`)
hero-interior, space-sofa, space-wood, space-counter, barista-pour, barista-smile, beans-shelf, drink-ca-phe-sua-da,
drink-latte-da, drink-cold-brew, drink-americano-da, drink-latte-nong, drink-cappuccino, drink-flat-white,
food-croissant, food-croissant-dau, food-banh-ngot (all `.webp`, Unsplash License). Use `next/image`.

## Quality bar
- Responsive 375px -> 1440px+, no horizontal scroll. Admin tables scroll horizontally inside their card on mobile.
- Accessible: labels on inputs, focus rings visible, icon buttons have aria-label, contrast AA.
- `pnpm build` passes with no type errors; `pnpm lint` clean or only warnings.
- Motion: transform/opacity only; everything respects reduced motion.
