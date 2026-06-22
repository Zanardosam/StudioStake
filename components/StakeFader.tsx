"use client";

import { Stake, fmtUsdc, shortAddr, refundedSoFar, S_FINISHED } from "@/lib/studiostake";

// The signature element: a fader whose cap rides at the refunded level and steps up one
// notch per confirmed lesson. Bottom (mint) = money already back; upper = still LOCKED
// (ultramarine, course live) or FORFEITED (vermilion hatch, course settled).
export default function StakeFader({
  stake,
  lessons,
  ended,
  me,
  canConfirm,
  busy,
  onConfirm,
}: {
  stake: Stake;
  lessons: number;
  ended: boolean;
  me: boolean;
  canConfirm: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const refundedPct = Math.round((stake.attended / lessons) * 100);
  const upperCls = ended ? "fader__burn" : "fader__locked";
  const back = refundedSoFar(stake);
  const burned = BigInt(lessons - stake.attended) * stake.slice;
  const finisher = stake.status === S_FINISHED || stake.attended === lessons;

  return (
    <div className={`fader${me ? " me" : ""}`}>
      <div className="fader__val mono">{stake.attended}/{lessons}</div>
      <div className="fader__track">
        <div className="fader__ticks">
          {Array.from({ length: lessons - 1 }).map((_, i) => (
            <span key={i} style={{ bottom: `${((i + 1) / lessons) * 100}%` }} />
          ))}
        </div>
        {refundedPct < 100 && <div className={upperCls} style={{ top: 0, bottom: `${refundedPct}%` }} />}
        <div className="fader__fill" style={{ height: `${refundedPct}%` }} />
        <div className="fader__cap" style={{ bottom: `calc(${refundedPct}% - 5px)` }} />
      </div>
      <div className="fader__sub mono">
        <span style={{ color: "var(--refund)" }}>${fmtUsdc(back)}</span> back
        {burned > 0n && <> · <span style={{ color: ended ? "var(--burn)" : "var(--mute)" }}>${fmtUsdc(burned)}</span> {ended ? "dropped" : "locked"}</>}
      </div>
      <div className="fader__sub mono" style={{ opacity: 0.7 }}>{me ? "you" : shortAddr(stake.student, 4, 3)}{finisher && ended ? " ✓" : ""}</div>
      {canConfirm && !ended && stake.attended < lessons && (
        <button onClick={onConfirm} disabled={busy} className="btn btn--refund btn--sm" style={{ width: "100%" }}>{busy ? "…" : "confirm +1"}</button>
      )}
    </div>
  );
}
