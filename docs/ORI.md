# Ori

<p align="center"><img src="images/ori/hi.svg" width="200" alt="Ori waving hi"></p>

Ori is Orbit's mascot: a soft eight-point star, the sun the workspaces orbit,
with a lavender ring, a peach moon on it and two floating mitten hands. Ori is
how Orbit shows what Claude is doing, keeps empty places from feeling empty,
and explains the app when you ask.

## The poses

| | Pose | Shows when | Moves |
| --- | --- | --- | --- |
| <img src="images/ori/idle.svg" width="72" alt=""> | `idle` | a workspace is ready | floats, blinks |
| <img src="images/ori/hi.svg" width="72" alt=""> | `hi` | the first screen, a new workspace, the README | waves |
| <img src="images/ori/thinking.svg" width="72" alt=""> | `thinking` | Claude is thinking before it acts | looks up, thought dots pulse |
| <img src="images/ori/working.svg" width="72" alt=""> | `working` | a shell command runs, Claude writes its answer | types on a laptop |
| <img src="images/ori/reading.svg" width="72" alt=""> | `reading` | reading or searching files, reading a doc | peers through a magnifying glass |
| <img src="images/ori/searching.svg" width="72" alt=""> | `searching` | web search, fetching a page | looks through a telescope |
| <img src="images/ori/writing.svg" width="72" alt=""> | `writing` | writing or editing files and docs | scribbles with a pencil |
| <img src="images/ori/planning.svg" width="72" alt=""> | `planning` | updating the plan | holds a checklist |
| <img src="images/ori/drawing.svg" width="72" alt=""> | `drawing` | working on the whiteboard | holds up a sticky note |
| <img src="images/ori/camera.svg" width="72" alt=""> | `camera` | screenshots and the preview | takes a picture, the flash pops |
| <img src="images/ori/needs.svg" width="72" alt=""> | `needs` | an approval is waiting | hops and waves a peach flag |
| <img src="images/ori/done.svg" width="72" alt=""> | `done` | a run finished | arms up, sparkles |
| <img src="images/ori/sleeping.svg" width="72" alt=""> | `sleeping` | a workspace has been quiet for half an hour | breathes, z's drift up |
| <img src="images/ori/oops.svg" width="72" alt=""> | `oops` | an error stopped the run | a small shake, a sweat drop |
| <img src="images/ori/helpers.svg" width="72" alt=""> | `helpers` | helpers are working for the workspace | little stars ride the ring |

Below 34 pixels Ori keeps only the star and a bigger face; the ring and hands
would only blur. The browser tab uses that small Ori, with a peach dot when
something needs you and a lavender one while Claude works.

## Where Ori is

- **The workspace header**: the pose for what Claude is doing right now, with
  what it is doing in the tooltip.
- **The setup wizard**: hi, reading (your key), thinking (how you like to
  work), needs (who approves), done.
- **Ask Ori**: the button at the bottom left of the sky and of a workspace,
  or the <kbd>?</kbd> key. Topics: reading the sky, how Claude asks first, ways
  of working, helpers, preview and docs and the board, missions, shortcuts,
  and running the setup again.
- **Tours**: a spotlight walk around the sky or a workspace. Each is offered
  once, the first time you're there, and is always in Ask Ori.
- **Toasts**: done for good news, thinking for a warning, oops for an error.
- **Empty places**: an empty workspace, no docs, an empty board, nothing in
  the preview, nothing to review.
- **Approvals**: the line above the question.

## Using Ori in code

```tsx
import { Ori } from "./components/ori/Ori";

<Ori pose="working" size={64} />          // moves
<Ori pose="needs" size={30} still />      // holds still
```

`size` is in pixels; Ori is drawn on a 400 unit square. Every animation is CSS
in `web/src/components/ori/ori.css` and stops under reduced motion, under
Settings, Interface, Motion: Off, and with `still`. `poseForTool()` in
`web/src/lib/ori.ts` maps a tool to its pose.

Every pose at a few sizes is at `#/ori` in a running Orbit. The SVG files in
`docs/images/ori` are drawn from the same component:

```sh
bun scripts/ori-svgs.ts
```

## Drawing rules

- The star is cream (`#FFE6AE`), shaded on the lower right as if lit from the
  upper left. The ring is lavender, its moon peach: Orbit's two colours.
- The face is two dots and a small mouth. Expressions change the eyes and
  the mouth only.
- Hands float; they are never attached. Hands in front of the star get a
  thin warm edge so they don't disappear into it.
- Every pose has exactly two hands. Things Ori holds bring their own hands.
- Ori moves slowly, and only in loops that say something.
