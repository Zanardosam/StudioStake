# StudioStake — liner notes

> A desk where a student's deposit is a fader. The tutor rides it up one notch
> per attended lesson; whatever never gets pushed up at lights-out drains to the
> bus and gets split between the people who ran the whole take clean.

These are the engineer's notes for the session: what each channel does, where the
signal goes, and which two operators sit at the board.

---

## Tracking the input

A tutor opens a course — a title, a lesson count `N` (between 2 and 60), and a
window (1 hour up to 90 days). `createCourse(title, lessons, durationSecs)` lays
down an empty multitrack; the clock starts immediately and the deadline is set.

A student patches in by committing a bond of **1 to 5 native USDC** through
`openStake(id)` (payable). The contract splits that bond on the spot into `N`
equal **slices** — `slice = stake / lessons`. A $3 bond on a 12-lesson course is
twelve $0.25 slices sitting on the channel, all of it locked, none of it the
tutor's to touch. The tutor cannot patch into their own board (`tutor can't
stake`), and you only get one channel per course (`already staked`).

## Signal path

The level on your channel only moves one way, and only the tutor's hand moves it:

1. **Confirm.** After a lesson the tutor calls `confirmAttend(id, student)` — or
   `confirmMany(id, students[])` to ride the whole cohort up a notch in a single
   transaction. No money moves here; it just bumps `attended` by one. Only the
   course's own tutor can do it, only before the deadline.
2. **Return.** Each confirmed lesson makes one slice yours to pull. Call
   `withdraw(id)` whenever you like and the contract sends `(attended − released)
   × slice` straight to your wallet, then marks those slices released. Pull early,
   pull at the end — it's your level, your timing.
3. **Lights-out.** At the deadline the channel freezes wherever the tutor left it.

So a clean run is just your own money handed back to you, a quarter at a time, in
the order you earned it.

## Channels & the return bus

Anything that never got pushed up before the deadline doesn't vanish — it routes
to the **return bus**. Settlement is permissionless and runs after the clock:
`settleStake(id, student)` for one channel, `settleMany(id, students[])` for the
whole desk (already-settled channels are skipped, so nobody can grief the batch by
front-running it).

For each channel `_doSettle` does the split:

- Confirmed lessons (`attended × slice`) were always withdrawable and stay yours.
- Unconfirmed lessons (`(lessons − attended) × slice`) forfeit into the course
  `forfeitPool` — the return bus.
- A channel pushed all the way to `N` is flagged a **finisher** (`S_FINISHED`)
  and its bond is added to `finisherWeight`. Anything short is `S_FORFEITED`.

Once every channel is settled, finishers call `claimPool(id)` and split the bus
**pro-rata by bond size**: `dividend = forfeitPool × yourStake / finisherWeight`.
Run the full take clean and you get 100% of your bond back *plus* a cut of
everyone who bailed. The ledger marks a clean channel **THRU** and a short one
**DROP**; live channels read **LOCKED**.

Two safety patches on the bus:

- Every payout (`withdraw`, `claimPool`, `sweepEmptyPool`) is pull-based and
  writes its state before it sends, so a reverting recipient can never jam the
  board for everyone else.
- `sweepEmptyPool(id)` is the dead-channel fallback: if a course closes with a
  forfeit pool but *zero* finishers, the tutor can route that orphaned balance out
  rather than leave it stranded on the bus forever.

## Why this only mixes down on Arc

Read the levels: the unit of work on this desk is a single $0.25 slice. A
12-lesson cohort of thirty students is several hundred sub-dollar movements per
season — confirms that flip a slice live, returns that hand a quarter back, a
settlement pass that sorts cents into THRU and DROP.

That granularity is the product, and it's exactly what dies on a chain with a
separate, floating gas token. Returning a $0.25 slice while the transaction fee
eats $0.30 of some volatile coin isn't a refund, it's a loss you pay to issue —
and the obvious "fix," batching twelve weeks into one fat payout, deletes the very
per-lesson feedback the bond exists to create. Arc removes the trap two ways: fees
are paid in the same USDC that the bond, the slice, and the bus are denominated
in, so a return is always net-positive down to the cent; and finality is sub-second,
so an operator can sit there flipping single slices all season without batching to
survive. Bond, slice, return, bus, and fee are one number on one meter. That's the
only reason a per-lesson micro-refund is a sane thing to automate here at all.

## The two operators

Both are command-line scripts you run from a funded key. Neither is a hosted
service and there is **no x402 endpoint or server route** in this repo — the desk
is fully usable by hand from the app, and these just automate the boring passes.

- **Tutor-agent** — [`agent/tutor.mjs`](agent/tutor.mjs). Runs from the *tutor's*
  key (it checks, and bails if you aren't the course's tutor). After a lesson it
  calls `confirmMany` to ride every current staker up one notch in a single
  transaction. Given no argument it confirms the whole roster; pass a comma list
  to confirm a subset.
- **Auditor-agent** — [`agent/auditor.mjs`](agent/auditor.mjs). Holds no special
  power whatsoever. After the deadline it reads public state, prints a got-back
  vs. burned tally per channel, and calls the permissionless `settleMany` to
  finalize the bus. If it never runs, anyone — including the in-app button — can
  settle instead.

## Patch bay

```
deployment   Arc testnet · chain 5042002
contract     StudioStake.sol  (Solidity ^0.8.20, no owner / no fee / no upgrade)
address      0x9F171Ee048542257C24e07Db4DCC8DeF3bCf2506
arcscan      https://testnet.arcscan.app/address/0x9F171Ee048542257C24e07Db4DCC8DeF3bCf2506
live desk    https://studiostake-arc.vercel.app
bond         1–5 native USDC, returned per confirmed lesson (slice = bond / N)
lessons      N between 2 and 60 · window 1 hour to 90 days
```

The address in [`lib/studiostake.ts`](lib/studiostake.ts) is the single source of
truth; the front end reads every level straight off it.

## Powering up the board locally

```bash
npm install
npm run dev          # http://localhost:3000
```

Confirm attendance from the tutor wallet; settle from any funded key after the
deadline (or just press the in-app settle button). To drive the operators:

```bash
AGENT_PRIVATE_KEY=0x… CONTRACT=0x9F17…2506 COURSE=1 node agent/tutor.mjs
AGENT_PRIVATE_KEY=0x… CONTRACT=0x9F17…2506 COURSE=1 node agent/auditor.mjs
```

— Sam Zanardo · [Zanardosam](https://github.com/Zanardosam)
