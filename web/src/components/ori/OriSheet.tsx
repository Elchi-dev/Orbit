import { ORI_POSES, Ori } from "./Ori";

/** Every pose at a few sizes, at #/ori: for checking the drawing and for the docs. */
export function OriSheet() {
  return (
    <div className="ori-sheet">
      <h1>Ori</h1>
      <div className="ori-sheet-grid">
        {ORI_POSES.map((p) => (
          <figure key={p}>
            <Ori pose={p} size={200} />
            <figcaption>
              {p}
              <span>
                <Ori pose={p} size={64} />
                <Ori pose={p} size={32} />
                <Ori pose={p} size={18} />
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
