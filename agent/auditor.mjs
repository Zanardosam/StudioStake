// StudioStake auditor-agent — the permissionless tallier/settler.
// Holds NO special power. After a course deadline it reads public state, prints each
// student's got-back-vs-burned tally, and calls the permissionless settleMany to finalize
// forfeitures + the finisher denominator. If the agent is down, anyone can do this.
//   AGENT_PRIVATE_KEY=0x.. CONTRACT=0x.. COURSE=1 node agent/auditor.mjs
import { JsonRpcProvider, Wallet, Contract, formatEther } from "ethers";

const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const CONTRACT = process.env.CONTRACT, PK = process.env.AGENT_PRIVATE_KEY, COURSE = process.env.COURSE;
if (!CONTRACT || !PK || !COURSE) { console.error("set CONTRACT, AGENT_PRIVATE_KEY, COURSE"); process.exit(1); }

const ABI = [
  "function getCourse(uint256) view returns (tuple(uint256 id,address tutor,string title,uint32 lessons,uint32 enrolled,uint32 settledCount,uint64 startAt,uint64 deadline,uint256 forfeitPool,uint256 finisherWeight,uint8 status,bool poolSwept))",
  "function stakersOf(uint256) view returns (address[])",
  "function getStake(uint256,address) view returns (tuple(uint256 stake,uint256 slice,uint32 attended,uint32 released,uint8 status,bool poolPaid))",
  "function settleMany(uint256 id, address[] students)",
];
const wallet = new Wallet(PK, new JsonRpcProvider(RPC, 5042002));
const c = new Contract(CONTRACT, ABI, wallet);

const course = await c.getCourse(COURSE);
const now = Math.floor(Date.now() / 1000);
console.log(`auditor-agent ${wallet.address} · course ${COURSE} "${course.title}" · N=${course.lessons}`);
if (now < Number(course.deadline)) { console.log(`deadline not reached (${Number(course.deadline) - now}s left) — nothing to settle`); process.exit(0); }

const students = await c.stakersOf(COURSE);
const N = Number(course.lessons);
console.log("\nTALLY  student                       lesson   back      burned");
for (const a of students) {
  const s = await c.getStake(COURSE, a);
  const back = (BigInt(s.attended) * s.slice);
  const burn = (BigInt(N - Number(s.attended)) * s.slice);
  console.log(`       ${a}  ${s.attended}/${N}     +$${(+formatEther(back)).toFixed(2)}    -$${(+formatEther(burn)).toFixed(2)}`);
}

const unsettled = [];
for (const a of students) { const s = await c.getStake(COURSE, a); if (Number(s.status) === 1) unsettled.push(a); }
if (!unsettled.length) { console.log("\nall stakes already settled."); process.exit(0); }

console.log(`\nsettling ${unsettled.length} stake(s)…`);
const tx = await c.settleMany(COURSE, unsettled);
const rc = await tx.wait();
console.log(`✓ settled · ${rc.hash} · finishers now share the forfeit pool ($${(+formatEther(course.forfeitPool)).toFixed(2)}+)`);
