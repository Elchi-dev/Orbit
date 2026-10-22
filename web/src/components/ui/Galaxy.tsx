/** The galaxy behind a start button (Launch, Get started, Send). Give the button `gbtn` and wrap its content in `.lbl`. */
export function Galaxy() {
  return (
    <span className="gx" aria-hidden="true">
      <span className="gx-stars" />
      <span className="gx-tilt">
        <span className="gx-arms" />
      </span>
      <span className="gx-core" />
    </span>
  );
}
