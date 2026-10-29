# Recipes (motion/react, Next.js App Router + Tailwind)

Install: `npm i motion` (+ `npm i lenis` for smooth scroll). Client components need `"use client"`.
Put these in `components/motion/`. Checked against Motion docs on 2026-10-22 and type-checked
(TypeScript 7, strict) with motion 14.5 + lenis 1.3.

## setup

```ts
// components/motion/tokens.ts
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];
export const EASE_IN: [number, number, number, number] = [0.64, 0, 0.78, 0];
export const DUR = { micro: 0.25, base: 0.4, reveal: 0.8, hero: 0.9 } as const;
export const SPRING = { type: "spring", stiffness: 260, damping: 30 } as const;
```

```tsx
// components/motion/motion-provider.tsx
"use client";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT, DUR } from "./tokens";

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DUR.base, ease: EASE_OUT }}>
      {children}
    </MotionConfig>
  );
}
```
Wrap `{children}` in `app/layout.tsx` with `<MotionProvider><SmoothScroll>...</SmoothScroll></MotionProvider>`.

## smooth-scroll

```tsx
// components/motion/smooth-scroll.tsx
"use client";
// Lenis base styles: add `@import "lenis/dist/lenis.css";` at the top of globals.css (not here).
import { ReactLenis, type LenisRef } from "lenis/react";
import { cancelFrame, frame, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

export function SmoothScroll({ children }: { children: ReactNode }) {
  const ref = useRef<LenisRef>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    // Runs in Motion's "setup" step so useScroll reads the position Lenis writes in the same frame.
    const update = ({ timestamp }: { timestamp: number }) => ref.current?.lenis?.raf(timestamp);
    frame.setup(update, true);
    return () => cancelFrame(update);
  }, []);
  if (reduce) return <>{children}</>;
  return (
    <ReactLenis root options={{ autoRaf: false, lerp: 0.1 }} ref={ref}>
      {children}
    </ReactLenis>
  );
}
```

## reveal

```tsx
// components/motion/reveal.tsx
"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { DUR, EASE_OUT } from "./tokens";

export function Reveal({ children, delay = 0, y = 24, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: DUR.reveal, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}
```

## stagger

```tsx
// components/motion/stagger.tsx
"use client";
import { motion, stagger, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { DUR, EASE_OUT } from "./tokens";

const container: Variants = { hidden: {}, show: { transition: { delayChildren: stagger(0.08) } } };
const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.reveal, ease: EASE_OUT } },
};

export function StaggerGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={container} initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -10% 0px" }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return <motion.div className={className} variants={item}>{children}</motion.div>;
}
```

## mask-lines

```tsx
// components/motion/mask-lines.tsx
"use client";
import { motion } from "motion/react";
import { DUR, EASE_OUT } from "./tokens";

export function MaskLines({ lines, className, delay = 0 }: { lines: string[]; className?: string; delay?: number }) {
  return (
    <h1 className={className} aria-label={lines.join(" ")}>
      {lines.map((line, i) => (
        <span key={i} aria-hidden className="block overflow-hidden pb-[0.08em]">
          <motion.span
            className="inline-block"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{ duration: DUR.hero, ease: EASE_OUT, delay: delay + i * 0.08 }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}
```

## blur-in / scale-in

```tsx
<motion.div initial={{ opacity: 0, filter: "blur(12px)" }} animate={{ opacity: 1, filter: "blur(0px)" }}
  transition={{ duration: 1, ease: EASE_OUT, delay: 0.2 }} />

<motion.div initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }}
  transition={{ duration: 1.2, ease: EASE_OUT, delay: 0.3 }} className="overflow-hidden rounded-3xl" />
```

## parallax

```tsx
// components/motion/parallax-image.tsx
"use client";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

export function ParallaxImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-8%", "8%"]);
  return (
    <div ref={ref} className={`relative overflow-hidden ${className ?? ""}`}>
      {/* scale > 1 so the drifting image never shows its edges */}
      <motion.img src={src} alt={alt} style={{ y, scale: 1.18 }} className="h-full w-full object-cover" />
    </div>
  );
}
```
With next/image: wrap `<Image fill>` in a `motion.div` that gets `style={{ y, scale }}`.

## hover-lift (CSS only)

```tsx
<article className="rounded-2xl bg-surface shadow-[0_10px_30px_-18px_rgb(20_17_15/0.25)]
  transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
  hover:-translate-y-1.5 hover:shadow-[0_24px_50px_-20px_rgb(20_17_15/0.3)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
  <div className="overflow-hidden rounded-t-2xl">
    <img className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.04]" />
  </div>
</article>
```

## magnetic

```tsx
// components/motion/magnetic.tsx
"use client";
import { motion, useMotionValue, useSpring } from "motion/react";
import { useRef, type ReactNode } from "react";

export function Magnetic({ children, strength = 0.25 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 200, damping: 18, mass: 0.4 });
  return (
    <motion.div
      ref={ref}
      className="inline-block"
      style={{ x: sx, y: sy }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.div>
  );
}
```

## marquee (CSS)

```css
/* globals.css */
.marquee { overflow: hidden; mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent); }
.marquee-track { display: flex; gap: 4rem; width: max-content; animation: marquee 30s linear infinite; }
.marquee:hover .marquee-track { animation-play-state: paused; }
@keyframes marquee { to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .marquee-track { animation: none; } }
```
Render the item list twice inside `.marquee-track` so the loop is seamless.

## counter

```tsx
// components/motion/counter.tsx
"use client";
import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { EASE_OUT } from "./tokens";

export function Counter({ to, duration = 1.6, format = (n: number) => Math.round(n).toLocaleString() }: { to: number; duration?: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const value = useMotionValue(0);
  const text = useTransform(value, format);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(value, to, { duration, ease: EASE_OUT });
    return () => controls.stop();
  }, [inView, to, duration, value]);
  return <motion.span ref={ref} className="tabular-nums">{text}</motion.span>;
}
```

## scroll-progress

```tsx
"use client";
import { motion, useScroll, useSpring } from "motion/react";
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 40 });
  return <motion.div style={{ scaleX }} className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-accent" />;
}
```

## page-enter (Next.js App Router)

```tsx
// app/template.tsx - re-mounts on every navigation
"use client";
import { motion } from "motion/react";
import { EASE_OUT } from "@/components/motion/tokens";
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
      {children}
    </motion.div>
  );
}
```

## ambient (CSS)

```css
.blob { position: absolute; inset: auto; width: 40vw; aspect-ratio: 1; border-radius: 50%; filter: blur(80px);
        background: var(--accent); opacity: .25; animation: floaty 14s ease-in-out infinite alternate; pointer-events: none; }
@keyframes floaty { to { transform: translate(-20%, 15%) scale(1.15); } }
.drift { background: linear-gradient(120deg, var(--bg), color-mix(in srgb, var(--accent) 12%, var(--bg)), var(--bg));
         background-size: 300% 300%; animation: drift 18s ease-in-out infinite alternate; }
@keyframes drift { from { background-position: 0% 50%; } to { background-position: 100% 50%; } }
@media (prefers-reduced-motion: reduce) { .blob, .drift { animation: none; } }
```

## layout-expand

```tsx
"use client";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

export function ExpandGallery({ items }: { items: { id: string; title: string; img: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = items.find((i) => i.id === open);
  return (
    <>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
        {items.map((it) => (
          <motion.button key={it.id} layoutId={`card-${it.id}`} onClick={() => setOpen(it.id)} className="overflow-hidden rounded-2xl text-left">
            <motion.img layoutId={`img-${it.id}`} src={it.img} alt="" className="aspect-[4/5] w-full object-cover" />
          </motion.button>
        ))}
      </div>
      <AnimatePresence>
        {active && (
          <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)}>
            <motion.div layoutId={`card-${active.id}`} className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white">
              <motion.img layoutId={`img-${active.id}`} src={active.img} alt="" className="aspect-[16/10] w-full object-cover" />
              <h3 className="p-6 text-2xl">{active.title}</h3>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
```
Add Escape-to-close and focus handling for the dialog when using this for real.
