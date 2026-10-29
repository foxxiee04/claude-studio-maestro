# W2 login page

## Goal
Create `/login` for café managers (UI only). Spec: `design/design-brief.md` (Tokens, Typography). Read `AGENTS.md`.

## Scope
Create only `src/app/login/page.tsx` and `src/app/login/login-form.tsx`. Do NOT touch anything else.

## Build
- Split layout on desktop (lg:grid-cols-2), single column on mobile. Left (hidden < lg): full-height rounded-[28px]
  photo `/images/space-sofa.webp` (next/image, fill, object-cover) with a cream glass card at the bottom: wordmark "Mộc"
  (font-hand, text-5xl) + quote "Mỗi ly cà phê là một lời chào buổi sáng." and small caption "Hệ thống quản lý Mộc Café".
- Right: centered card (max-w-sm): wordmark on mobile only, h1 "Chào mừng trở lại", muted "Đăng nhập để quản lý quán",
  form (`login-form.tsx`, client): Email (placeholder "quanly@moccafe.vn"), Mật khẩu with show/hide toggle (lucide
  Eye/EyeOff, aria-label), "Ghi nhớ đăng nhập" checkbox, "Quên mật khẩu?" link (#), primary pill button "Đăng nhập" ->
  `router.push("/admin")` after a 600ms fake loading state (spinner), a divider "hoặc", secondary button "Vào bản demo" ->
  `/admin`, and a link "← Về trang chủ" to `/`. No real auth.
- Page metadata title "Đăng nhập · Mộc Café".

## Acceptance checks (run them yourself)
- `pnpm exec tsc --noEmit` and `pnpm build` pass.
