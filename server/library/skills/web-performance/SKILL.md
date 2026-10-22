---
name: web-performance
description: Use when a web page or app feels slow or must hit Core Web Vitals: measuring LCP, INP and CLS, then fixing images, fonts, JavaScript cost, rendering and caching in the right order.
---

# Web Performance

## Targets

Core Web Vitals, judged at the 75th percentile of real visits, mobile and desktop separately:

| Metric | Good | Poor | Measures |
|---|---|---|---|
| LCP, Largest Contentful Paint | 2.5 s or less | over 4 s | loading of main content |
| INP, Interaction to Next Paint | 200 ms or less | over 500 ms | responsiveness to input |
| CLS, Cumulative Layout Shift | 0.1 or less | over 0.25 | visual stability |

Check web.dev/articles/vitals for the current metric set and thresholds before reporting against them; they do change.

## Measure first

Never optimise on intuition. Get a baseline, find the bottleneck, change one thing, measure again.

1. Field data, if the site is public: PageSpeed Insights or the CrUX API shows what real users get. This is what counts.
2. Lab data for diagnosis:
   ```
   npx lighthouse http://localhost:3000 --preset=desktop --output=json --output-path=./lh.json
   npx lighthouse http://localhost:3000 --form-factor=mobile --throttling-method=simulate
   ```
   Run 3 to 5 times and use the median; single runs are noisy.
3. Chrome DevTools Performance panel with CPU throttling (4x or 6x) and network throttling. It shows live LCP, INP and CLS and the LCP element. Record an interaction to see what blocks it.
4. In code, the `web-vitals` library reports the metrics with attribution (which element, which interaction, which script). Use it to collect field data on sites you control.
5. Test production builds, not dev servers. Dev builds are unminified and unrepresentative.

Write down the baseline numbers and the test conditions before changing anything.

## What to fix, in order

Fix the metric that fails, and within it start with the largest component.

### LCP

Break LCP into its parts: TTFB, resource load delay, resource load duration, element render delay. The biggest part is where the fix is.
- TTFB high (over about 800 ms): cache HTML at a CDN or edge, fix slow server work, remove redirect chains.
- Load delay high: the LCP resource is discovered late. Put it in the initial HTML as a real `<img src>` or `srcset` (not `data-src`, not a CSS background set by JS). Add `fetchpriority="high"` to it. Never `loading="lazy"` on the LCP image. If it is referenced from CSS or JS, `<link rel="preload" as="image" fetchpriority="high">`.
- Load duration high: serve AVIF or WebP, correct dimensions with `srcset` and `sizes`, compress, serve from a CDN.
- Render delay high: render-blocking CSS or JS, or client-side rendering. Inline critical CSS, `defer` scripts, server-render the main content, avoid hiding content until JS runs (A/B test snippets, fade-in on hydrate).

### INP

- Find the slow interaction (DevTools, `web-vitals` attribution, Long Animation Frames API). Split it into input delay, processing time, presentation delay.
- Input delay: the main thread was busy. Break up long tasks (over 50 ms), defer third-party scripts, avoid heavy work during load.
- Processing time: do the minimum before the next paint (update the UI first), then yield and do the rest. Use `scheduler.yield()` where supported with a fallback such as `await new Promise(r => setTimeout(r, 0))`. Debounce input handlers. Move pure computation to a Web Worker.
- Presentation delay: large DOM, forced synchronous layout (reading `offsetHeight` after writing styles in a loop), big re-renders. Batch reads before writes, keep the DOM small, use `content-visibility: auto` on long off-screen sections, virtualise long lists, memoise expensive renders in component frameworks.

### CLS

- Give every image, video and iframe `width` and `height` attributes or `aspect-ratio`.
- Reserve space for ads, embeds, banners and late content with `min-height`. Never insert content above existing content unless in response to user input.
- Fonts: match fallback metrics with `size-adjust`, `ascent-override` and related descriptors, or use `font-display: optional`.
- Animate `transform` and `opacity`, not `top`, `left`, `width`, `height` or `margin`.
- Keep pages eligible for the back/forward cache: no `unload` handlers, no `Cache-Control: no-store` on HTML unless necessary. Check in DevTools Application panel.

## Assets

Images:
- Use modern formats (AVIF, WebP) with fallbacks via `<picture>` when needed.
- Always `srcset` and `sizes`; never ship a 2000px image to a 400px slot.
- `loading="lazy"` and `decoding="async"` for images below the fold only.

Fonts:
- Self-host or preconnect to the font origin. Preload only the one or two fonts used above the fold, with `crossorigin`.
- Subset to the needed character ranges, use WOFF2, prefer one variable font over many static weights.
- `font-display: swap` or `optional`; never leave text invisible.

JavaScript:
- Measure bundle size (`npx source-map-explorer`, your bundler's analyser) and unused code (DevTools Coverage).
- Code-split by route and load heavy features on interaction. Remove dead dependencies; replace large libraries with native APIs or smaller ones.
- `defer` or `type="module"` for scripts; `async` only for independent scripts. Load third-party tags after the main content, or through a facade (for example a static preview that loads the video player on click).
- Prefer server rendering or static generation for content pages; hydrate only what is interactive.

## Caching and delivery

- Fingerprinted static assets (`app.3f9a1c.js`): `Cache-Control: public, max-age=31536000, immutable`.
- HTML: short or `no-cache` with revalidation (`ETag`), so deploys show up.
- Enable Brotli or gzip for text. Serve over HTTP/2 or HTTP/3. Use a CDN.
- `preconnect` to critical third-party origins only (two or three at most).
- Consider Speculation Rules to prefetch or prerender likely next pages when the prediction is reliable. Check current browser support.

## Before you call it done

- [ ] Baseline and final numbers recorded under the same conditions (device, throttling, build, median of several runs).
- [ ] The LCP element is known, discoverable in HTML, prioritised and not lazy-loaded.
- [ ] No long task over 50 ms blocks the key interactions; INP under 200 ms in lab with CPU throttling.
- [ ] CLS under 0.1, including after fonts and late content load and on scroll.
- [ ] Images are sized, responsive and in modern formats; fonts are subset and preloaded only where needed.
- [ ] Bundle size checked; nothing large added without a reason.
- [ ] Caching headers correct for hashed assets and for HTML.
- [ ] Every change kept only if it measurably helped.
