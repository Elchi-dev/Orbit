---
name: accessibility
description: Use when building, fixing or auditing web UI for accessibility to WCAG 2.2 AA: semantics, keyboard, focus, contrast, forms, ARIA, motion, and testing with keyboard, screen reader and automated tools.
---

# Accessibility

Target WCAG 2.2 level AA. When a criterion matters to a decision, read its "Understanding" page on w3.org/WAI rather than guessing; the exact wording and exceptions matter.

## Rules in priority order

1. Use native HTML first. A `<button>` gives you focus, Enter and Space, role and name for free. A `<div onclick>` gives you none of them.
2. No ARIA is better than wrong ARIA. Add ARIA only when no native element expresses the pattern, and then follow the WAI-ARIA Authoring Practices Guide (APG) pattern exactly, including its keyboard model.
3. Everything that works with a mouse works with a keyboard, and focus is always visible.
4. Every control has an accessible name that matches its visible label.
5. Information is never conveyed by colour, position or sound alone.

## Semantics and structure

- One `<h1>` per page; headings in order without skipping levels for styling. Style with CSS, not heading level.
- Landmarks: `<header>`, `<nav>`, `<main>` (exactly one), `<aside>`, `<footer>`. Label repeated landmarks: `<nav aria-label="Breadcrumb">`.
- Links go somewhere (`<a href>`); buttons do something (`<button type="button">`). Never use `<a>` without `href` as a button.
- Lists are `<ul>`/`<ol>`, data tables use `<table>` with `<th scope>` and a `<caption>`. Do not use tables for layout.
- Set `<html lang="...">` and `lang` on passages in another language.
- Every page has a unique, descriptive `<title>`. In single-page apps, update it on route change and move focus to the new main heading or announce the change.
- Images: meaningful images get `alt` that conveys purpose; decorative images get `alt=""`. Icon-only buttons need a name: `<button aria-label="Close">` or visually hidden text.
- Provide a "Skip to main content" link as the first focusable element.

## Keyboard and focus

- Tab order follows the visual reading order. Never use positive `tabindex`. Use `tabindex="0"` only on custom widgets and `tabindex="-1"` for programmatic focus targets.
- Visible focus on everything: `:focus-visible { outline: 2px solid; outline-offset: 2px; }`. Never remove the outline without an equal replacement. Aim for 3:1 contrast against adjacent colours.
- Focus must not be hidden by sticky headers, footers, cookie banners or chat widgets (2.4.11). Use `scroll-padding-top` equal to the sticky header height.
- No keyboard traps. Esc closes overlays.
- Modals: use `<dialog>` with `showModal()`. It traps focus, makes the rest inert, and closes on Esc. On open, focus the first sensible control; on close, return focus to the trigger.
- For off-screen or hidden-but-rendered regions, use the `inert` attribute so they are not focusable.
- Composite widgets (tabs, menus, listboxes, grids) use roving `tabindex` and arrow keys as the APG pattern specifies.
- Anything done by dragging must also work with single clicks or taps (2.5.7): add buttons for reorder, inputs for sliders.

## Visual

- Text contrast 4.5:1, large text (24px, or 18.66px bold) 3:1. UI component boundaries, icons and focus indicators 3:1 against neighbours.
- Pointer targets at least 24 by 24 CSS px or with enough spacing (2.5.8). Prefer 44px on touch.
- Content reflows at 320 CSS px width without two-dimensional scrolling (1.4.10) and survives 200% zoom and text spacing overrides (1.4.12). Do not fix heights on text containers.
- Links in body text are distinguishable without colour (underline them).
- Respect `prefers-reduced-motion`: disable parallax, auto-playing animation and large transitions. Anything that moves for more than 5 seconds needs pause, stop or hide.
- Nothing flashes more than three times per second.

## Forms

- Every input has a visible `<label for>`. Placeholder is not a label.
- Group related controls with `<fieldset>` and `<legend>` (radio groups, address blocks).
- Use the right `type` and `autocomplete` tokens (`email`, `tel`, `given-name`, `current-password`, `one-time-code`).
- Mark required fields in text, not only with colour or an asterisk; also set `required`.
- Errors: say what is wrong and how to fix it, in text, next to the field. Link the message with `aria-describedby`, set `aria-invalid="true"`, and on submit move focus to an error summary or the first invalid field. Validate on blur or submit, not on every keystroke.
- Do not ask again for data the user already entered in the same process (3.3.7).
- Authentication must not depend on memorising, transcribing or puzzles (3.3.8). Allow paste into password and code fields and support password managers.
- Status messages that do not take focus ("Saved", "3 results") go in a live region: `<div role="status">`. Use `role="alert"` only for urgent errors. The live region must exist in the DOM before text is inserted.

## ARIA, when you need it

- `aria-expanded` on disclosure triggers, `aria-controls` optional, `aria-current="page"` for current nav item, `aria-pressed` for toggle buttons.
- `aria-label` overrides content; `aria-labelledby` points to visible text and is preferred.
- `aria-hidden="true"` never on focusable elements or their ancestors.
- `role` changes semantics only. It adds no keyboard behaviour; you must implement that.

## How to test

1. Automated scan. Run axe-core (via `@axe-core/cli`, Playwright with `@axe-core/playwright`, or the browser extension) and Lighthouse's accessibility audit. Fix all errors. Automated tools catch roughly a third of issues; a clean scan is a start, not a pass.
   ```
   npx @axe-core/cli http://localhost:3000 --exit
   ```
2. Keyboard pass. Unplug the mouse mentally. From the address bar, Tab through the whole page: every interactive element reachable, order logical, focus always visible and never hidden, every action possible with Enter, Space, arrows and Esc, no traps. Open and close every dialog and menu and check where focus lands.
3. Screen reader basics. Use VoiceOver (macOS, Cmd+F5), NVDA (Windows, free) or TalkBack (Android). Check: page title read on load, heading list (VO rotor, NVDA Insert+F7) makes sense alone, landmarks present, every control announces role, name and state, form errors are announced, live updates are announced.
4. Visual checks. Zoom to 200% and 400%; set the viewport to 320px wide; enable reduced motion in OS settings; check contrast with DevTools' contrast picker; try forced colours mode (Windows High Contrast or DevTools emulation).
5. Inspect the accessibility tree in DevTools (Accessibility pane) for any custom widget to confirm role, name and state.

## Reporting findings

For each issue give: the WCAG criterion number, where (selector or component and file), what fails for whom, and the concrete fix. Rank blockers (cannot complete a task) above friction.

## Before you call it done

- [ ] axe or Lighthouse shows no errors on every changed page.
- [ ] Full keyboard pass done; focus visible, in order, never obscured, returned after dialogs.
- [ ] Every control has a name matching its visible label; images have correct `alt`.
- [ ] Headings, landmarks, `lang` and `<title>` are correct.
- [ ] Contrast meets 4.5:1 text and 3:1 non-text, in every theme.
- [ ] Forms have labels, autocomplete, text errors linked to fields, and announced status.
- [ ] Works at 320px and 200% zoom; reduced motion respected; targets at least 24px.
- [ ] Any ARIA used follows an APG pattern and its keyboard model.
- [ ] Spot-checked with a screen reader.
