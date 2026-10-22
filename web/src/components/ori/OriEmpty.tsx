import type { ReactNode } from "react";
import { Ori, type OriPose } from "./Ori";

/** An empty place, with Ori in the pose for what will happen there. */
export function OriEmpty({ pose, title, children, size = 120, className = "" }: { pose: OriPose; title: string; children?: ReactNode; size?: number; className?: string }) {
  return (
    <div className={`ori-empty ${className}`}>
      <Ori pose={pose} size={size} />
      <p className="ori-empty-title">{title}</p>
      {children && <div className="ori-empty-body">{children}</div>}
    </div>
  );
}
