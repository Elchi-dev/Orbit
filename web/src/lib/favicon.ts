import { BODY } from "../components/ori/Ori";

/** Ori as the tab icon: the star and its face, a dot for what's happening, a little wiggle hello. */
function icon(rot: number, dot: string | null) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='70 70 260 260'><g transform='rotate(${rot} 200 200)'><path d='${BODY}' fill='#FFE6AE'/><circle cx='168' cy='196' r='17' fill='#1A1430'/><circle cx='230' cy='190' r='17' fill='#1A1430'/></g>${dot ? `<circle cx='292' cy='106' r='40' fill='${dot}' stroke='#0A0A16' stroke-width='14'/>` : ""}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

let link: HTMLLinkElement | null = null;
let current = "";
function set(href: string) {
  if (href === current) return;
  current = href;
  if (!link) {
    link = document.querySelector("link[rel=icon]") ?? document.createElement("link");
    link.rel = "icon";
    if (!link.parentNode) document.head.appendChild(link);
  }
  link.href = href;
}

let waving = false;
let state: string | null = null;

/** The state the icon shows: needs you (peach), working (lavender), or nothing. */
export function setFaviconState(s: "needs" | "working" | null) {
  state = s === "needs" ? "#FFB199" : s === "working" ? "#B8A6FF" : null;
  if (!waving) set(icon(0, state));
}

/** Wave hello when a tab opens: a few frames of wiggle, then still. */
export function waveFavicon() {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return set(icon(0, state));
  waving = true;
  const frames = [-14, 12, -10, 8, -5, 0];
  frames.forEach((r, i) =>
    setTimeout(() => {
      set(icon(r, state));
      if (i === frames.length - 1) waving = false;
    }, 160 + i * 170),
  );
}
