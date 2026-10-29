# W2 landing (bottom half): space gallery, reviews, booking, footer

## Goal
Build the second half of the Mộc Café landing page in the "Kem Espresso" style. Spec: `design/design-brief.md`
(Landing sections 6-9, Tokens, Typography, Motion). Data: `@/lib/mock` (`reviews`), helpers `@/lib/format`
(`initials`), motion `@/components/motion` (Reveal, StaggerGroup/StaggerItem, ParallaxImage). Read `AGENTS.md`.

## Scope
Create only: `src/components/landing/space-gallery.tsx`, `reviews.tsx`, `booking.tsx`, `site-footer.tsx`.
Do NOT touch anything else - especially not `src/app/page.tsx` (the integration job adds your sections to the page).

## Build
- `space-gallery.tsx` (id `khong-gian`): eyebrow "Không gian", h2 "Một góc yên giữa phố", bento grid on desktop
  (one large tile 2x2 + three smaller), single column on mobile; images `/images/hero-interior.webp`,
  `/images/space-sofa.webp`, `/images/space-counter.webp`, `/images/space-wood.webp` with captions (Tầng trệt, Góc sofa,
  Quầy pha chế, Bàn gỗ) on a cream glass chip at the bottom-left; hover zoom 1.04 (CSS transition .5s EASE_OUT);
  tiles reveal with stagger; the large tile uses `ParallaxImage`.
- `reviews.tsx`: eyebrow "Khách nói gì", h2 "Ghé một lần, quay lại nhiều lần"; 6 review cards (white card, rounded-xl,
  stars with lucide Star filled caramel, text, initials avatar on `avatarColor`, name, date) in a responsive grid
  (1/2/3 cols) with StaggerGroup; a summary pill "4.9 ★ · 2.000+ đánh giá trên Google".
- `booking.tsx` (id `dat-ban`, client): big rounded card (bg-card, shadow-soft) with two columns: left form using shadcn
  Input, Label, Select (Số khách 1-10+), Textarea; date and time inputs (`type="date"`, `type="time"`, min date
  2026-10-28); submit button primary pill "Gửi yêu cầu đặt bàn" -> `toast.success("Đã nhận yêu cầu đặt bàn", { description:
  "Mộc sẽ gọi xác nhận trong 15 phút." })` from `sonner` and reset the form; right column: address, opening hours
  (Thứ 2 - CN · 7:00 - 22:00), hotline "0909 18 18 18", a map placeholder (rounded block bg-secondary with a centered
  map-pin icon and "Mở Google Maps" link to https://maps.google.com/?q=Ph%C3%BA+Nhu%E1%BA%ADn).
- `site-footer.tsx`: wordmark "Mộc" (font-hand, text-5xl), one-line tagline, three columns of links (Thực đơn: Cà phê,
  Trà & khác, Bánh -> `#thuc-don`; Ghé quán: Đặt bàn, Không gian, Giờ mở cửa; Theo dõi: Facebook, Instagram, TikTok as
  plain links "#"), bottom row "© 2026 Mộc Café · Rang mộc, pha chậm" and a "Quản lý" link to `/login`.
All texts Vietnamese; fully responsive; no horizontal overflow at 375px.

## Acceptance checks (run them yourself)
- `pnpm exec tsc --noEmit` passes (your files are not used by any page yet; that is expected).
