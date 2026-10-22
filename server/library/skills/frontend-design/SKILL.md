---
name: frontend-design
description: Use when building or reshaping a web page or app UI and the result should look intentional rather than templated: typography, colour, spacing, layout, states, motion and responsive behaviour.
---

# Frontend Design

## Decide the direction before writing CSS

1. Read what exists. If the project has a design system, tokens, a component library or a brand guide, follow it and extend it. Do not invent a parallel style.
2. Name the job of the screen in one sentence and the one action that matters most. Everything on the page is ranked against that.
3. Pick one clear aesthetic direction and write it down in three to five words (for example "dense, technical, monochrome with one signal colour" or "warm editorial, generous whitespace, serif headings"). Every later choice should be traceable to it.
4. Decide what will be memorable: one distinctive element (a type pairing, an unusual grid, a strong colour field, a custom illustration style). One is enough. Five is noise.

## Avoid the templated defaults

These read as "nobody decided anything". Do not reach for them unless the context calls for them:
- Purple to blue gradients on white, gradient text in hero headings.
- Inter or the system font for everything, all at weights 400 and 600.
- Three equal feature cards with an icon, title and two lines of text.
- Every container a rounded card with the same shadow; radius 8 to 16px on everything.
- Centred hero, big headline, two buttons, screenshot below.
- Emoji as icons, decorative blobs, glassmorphism with no purpose.
- Grey text on light grey backgrounds to look "subtle".

Replacing a default needs a reason tied to the direction, not novelty for its own sake.

## Typography

- Choose at most two families: one for display or headings, one for text and UI. A monospace for code or data is a third only when it is needed.
- Pair on contrast (serif with grotesque, condensed with wide), not on near-duplicates.
- Build a type scale with a fixed ratio (1.2 for dense apps, 1.25 to 1.333 for content, larger for editorial). Use 5 to 7 steps; do not freehand sizes.
- Use fluid sizes for headings: `font-size: clamp(2rem, 1.2rem + 3vw, 3.5rem);`. Keep body text in `rem` so it respects user zoom and settings.
- Body text: 16px minimum, line height 1.4 to 1.6, measure 45 to 75 characters (`max-width: 65ch`). Headings: tighter line height (1.05 to 1.25) and slightly negative tracking at large sizes.
- Use weight, size and colour for hierarchy, in that order of preference. Avoid more than three weights.
- Use `font-variant-numeric: tabular-nums` for tables, prices and counters.
- Load web fonts with `font-display: swap`, subset them, and prefer variable fonts when you need several weights.

## Colour

- Define colours as tokens on `:root` (`--bg`, `--surface`, `--text`, `--text-muted`, `--border`, `--accent`, `--danger`, `--success`). Never hardcode hex values in components.
- Start from neutrals with a slight hue tint, then add one accent. Add a second accent only with a defined role.
- Use `oklch()` for palettes so lightness steps are perceptually even; generate a ramp (for example 10 steps) per hue rather than picking shades by eye.
- Reserve the accent for the primary action, selection and focus. If everything is accented, nothing is.
- Check contrast as you go: 4.5:1 for body text, 3:1 for large text, icons and control borders.
- Support dark mode by redefining tokens under `@media (prefers-color-scheme: dark)`, not by inverting. Dark surfaces are dark grey, not pure black; reduce accent saturation slightly; express elevation with lighter surfaces instead of shadows.

## Spacing and layout

- Use a spacing scale on a 4px or 8px base (4, 8, 12, 16, 24, 32, 48, 64, 96). Every margin, padding and gap comes from it.
- Group by proximity: space inside a group is clearly smaller than space between groups.
- Use CSS Grid for page structure and Flexbox for one-dimensional rows. Prefer `gap` over margins between siblings.
- Use container queries (`container-type: inline-size; @container (min-width: 30rem)`) for components that live in different widths, and media queries for page-level layout.
- Align to a grid. Break it deliberately once, where you want attention.
- Let content set widths: `max-width` on text, `minmax()` and `auto-fit` for card grids: `grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));`.

## Components and states

Design every interactive element in all its states, not just the resting one:
- Default, hover, focus-visible, active, disabled, loading.
- Selected or current (nav item, tab, row).
- Empty, loading (skeleton matching the final layout), error with a way forward, partial data, very long content, zero results.

Rules:
- Focus styles are designed, visible and high contrast: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`. Never `outline: none` without a replacement.
- One primary button per view. Secondary actions are visibly quieter.
- Buttons say what they do ("Save changes", not "Submit"). Destructive actions look different and ask for confirmation or offer undo.
- Hit targets at least 24px, ideally 44px on touch.
- Test with real or realistic data: long names, missing images, 0 and 10,000 items, other languages.

## Motion

- Motion explains change: where something came from, what changed, what is loading. No motion for decoration alone.
- Durations: 100 to 200ms for small UI feedback, 200 to 350ms for panels and page transitions. Ease out when entering, ease in when leaving.
- Animate `transform` and `opacity` only. Do not animate `width`, `height`, `top` or `left`.
- For page or state transitions, consider the View Transitions API where supported, with a plain fallback.
- Wrap non-essential motion: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }`.

## Responsive

- Design mobile first, then add layout as space allows. Check at 320, 375, 768, 1024, 1440px and at an odd width in between.
- No horizontal scroll at 320px. Tables either scroll inside their own container or reflow.
- Respect safe areas on phones (`env(safe-area-inset-bottom)`) for fixed bars.
- Images: `max-width: 100%; height: auto;`, explicit `width` and `height` attributes, `srcset` and `sizes` for photos.
- Check at 200% browser zoom and with a larger default font size.

## Working method

1. Build tokens first (type scale, spacing, colours, radii, shadows), then layout, then components.
2. Render the page and look at it. Take a screenshot at mobile and desktop widths if you can and judge it as a user would: what is seen first, second, third.
3. Squint test: blur your eyes at the screenshot. The primary action and heading must still stand out.
4. Remove one thing. Most first drafts have one decoration, border or colour too many.

## Before you call it done

- [ ] Direction is written down and every major choice follows it.
- [ ] No templated defaults left in without a reason.
- [ ] Type, spacing and colour all come from tokens and scales.
- [ ] All interactive states exist, including focus-visible, disabled, loading, empty and error.
- [ ] Text contrast meets 4.5:1 (3:1 for large text and UI parts) in both light and dark.
- [ ] Works at 320px wide with no horizontal scroll, and at 200% zoom.
- [ ] Motion uses transform and opacity and respects `prefers-reduced-motion`.
- [ ] Tested with realistic, long and empty data.
- [ ] You looked at the rendered result, not just the code.
