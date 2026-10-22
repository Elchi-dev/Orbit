export function Sky() {
  return (
    <div className="sky" aria-hidden="true">
      <div className="neb" style={{ width: 760, height: 600, left: -200, top: -180, background: "radial-gradient(circle, rgba(91,63,196,.5), transparent 70%)" }} />
      <div className="neb" style={{ width: 680, height: 560, right: -220, top: 120, background: "radial-gradient(circle, rgba(43,76,184,.4), transparent 70%)", animationDelay: "-12s" }} />
      <div className="neb" style={{ width: 600, height: 480, left: "32%", bottom: -240, background: "radial-gradient(circle, rgba(194,84,122,.28), transparent 70%)", animationDelay: "-24s" }} />
      <div className="stars" />
      <div className="stars2" />
    </div>
  );
}
