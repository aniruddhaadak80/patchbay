import type { Agent, CatalogModel, EngineResult, Factor, Tier } from "@/lib/types";
import { TIER_META } from "@/lib/types";

const VERDICT_STYLES: Record<EngineResult["verdict"], { label: string; className: string }> = {
  ship: { label: "Ship", className: "border-signal-green/50 bg-signal-green/10 text-signal-green" },
  tune: { label: "Tune", className: "border-signal-amber/50 bg-signal-amber/10 text-signal-amber" },
  rework: { label: "Rework", className: "border-signal-rose/50 bg-signal-rose/10 text-signal-rose" },
};

export function VerdictBadge({ verdict }: { verdict: EngineResult["verdict"] }) {
  const style = VERDICT_STYLES[verdict];
  return (
    <span className={`inline-flex items-center rounded border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest ${style.className}`}>
      {style.label}
    </span>
  );
}

export function ScoreDial({ score, verdict, size = 148 }: { score: number; verdict: EngineResult["verdict"]; size?: number }) {
  const radius = size / 2 - 12;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);
  const stroke =
    verdict === "ship" ? "var(--signal-green)" : verdict === "tune" ? "var(--signal-amber)" : "var(--signal-rose)";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Policy score ${score} out of 100, verdict ${verdict}`}
      className="shrink-0"
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--rack-200)" strokeWidth={9} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={stroke}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="47%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--ivory-100)"
        fontSize={size * 0.27}
        fontFamily="var(--font-mono-jack), monospace"
        fontWeight={600}
      >
        {score.toFixed(1)}
      </text>
      <text
        x="50%"
        y="70%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--ivory-400)"
        fontSize={size * 0.1}
        fontFamily="var(--font-mono-jack), monospace"
        letterSpacing="1.5"
      >
        / 100
      </text>
    </svg>
  );
}

/** Factor bars. Bar width is the real contribution, not a decorative animation. */
export function FactorList({ factors }: { factors: Factor[] }) {
  return (
    <ul className="space-y-2.5">
      {factors.map((factor) => (
        <li key={factor.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-ivory-200">{factor.label}</span>
            <span className="silkscreen text-[10px] text-ivory-400">
              {factor.contribution.toFixed(2)} / {(factor.weight * 100).toFixed(0)}
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-rack-200"
            role="img"
            aria-label={`${factor.label}: ${factor.normalized.toFixed(3)} normalized, contributing ${factor.contribution.toFixed(2)} points`}
          >
            <div
              className="h-full rounded-full bg-brass-400"
              style={{ width: `${Math.min(100, factor.normalized * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ivory-400">
            {factor.detail} <span className="opacity-70">({factor.unit})</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export function LaneReadout({
  lanes,
  models,
}: {
  lanes: Agent["lanes"];
  models: CatalogModel[];
}) {
  const byId = new Map(models.map((model) => [model.id, model]));
  return (
    <dl className="space-y-2">
      {lanes.map((lane) => {
        const model = lane.modelId ? byId.get(lane.modelId) : undefined;
        const meta = TIER_META[lane.tier];
        return (
          <div key={lane.tier} className="flex items-start gap-3 rounded border border-rack-200 bg-rack-100/60 px-3 py-2.5">
            <span
              className={`jack mt-0.5 h-3.5 w-3.5 shrink-0 ${model ? "jack-filled" : ""}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <dt className="silkscreen text-[10px]">{meta.label}</dt>
              <dd className="mt-1 truncate text-[13px] text-ivory-100">
                {model ? model.name : <span className="text-ivory-400">Empty jack — no model patched</span>}
              </dd>
              <p className="mt-0.5 text-[11px] text-ivory-400">
                {model
                  ? `$${model.inputPerMTok}/MTok in · $${model.outputPerMTok}/MTok out · ${(lane.weight * 100).toFixed(0)}% of traffic`
                  : `${meta.blurb}`}
              </p>
            </div>
          </div>
        );
      })}
    </dl>
  );
}

export function TierChip({ tier, modelId }: { tier: Tier; modelId: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-rack-300 px-2 py-1 text-[11px] text-ivory-200">
      <span className={`jack h-2.5 w-2.5 ${modelId ? "jack-filled" : ""}`} aria-hidden="true" />
      {TIER_META[tier].label}
    </span>
  );
}