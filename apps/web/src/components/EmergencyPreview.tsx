import { type EmergencyKind } from "@/lib/types";

/** Emblem of each emergency in a -1..1 box. The door app draws the same shapes with paths. */
function Glyph({ kind, color }: { kind: EmergencyKind; color: string }) {
  const stroke = { stroke: color, strokeWidth: 0.16, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
  switch (kind) {
    case "fire":
      return (
        <>
          <path fill={color} d="M0 -1 C0.2 -0.55 0.75 -0.25 0.7 0.3 C0.65 0.8 0.3 1 0 1 C-0.3 1 -0.7 0.8 -0.7 0.3 C-0.75 -0.05 -0.4 -0.3 -0.3 -0.65 C-0.2 -0.85 -0.05 -0.9 0 -1 Z" />
          <path fill="#07080a" d="M0 0.05 C0.3 0.35 0.35 0.9 0 0.9 C-0.35 0.9 -0.3 0.35 0 0.05 Z" />
        </>
      );
    case "biohazard":
      return (
        <>
          {[-90, 30, 150].map((deg) => (
            <circle key={deg} cx={Math.cos((deg * Math.PI) / 180) * 0.5} cy={Math.sin((deg * Math.PI) / 180) * 0.5} r={0.52} stroke={color} strokeWidth={0.14} fill="none" />
          ))}
          <circle r={0.14} fill={color} />
        </>
      );
    case "nuclear": {
      const wedge = (centre: number) => {
        const a = ((centre - 30) * Math.PI) / 180;
        const b = ((centre + 30) * Math.PI) / 180;
        return `M0 0 L${Math.cos(a)} ${Math.sin(a)} A1 1 0 0 1 ${Math.cos(b)} ${Math.sin(b)} Z`;
      };
      return (
        <>
          {[-90, 30, 150].map((deg) => (
            <path key={deg} d={wedge(deg)} fill={color} />
          ))}
          <circle r={0.3} fill="#07080a" />
          <circle r={0.17} fill={color} />
        </>
      );
    }
    case "bomb":
      return (
        <>
          <circle cx={-0.12} cy={0.24} r={0.66} fill={color} />
          <path d="M0.2 -0.28 L0.5 -0.6" {...stroke} />
          {[-20, -75, -130].map((deg) => (
            <path key={deg} d={`M0.62 -0.72 L${0.62 + Math.cos((deg * Math.PI) / 180) * 0.34} ${-0.72 + Math.sin((deg * Math.PI) / 180) * 0.34}`} {...stroke} strokeWidth={0.09} />
          ))}
        </>
      );
    case "seismic":
      return <path d="M-1 0 L-0.58 0 L-0.38 -0.72 L-0.14 0.82 L0.12 -0.92 L0.36 0.5 L0.55 0 L1 0" {...stroke} />;
    case "power":
      return <path fill={color} d="M0.18 -1 L-0.56 0.1 L-0.06 0.1 L-0.2 1 L0.56 -0.16 L0.06 -0.16 Z" />;
  }
}

/** Chevrons on both sides of the emblem, lit one after the other towards it. */
function Chevrons({ side, color }: { side: "left" | "right"; color: string }) {
  const count = 4;
  return (
    <div className={`flex items-center gap-[0.35em] ${side === "right" ? "flex-row-reverse" : ""}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <svg key={i} viewBox="-0.5 -1.1 1 2.2" className="chevron-travel h-[2.6em] w-[1.2em]" style={{ animation: `chevron-travel 1.6s linear ${(i * 1.6) / count}s infinite` }}>
          <path d={side === "left" ? "M-0.5 -1 L0.5 0 L-0.5 1" : "M0.5 -1 L-0.5 0 L0.5 1"} stroke={color} strokeWidth={0.3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      ))}
    </div>
  );
}

/**
 * What the door screen shows during an emergency: only the door code, chevrons towards the emblem,
 * the title and the procedure. Sizes are in `em`, so it scales with its container.
 */
export function EmergencyPreview({
  kind,
  color,
  title,
  instructions,
  doorCode = "A-101",
  testMode,
}: {
  kind: EmergencyKind;
  color: string;
  title: string;
  instructions: string;
  doorCode?: string;
  testMode: boolean;
}) {
  return (
    <div className="@container w-full">
      <div
        className="flex aspect-video w-full flex-col items-center justify-between overflow-hidden rounded-xl border px-[3%] py-[2.5%] text-[1.5cqw]"
        style={{ background: "#07080a", color: "#f2f5f3" }}
        role="img"
        aria-label={`Door screen preview: ${title}${testMode ? ", test" : ""}`}
      >
        <div className="text-[2.2em] font-medium tracking-[0.15em]">{doorCode}</div>
        <div className="flex items-center gap-[1.2em]">
          <Chevrons side="left" color={color} />
          <svg viewBox="-1.5 -1.5 3 3" className="size-[9em]">
            <circle r={1.3} fill={color} opacity={0.12} />
            <circle r={1.3} stroke={color} strokeWidth={0.07} fill="none" />
            <g transform="scale(0.72)">
              <Glyph kind={kind} color={color} />
            </g>
          </svg>
          <Chevrons side="right" color={color} />
        </div>
        <div className="flex flex-col items-center gap-[0.5em] text-center">
          {testMode && (
            <span className="rounded-full px-[0.9em] py-[0.15em] text-[0.8em] font-bold tracking-[0.12em]" style={{ background: color, color: "#07080a" }}>
              TEST — NO REAL EMERGENCY
            </span>
          )}
          <div className="text-[2em] font-semibold" style={{ color }}>
            {title}
          </div>
          <p className="max-w-[40em] text-[1.1em] leading-snug" style={{ color: "#a3afa9" }}>
            {instructions}
          </p>
        </div>
      </div>
    </div>
  );
}
