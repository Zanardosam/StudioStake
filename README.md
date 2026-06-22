<h1 align="center">StudioStake</h1>

<p align="center"><em>A control surface for finishing a course — your bond, melting back to you a lesson at a time.</em></p>

<p align="center">
  <a href="https://studiostake-arc.vercel.app">Live app</a> ·
  <a href="https://testnet.arcscan.app/address/0x9F171Ee048542257C24e07Db4DCC8DeF3bCf2506">Contract on ArcScan</a> ·
  Native USDC on ARC testnet
</p>

---

## What it is

People quit a course after a couple of weeks because nothing's on the line. StudioStake puts a little money on the line — and gives it back as you show up.

A student patches a small **bond of $1–5 USDC** into a tutor's course of N lessons. The bond splits into N equal slices. Every lesson the **tutor confirms** you attended, that lesson's slice **returns to you** — your own money flowing back, a slice at a time, in cents. Lessons left unconfirmed at the deadline are *muted*: their slices sum to the course **return bus**, split at close across the channels that ran the full set. Show up to everything and you get **100% back, plus a cut of everyone else's no-shows**.

The whole thing is a hardware control surface: each student is a **fader** that drains from locked (ultramarine) toward returned (mint), the course params are **knobs**, the return bus is the big knob in the middle, and the live ledger streams like MIDI CC traffic.

## Why it can only live on ARC

The bond is *micro*. A $3 bond over 12 lessons returns about **$0.25 per lesson**, settled dozens of times a week across a cohort. That single fact is fatal everywhere except Arc:

- **Gas would dwarf the payment.** On a chain with a volatile native gas token, a confirm-and-return tx costs cents-to-dollars of that token — returning $0.25 while burning $0.30 of gas is negative-value money movement. On Arc, **USDC is the gas**, so the fee is a sliver of the same dollar and the return stays net-positive.
- **The agent settles cents, continuously.** A 12-lesson cohort of 30 students is hundreds of autonomous cent-scale settlements. Batching to survive gas would destroy the per-lesson granularity that *is* the product.
- **One unit of account.** Bond, slice, return, bus, and gas are all the same dollar — no "keep the native token for gas."

Without per-lesson micro-refunds and autonomous cent-scale settlement, this product doesn't exist as a worse version — it doesn't exist at all.

## The two agents

- **Tutor-agent** ([`agent/tutor.mjs`](agent/tutor.mjs)) — the attendance confirmer. Runs from the tutor key (only the tutor may confirm); after each video lesson it confirms everyone present in one cheap USDC-gas tx, unlocking each student's slice.
- **Auditor-agent** ([`agent/auditor.mjs`](agent/auditor.mjs)) — permissionless, no special power. It reads public state, publishes each student's returned-vs-dropped tally, and calls `settleMany` after the deadline to finalize the bus. If it's down, anyone can finalize.

## The contract

[`StudioStake.sol`](contracts/StudioStake.sol) — one file, no owner/admin, no fee, no upgrade. Pull-payments throughout (`withdraw` returns confirmed slices, `claimPool` pays a finisher's bus share, `sweepEmptyPool` is a zero-finisher fallback so nothing strands), checks-effects-interactions everywhere, and `settleMany` skips already-settled stakes so the batch can't be griefed. Reviewed adversarially before deploy — **zero fund-safety findings**.

| | |
|---|---|
| **Network** | ARC testnet (chain `5042002`) |
| **Address** | [`0x9F171Ee048542257C24e07Db4DCC8DeF3bCf2506`](https://testnet.arcscan.app/address/0x9F171Ee048542257C24e07Db4DCC8DeF3bCf2506) |
| **Bond** | $1–5 native USDC, returned per confirmed lesson |
| **Verified** | yes — source on ArcScan |

## Run it locally

```bash
npm install
npm run dev            # http://localhost:3000
```

The tutor confirms attendance from their own wallet; the auditor's settle is permissionless (run `agent/auditor.mjs` from any funded key, or use the in-app button).

## Built with

Next.js 16 · React 19 · ethers v6 · Solidity 0.8.35 · Tailwind v4 — on ARC.

---

<p align="center"><sub>Show up, and the bond plays back.</sub></p>
