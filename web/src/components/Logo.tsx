export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 22 22" className="logo">
      <circle cx="11" cy="11" r="5" fill="#F2EFFF" />
      <ellipse cx="11" cy="11" rx="10" ry="3.8" fill="none" stroke="#B8A6FF" strokeWidth="1.6" transform="rotate(-24 11 11)" />
    </svg>
  );
}
