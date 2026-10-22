# Motion

<p align="center"><img src="images/ori/working.svg" width="140" alt="Ori typing on a laptop"></p>

How everything in Orbit moves, and why. The rule underneath all of it: **motion
says what happened, it never decorates.** Things that start something get a
little delight, things you use a hundred times a day stay quick and quiet, and
nothing moves on its own unless it is telling you about a state.

## Tokens

Defined once in `web/src/styles.css` and used everywhere.

| Token | Value | For |
| --- | --- | --- |
| `--t-tap` | 90 ms | press feedback |
| `--t-quick` | 160 ms | hover, color, small state changes |
| `--t-move` | 260 ms | panels, popovers, anything that travels |
| `--t-show` | 420 ms | screens, the galaxy portal, first appearances |
| `--ease-out` (`--glide`) | `cubic-bezier(.22, 1, .36, 1)` | things arriving |
| `--ease-in` | `cubic-bezier(.55, 0, .75, .1)` | things leaving (shorter than arriving) |
| `--spring` | `cubic-bezier(.34, 1.4, .64, 1)` | small overshoot for things you caused |

Loops (status only) run between 1.2 and 6 seconds. Nothing loops faster.

**Reduced motion** (the system setting, or Settings, Interface, Motion: Off)
turns every animation and transition into an instant change, stops every loop,
and keeps the 3D sky still. **Calm** keeps transitions and slows every loop
down. Nothing in Orbit depends on an animation to be understood.

## Every element

"Phone" means touch: there is no hover, so press feedback carries the meaning,
and nothing important hides behind hover.

### Buttons

| | Appears | Hover | Press | Phone | Idle |
| --- | --- | --- | --- | --- | --- |
| **Start buttons** (Launch, Get started, Send) | with their screen | a portal opens from the middle onto a turning galaxy, the label goes white, the arrow lifts | dips to 97% | the galaxy flashes open for the press, then closes | still |
| **Primary** (peach, lavender) | with their screen | 4% lighter, lifts 1 px | 97%, drops the lift | same as press | still |
| **Outline and ghost** | with their screen | background fades in | 97% | background flashes | still |
| **Icon buttons** (dock, toolbars) | with their screen | background fades in, icon nudges 1 px toward its meaning (arrow up goes up) | 92% | same as press | a badge breathes only while something is live |
| **Disabled** | | nothing | nothing | nothing | 40% opacity |
| **Kill switch** | when a run starts, scales in | turns red | 92% | same | still |

### Text fields

| | Appears | Focus | Typing | Error |
| --- | --- | --- | --- | --- |
| Inputs, the composer | with their screen | border eases to lavender, a soft ring fades in | nothing (typing is not a show) | a 3 px shake, once, and the message fades in |
| Composer while Claude works | | the border breathes peach slowly | | |

### Surfaces

| | Appears | Disappears | Hover | Notes |
| --- | --- | --- | --- | --- |
| **Popovers and menus** | fade and grow from where they were opened, `--t-move`, spring | fade and shrink toward the same point, faster | | origin follows the trigger |
| **Drawers** (shell, review, git...) | slide in from the dock side with a fade | slide back, faster | | content inside fades in after the drawer lands |
| **Side panel** (Preview, Docs, Board) | slides in from the right while the conversation narrows | reverse | | the divider glows peach while dragged |
| **Panel tabs** | | | text brightens | the peach underline glides to the new tab |
| **Modals** (Settings, palette) | the page dims, the card rises 12 px and fades in | reverse, faster | | Esc closes |
| **Toasts** | slide in from the right with a spring, with Ori in the matching pose | slide out right | pause their timer | stack shifts smoothly |
| **Approval eclipse** | the page dims, the eclipse grows from small, the card rises | the card drops, the eclipse shrinks | | the corona turns and breathes while it waits |
| **Cards** (lanes, planets list, doc rows, missions) | fade up 6 px, staggered 30 ms | fade out | lift 1 px, border brightens | |

### The conversation

| | Appears | Notes |
| --- | --- | --- |
| **Your message** | rises 8 px and fades in; the peach line draws from top to bottom | |
| **Claude's text** | streams; a caret blinks at the end while it writes | no fade per token |
| **Thought trail** | the label shimmers while thinking | opens with a height spring |
| **Tool rows** | fade in; a spinner while running; the verdict dot pops once when decided | expanding is a height spring |
| **Helper lanes** | fade up, staggered; a sweep runs along the bottom while working | lifts on hover |
| **Plan** | items check off with a small pop | the progress bar eases |
| **Steering note** | flies from the composer into the stream | |

### Places

| | Enter | Leave | Idle |
| --- | --- | --- | --- |
| **The Orrery** | planets fade in from the sun outward | | orbits turn; busy planets turn faster and spark; a waiting planet pulses peach; helpers circle as moons |
| **Planet hover** | grows with a spring, glow brightens, label steps aside | | |
| **Into a workspace** | the screen scales up from the planet as if flying in | scales down back to the sky | |
| **Empty places** | Ori fades in with the matching pose | | Ori idles (bob, blink) |

### Ori

Ori is the one thing allowed to move on its own, because Ori **is** the status.
It bobs, blinks and does its pose's loop (types, waves, hops). In the workspace
header it switches pose with a quick cross-fade as Claude moves from thinking to
a tool to done. Ori never moves the layout around it.

## Firefox and Chromium

Everything above uses CSS transitions, CSS animations and the Motion library,
which behave the same in both. Things that differ by browser and how Orbit
handles them:

- **WebGL** may be off in Firefox (some privacy settings disable it). The flat
  sky is then drawn with CSS and looks like the 3D one: the same planets,
  rings, belt and glow.
- **Scrollbars** use `scrollbar-color` and `scrollbar-width` in Firefox and the
  WebKit pseudo elements elsewhere, in the same colors.
- **Number fields** hide the spin arrows in both.
- **Dictation** needs the Web Speech API, which Firefox does not have; the
  microphone button is simply not shown there.
