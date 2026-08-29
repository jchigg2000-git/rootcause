/**
 * The RootCause HME mark: a segmented hexagon with a diagnostic pulse through it.
 *
 * Traced from `docs/brand-board.png` rather than exported from it — inline SVG
 * so it inherits colour, scales without a raster asset, and costs no request.
 * The hexagon is drawn as six separated segments (the socket/bolt-head read)
 * with the pulse breaking the ring left and right, which is the detail that
 * makes it a diagnostic mark and not a generic hex badge.
 *
 * `currentColor` drives the ring so the mark works on both the dark masthead
 * and light surfaces; the pulse is always brand amber, because it is the one
 * element that must not recede.
 */
export function LogoMark({
  size = 34,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      // Decorative beside the wordmark; labelled only when it stands alone.
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="11"
        strokeLinecap="butt"
        // Six arcs with gaps: dash length ~ one side, gap ~ the joint.
        strokeDasharray="30 11"
        strokeDashoffset="15"
      >
        <polygon points="50,6 88,28 88,72 50,94 12,72 12,28" />
      </g>
      {/* The pulse. Crosses the ring so the mark reads as a live trace. */}
      <path
        d="M2 50 H26 L34 50 L40 26 L48 74 L56 38 L62 58 L68 50 H98"
        fill="none"
        stroke="#e07a1f"
        strokeWidth="7"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/** Mark + wordmark, as it appears in the masthead. Sized for the slim
    44px header — the mark reads fine at 28 because the pulse, not the ring
    detail, is what carries at masthead scale. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <LogoMark size={28} className="logo-mark" />
      <span className="wordmark-text">
        <strong>
          Root<span>Cause</span>
        </strong>
        <em>HME</em>
      </span>
    </span>
  );
}
