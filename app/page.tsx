"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import StakeFader from "@/components/StakeFader";
import { useWallet } from "@/lib/useWallet";
import { ARCSCAN, switchToArc } from "@/lib/arcNetwork";
import { pickProvider } from "@/lib/wallet";
import {
  CONTRACT_ADDRESS, STUDIOSTAKE_ABI, hasContract, readContract,
  fetchStats, fetchFeed, fetchCourse,
  fmtUsdc, shortAddr, timeLeft, courseEnded, fullySettled, withdrawableNow,
  S_FINISHED, type Course, type Stats, EMPTY_STATS,
} from "@/lib/studiostake";

const STAKE_CHIPS = ["1", "2", "3", "5"];

function Knob({ label, value, rot = 0, big = false }: { label: string; value: string; rot?: number; big?: boolean }) {
  return (
    <div className="knob">
      <div className={`knob__dial${big ? " knob__big" : ""}`} style={{ ["--rot" as string]: `${rot}deg` }} />
      <div className="knob__val mono">{value}</div>
      <div className="knob__lbl">{label}</div>
    </div>
  );
}

export default function Home() {
  const { account, balance, chainOk, connecting, connect, disconnect, refreshBalance } = useWallet();
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [feed, setFeed] = useState<Course[]>([]);
  const [sel, setSel] = useState<Course | null>(null);
  const [tab, setTab] = useState<"ledger" | "agents">("ledger");
  const [chip, setChip] = useState("3");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [picker, setPicker] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [now, setNow] = useState(0); // client-seeded clock (avoids SSR hydration drift; ticks live)

  // create-course modal
  const [createOpen, setCreateOpen] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cLessons, setCLessons] = useState("12");
  const [cDur, setCDur] = useState(604800);

  const epoch = useRef(0);
  const accountRef = useRef(account);
  const inFlight = useRef(false);
  useEffect(() => { accountRef.current = account; }, [account]);

  const load = useCallback(async () => {
    if (!hasContract()) return;
    const e = ++epoch.current;
    try {
      const c = readContract();
      const [s, f] = await Promise.all([fetchStats(c), fetchFeed(30, c)]);
      if (e !== epoch.current) return;
      setStats(s); setFeed(f);
      setSel((cur) => (cur ? f.find((x) => x.id === cur.id) ?? cur : f[0] ?? null));
    } catch { /* keep last good */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setNow(Math.floor(Date.now() / 1000)); const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);

  async function refreshSel(id: number) { const fresh = await fetchCourse(id); if (fresh) setSel(fresh); }

  async function writeC() {
    const inj = pickProvider(); if (!inj) throw new Error("No wallet found");
    await switchToArc(inj);
    const signer = await new ethers.BrowserProvider(inj).getSigner(account);
    return new ethers.Contract(CONTRACT_ADDRESS, STUDIOSTAKE_ABI, signer);
  }
  function reason(e: unknown): string {
    const err = e as { code?: string | number; reason?: string; shortMessage?: string; message?: string };
    if (err?.code === "ACTION_REJECTED" || err?.code === 4001) return "Cancelled";
    return (err?.reason || err?.shortMessage || err?.message || "Failed").slice(0, 90);
  }
  function flash(t: string) { setToast(t); setTimeout(() => setToast(""), 3600); }

  async function run(key: string, fn: (c: ethers.Contract) => Promise<ethers.ContractTransactionResponse>, done: string): Promise<boolean> {
    if (!account) { if (!pickProvider()) { flash("✗ no wallet — install Rabby or MetaMask"); return false; } connect(); return false; }
    if (inFlight.current) return false;
    inFlight.current = true; const cap = account; setBusy(key); flash("confirm in your wallet…");
    let ok = false;
    try {
      const c = await writeC(); const tx = await fn(c); flash("settling on ARC…"); await tx.wait();
      if (accountRef.current !== cap) return false;
      flash(done); await load(); if (sel) await refreshSel(sel.id); await refreshBalance(cap); ok = true;
    } catch (e) { flash("✗ " + reason(e)); } finally { inFlight.current = false; setBusy(null); }
    return ok;
  }

  const doStake = (id: number) => run("stake", (c) => c.openStake(id, { value: ethers.parseEther(chip) }), `✓ bond locked — $${chip} staked`);
  const doConfirm = (id: number, student: string) => run("c" + student, (c) => c.confirmAttend(id, student), "✓ attendance confirmed — slice unlocked");
  const doWithdraw = (id: number) => run("wd", (c) => c.withdraw(id), "✓ withdrawn to your wallet");
  const doClaim = (id: number) => run("claim", (c) => c.claimPool(id), "✓ pool dividend claimed");
  const doSettle = (id: number, students: string[]) => run("settle", (c) => c.settleMany(id, students), "✓ settled — pool finalized");
  const doSweep = (id: number) => run("sweep", (c) => c.sweepEmptyPool(id), "✓ empty pool swept to tutor");
  async function doCreate() {
    const t = cTitle.trim(); const n = Number(cLessons);
    if (!t) return flash("✗ name the course");
    if (!Number.isInteger(n) || n < 2 || n > 60) return flash("✗ lessons 2–60");
    const ok = await run("create", (c) => c.createCourse(t, n, cDur), "✓ course is live");
    if (ok) { setCreateOpen(false); setCTitle(""); try { const fresh = await fetchFeed(1, readContract()); if (fresh[0]) setSel(fresh[0]); } catch { /* keep */ } }
  }

  // ── derived for the selected course ──
  const ended = sel ? courseEnded(sel, now) : false;
  const settled = sel ? fullySettled(sel) : false;
  const isTutor = !!(sel && account && sel.tutor.toLowerCase() === account.toLowerCase());
  const mine = sel && account ? sel.stakers.find((s) => s.student.toLowerCase() === account.toLowerCase()) : undefined;
  const wd = mine ? withdrawableNow(mine) : 0n;
  const myDividend = sel && mine && settled && sel.finisherWeight > 0n && mine.status === S_FINISHED && !mine.poolPaid
    ? (sel.forfeitPool * mine.stake) / sel.finisherWeight : 0n;
  const unsettled = sel ? sel.stakers.filter((s) => s.status === 1).map((s) => s.student) : [];
  const slice = sel && sel.lessons ? (ethers.parseEther(chip) / BigInt(sel.lessons)) : 0n;
  const poolRot = sel ? (() => { const ts = sel.stakers.reduce((a, s) => a + s.stake, 0n); return ts > 0n ? Math.min(270, Number((sel.forfeitPool * 270n) / ts)) : 0; })() : 0;

  return (
    <div className="console">
      {/* ── top status strip ── */}
      <div className="strip">
        <span className="led" style={{ fontWeight: 600 }}>
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><rect x="14.5" y="4" width="3" height="24" fill="#3a3d46" /><rect x="15" y="20" width="2" height="8" fill="#19e59b" /><rect x="15" y="4" width="2" height="9" fill="#1f4bff" /><rect x="8" y="11.5" width="16" height="6" rx="1" fill="#f4f5f6" /></svg>
          STUDIOSTAKE
        </span>
        <span className="led"><span className="dot" style={{ background: "#19e59b" }} /> TUTOR-AGENT</span>
        <span className="led"><span className="dot led-blink" style={{ background: "#1f4bff" }} /> AUDITOR-AGENT</span>
        <span className="led">ARC SYNC [LIVE]</span>
        <span className="led" style={{ color: "#19e59b" }}>GAS: USDC</span>
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <button className="led" onClick={() => setPicker((p) => !p)} style={{ background: "none", border: "1px solid var(--line)", padding: "5px 10px", color: "var(--paper)" }}>
            PRESET: {sel ? `${sel.id < 10 ? "0" + sel.id : sel.id}_${sel.title.toUpperCase().replace(/\s+/g, "_").slice(0, 16)}` : "—"} ▾
          </button>
          {picker && (<>
            <div onClick={() => setPicker(false)} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
            <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 81, minWidth: 240, maxWidth: "calc(100vw - 36px)", background: "var(--panel)", border: "1px solid var(--line-2)", marginTop: 4, maxHeight: 320, overflow: "auto" }}>
              {feed.length === 0 && <span className="patch-line" style={{ color: "var(--mute)" }}>no courses yet</span>}
              {feed.map((c) => (
                <button key={c.id} className="patch-line" onClick={() => { setSel(c); setPicker(false); }}>{c.id < 10 ? "0" + c.id : c.id} · {c.title}</button>
              ))}
            </div>
          </>)}
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn btn--signal btn--sm">+ new course</button>
        {account ? (
          <div style={{ position: "relative" }}>
            <button onClick={() => setWalletOpen((o) => !o)} className="btn btn--ghost btn--sm"><span className="dot" style={{ background: chainOk ? "#19e59b" : "#ff3b2e" }} /> {shortAddr(account, 4, 4)}</button>
            {walletOpen && (<>
              <div onClick={() => setWalletOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
              <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 61, minWidth: 220, background: "var(--panel)", border: "1px solid var(--line-2)", marginTop: 4 }}>
                <div style={{ padding: "12px 14px" }}><div className="lbl">wallet</div><div className="mono" style={{ fontSize: 13, marginTop: 5 }}>{shortAddr(account, 8, 6)}</div><div className="mono" style={{ fontSize: 12, color: "#19e59b", marginTop: 5 }}>{balance || "0"} USDC</div></div>
                {!chainOk && <button className="patch-line" style={{ color: "#ff3b2e" }} onClick={() => switchToArc().catch(() => {})}>switch to ARC</button>}
                <a className="patch-line" href={`${ARCSCAN}/address/${account}`} target="_blank" rel="noopener noreferrer">arcscan ↗</a>
                <button className="patch-line" onClick={() => { setWalletOpen(false); disconnect(); }}>disconnect</button>
              </div>
            </>)}
          </div>
        ) : (
          <button onClick={connect} disabled={connecting} className="btn btn--ghost btn--sm">{connecting ? "…" : "connect"}</button>
        )}
      </div>

      {/* role-aware guide rail — one obvious next step for every role */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "9px 18px", borderBottom: "1px solid var(--line)", background: "var(--panel)", fontSize: 12.5, flexWrap: "wrap" }}>
        <span className="lbl" style={{ color: "var(--signal-2)", flex: "0 0 auto" }}>▸ start here</span>
        <span style={{ color: "var(--paper)" }}>
          {!account ? "connect a wallet to patch into a course." : !sel ? "pick a preset above, or open a new course." : isTutor ? "this is your course — confirm each student's lesson on their fader; share the link to fill channels." : mine ? "your bond is locked — money returns to you as the tutor confirms each lesson." : ended ? "this course has closed." : "lock a $1–5 bond on the left; every confirmed lesson returns a slice."}
        </span>
        <div style={{ flex: 1 }} />
        {!account ? <button onClick={connect} disabled={connecting} className="btn btn--signal btn--sm">{connecting ? "…" : "connect wallet"}</button>
          : (!isTutor && sel && !mine && !ended) ? <button onClick={() => doStake(sel.id)} disabled={!!busy} className="btn btn--signal btn--sm">{busy === "stake" ? "locking…" : `lock $${chip} bond`}</button>
          : (isTutor && sel) ? <button onClick={() => { const u = typeof window !== "undefined" ? window.location.href : ""; navigator.clipboard?.writeText(u).then(() => flash("✓ course link copied — send it to students")).catch(() => flash("✗ copy failed")); }} className="btn btn--ghost btn--sm">copy invite link</button>
          : null}
      </div>

      <div className="cols">
        {/* ── COLUMN 1 — stakes / faders ── */}
        <section className="col">
          <div className="head head--blue">
            <div className="head__nav"><b>CHANNELS</b><span>CONFIRMED</span><span className="off">LOCKED *</span><span className="off">RETURNED *</span></div>
            <div className="head__title"><h2>stakes</h2><span className="n">{sel ? (sel.enrolled < 10 ? "0" + sel.enrolled : sel.enrolled) : "00"}</span></div>
          </div>
          <div className="body">
            {sel && sel.stakers.length > 0 ? (
              <div className="faders">
                {sel.stakers.map((s) => (
                  <StakeFader key={s.student} stake={s} lessons={sel.lessons} ended={ended} me={!!account && s.student.toLowerCase() === account.toLowerCase()} canConfirm={isTutor} busy={busy === "c" + s.student} onConfirm={() => doConfirm(sel.id, s.student)} />
                ))}
              </div>
            ) : (
              <div>
                <div style={{ color: "var(--mute)", fontSize: 13, padding: "2px 2px 14px", lineHeight: 1.6 }}>{!sel ? "select a preset above, or hit + new course." : isTutor ? "no students yet. a student channel looks like this — you press confirm +1 on it after each lesson:" : "no bonds locked yet — lock the first one below ↓"}</div>
                {sel && isTutor && (
                  <div style={{ maxWidth: 96 }}>
                    <div className="fader" style={{ opacity: 0.55, pointerEvents: "none" }}>
                      <div className="fader__val mono">3/{sel.lessons}</div>
                      <div className="fader__track" style={{ height: 150 }}>
                        <div className="fader__locked" style={{ top: 0, bottom: "25%" }} />
                        <div className="fader__fill" style={{ height: "25%" }} />
                        <div className="fader__cap" style={{ bottom: "calc(25% - 5px)" }} />
                      </div>
                      <div className="fader__sub mono" style={{ opacity: 0.7 }}>sample</div>
                      <button className="btn btn--refund btn--sm" style={{ width: "100%" }}>confirm +1 ▸</button>
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--mute)", marginTop: 6 }}>↑ a real one appears when a student stakes</div>
                  </div>
                )}
              </div>
            )}

            {/* student action bar */}
            {sel && account && !isTutor && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                {!mine && !ended && (
                  <>
                    <div className="lbl" style={{ marginBottom: 8 }}>lock a bond · {sel.lessons} lessons</div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>{STAKE_CHIPS.map((c) => <button key={c} className="chip" data-on={chip === c} onClick={() => setChip(c)}>${c}</button>)}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--mute)", marginBottom: 10 }}>slice ≈ ${fmtUsdc(slice)} back per confirmed lesson</div>
                    <button onClick={() => doStake(sel.id)} disabled={!!busy} className="btn btn--signal btn--block">{busy === "stake" ? "locking…" : `lock $${chip} bond`}</button>
                  </>
                )}
                {mine && wd > 0n && <button onClick={() => doWithdraw(sel.id)} disabled={!!busy} className="btn btn--refund btn--block" style={{ marginTop: 8 }}>{busy === "wd" ? "…" : `withdraw $${fmtUsdc(wd)} back`}</button>}
                {myDividend > 0n && <button onClick={() => doClaim(sel.id)} disabled={!!busy} className="btn btn--refund btn--block" style={{ marginTop: 8 }}>{busy === "claim" ? "…" : `claim return $${fmtUsdc(myDividend)}`}</button>}
                {mine && wd === 0n && myDividend === 0n && <div className="mono" style={{ fontSize: 11, color: "var(--mute)", marginTop: 8 }}>bond locked · {mine.attended}/{sel.lessons} confirmed{ended ? " · settled" : ""}</div>}
              </div>
            )}

            {/* tutor action bar */}
            {sel && isTutor && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <div className="lbl" style={{ marginBottom: 8 }}>you&apos;re the tutor · {sel.enrolled} enrolled</div>
                <button className="btn btn--rail btn--block" onClick={() => { const u = typeof window !== "undefined" ? window.location.href : ""; navigator.clipboard?.writeText(u).then(() => flash("✓ course link copied — send it to students")).catch(() => flash("✗ copy failed")); }}>copy invite link</button>
                <div className="mono" style={{ fontSize: 11, color: "var(--mute)", marginTop: 8, lineHeight: 1.5 }}>students appear as faders when they lock a bond. press <b style={{ color: "var(--refund)" }}>confirm +1</b> on each after a lesson. you can&apos;t stake your own course.</div>
              </div>
            )}
          </div>
        </section>

        {/* ── COLUMN 2 — knobs + pool ── */}
        <section className="col">
          <div className="head head--red">
            <div className="head__nav"><b>PARAMS</b><span>RETURN BUS</span><span className="off">SLICE *</span><span className="off">GRACE *</span></div>
            <div className="head__title"><h2>knobs</h2><span className="n">{sel ? `N${sel.lessons}` : "—"}</span></div>
          </div>
          <div className="body">
            {sel ? (
              <>
                <div className="knobs">
                  <Knob label="lessons" value={String(sel.lessons)} rot={Math.min(270, sel.lessons * 4)} />
                  <Knob label="enrolled" value={String(sel.enrolled)} rot={Math.min(270, sel.enrolled * 18)} />
                  <Knob label="staked" value={`$${fmtUsdc(sel.stakers.reduce((a, s) => a + s.stake, 0n))}`} rot={120} />
                  <Knob label={ended ? "ended" : "time left"} value={ended ? "00" : timeLeft(sel.deadline, now)} rot={ended ? 270 : 90} />
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
                  <div style={{ textAlign: "center" }}>
                    <Knob label="return bus" value={`$${fmtUsdc(sel.forfeitPool)}`} rot={poolRot} big />
                    <div className="lbl" style={{ marginTop: 6 }}>{settled ? "split across full-run channels" : "sums from muted lessons"}</div>
                  </div>
                </div>
                {/* tutor / auditor settlement */}
                {ended && !settled && (
                  <button onClick={() => doSettle(sel.id, unsettled)} disabled={!!busy || unsettled.length === 0} className="btn btn--rail btn--block" style={{ marginTop: 22 }}>{busy === "settle" ? "settling…" : `auditor: settle ${unsettled.length} stake${unsettled.length === 1 ? "" : "s"}`}</button>
                )}
                {settled && isTutor && sel.finisherWeight === 0n && sel.forfeitPool > 0n && !sel.poolSwept && (
                  <button onClick={() => doSweep(sel.id)} disabled={!!busy} className="btn btn--rail btn--block" style={{ marginTop: 22 }}>{busy === "sweep" ? "…" : `sweep empty bus $${fmtUsdc(sel.forfeitPool)}`}</button>
                )}
              </>
            ) : <div style={{ color: "var(--mute)", fontSize: 13 }}>—</div>}
          </div>
        </section>

        {/* ── COLUMN 3 — maps / cc ledger ── */}
        <section className="col">
          <div className="head head--grey">
            <div className="head__nav"><b>REC</b><span>PLAY</span><span style={{ opacity: 0.5 }}>STOP</span><span style={{ opacity: 0.5 }}>CONFIG *</span></div>
            <div className="head__title"><h2>maps</h2><span className="n">cc</span></div>
          </div>
          <div className="body">
            <div className="tabs">
              <button data-on={tab === "ledger"} onClick={() => setTab("ledger")}>ledger</button>
              <button data-on={tab === "agents"} onClick={() => setTab("agents")}>agents</button>
            </div>
            {tab === "ledger" ? (
              <table className="cc">
                <thead><tr><th>student</th><th>lesson</th><th>usdc</th><th>status</th></tr></thead>
                <tbody>
                  {sel && sel.stakers.length > 0 ? sel.stakers.map((s) => {
                    const back = BigInt(s.attended) * s.slice;
                    const fin = s.status === S_FINISHED || s.attended === sel.lessons;
                    return (
                      <tr key={s.student}>
                        <td className="mono">{!!account && s.student.toLowerCase() === account.toLowerCase() ? "you" : shortAddr(s.student, 4, 3)}</td>
                        <td className="mono">{s.attended}/{sel.lessons}</td>
                        <td className={`mono ${ended && !fin ? "usdc-burn" : "usdc-refund"}`}>{ended && !fin ? "−" : "+"}${fmtUsdc(ended && !fin ? BigInt(sel.lessons - s.attended) * s.slice : back)}</td>
                        <td className="mono" style={{ color: ended ? (fin ? "#19e59b" : "#ff3b2e") : "#1f4bff" }}>{ended ? (fin ? "THRU" : "DROP") : "LOCKED"}</td>
                      </tr>
                    );
                  }) : <tr><td colSpan={4} className="mono" style={{ color: "var(--mute)", padding: 14 }}>{sel ? "awaiting stakes…" : "no course loaded"}</td></tr>}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--paper)" }}>
                <div style={{ marginBottom: 12 }}><span className="dot" style={{ background: "#19e59b", display: "inline-block", marginRight: 8 }} /><b>tutor-agent</b> — confirms attendance from the tutor key; each confirm is a sub-cent USDC tx that unlocks a ~${sel ? fmtUsdc((sel.stakers[0]?.slice) || 0n) : "0.25"} slice.</div>
                <div style={{ marginBottom: 12 }}><span className="dot led-blink" style={{ background: "#1f4bff", display: "inline-block", marginRight: 8 }} /><b>auditor-agent</b> — permissionless: tallies got-back-vs-burned and calls settle after the deadline. No special power.</div>
                <div className="lbl" style={{ marginTop: 16, color: "var(--mute)" }}>why this can only live on arc</div>
                <p style={{ color: "var(--mute)", marginTop: 6 }}>A $3 bond over 12 lessons returns ~$0.25 a lesson. Where gas is a volatile token, refunding $0.25 costs more than it returns. On ARC, USDC is the gas — the fee is a sliver of the same dollar, and an agent can settle cents all day. Without that, per-lesson micro-refunds simply don&apos;t exist.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* create-course modal */}
      {createOpen && (
        <div className="scrim" onClick={() => setCreateOpen(false)}>
          <div className="modal fader-in" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 className="title" style={{ fontSize: 30 }}>new course</h2>
              <button className="icon-btn" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <div className="lbl" style={{ marginBottom: 7 }}>course title</div>
            <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} maxLength={80} className="input" placeholder="Mixing & Mastering — 12-session intensive" />
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <div style={{ flex: 1 }}>
                <div className="lbl" style={{ marginBottom: 7 }}>lessons (N)</div>
                <input value={cLessons} onChange={(e) => setCLessons(e.target.value)} inputMode="numeric" className="input mono" placeholder="12" />
              </div>
              <div style={{ flex: 1 }}>
                <div className="lbl" style={{ marginBottom: 7 }}>window</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[[3600, "1h"], [86400, "1d"], [604800, "1wk"], [2592000, "30d"]].map(([s, t]) => <button key={s} className="chip" data-on={cDur === s} onClick={() => setCDur(s as number)}>{t}</button>)}
                </div>
              </div>
            </div>
            <p className="mono" style={{ fontSize: 11, color: "var(--mute)", marginTop: 14 }}>Students patch in a $1–5 USDC bond; each confirmed lesson returns a slice to them; muted lessons sum to the return bus and split at close across channels that ran the full set. You confirm attendance — you can&apos;t stake your own course.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button onClick={() => setCreateOpen(false)} className="btn btn--ghost">cancel</button>
              <button onClick={doCreate} disabled={busy === "create"} className="btn btn--signal">{busy === "create" ? "opening…" : "open course"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast mono fader-in" style={{ color: toast.startsWith("✓") ? "#19e59b" : toast.startsWith("✗") ? "#ff3b2e" : "var(--paper)" }}>{toast}</div>}
    </div>
  );
}
