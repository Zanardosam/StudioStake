// StudioStake tutor-agent — the attendance confirmer.
// After each video lesson it confirms everyone who showed up, one cheap USDC-gas tx
// that unlocks each student's ~$0.25 slice. Runs from the TUTOR key (only the tutor may confirm).
//   AGENT_PRIVATE_KEY=0x.. CONTRACT=0x.. COURSE=1 node agent/tutor.mjs [student,student,...]
// With no student list it confirms every current staker (+1 lesson each).
import { JsonRpcProvider, Wallet, Contract } from "ethers";

const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const CONTRACT = process.env.CONTRACT, PK = process.env.AGENT_PRIVATE_KEY, COURSE = process.env.COURSE;
if (!CONTRACT || !PK || !COURSE) { console.error("set CONTRACT, AGENT_PRIVATE_KEY, COURSE"); process.exit(1); }

const ABI = [
  "function confirmMany(uint256 id, address[] students)",
  "function stakersOf(uint256) view returns (address[])",
  "function getCourse(uint256) view returns (tuple(uint256 id,address tutor,string title,uint32 lessons,uint32 enrolled,uint32 settledCount,uint64 startAt,uint64 deadline,uint256 forfeitPool,uint256 finisherWeight,uint8 status,bool poolSwept))",
];
const wallet = new Wallet(PK, new JsonRpcProvider(RPC, 5042002));
const c = new Contract(CONTRACT, ABI, wallet);

const course = await c.getCourse(COURSE);
if (course.tutor.toLowerCase() !== wallet.address.toLowerCase()) { console.error(`agent ${wallet.address} is not the tutor of course ${COURSE}`); process.exit(1); }

const arg = process.argv[2];
const students = arg ? arg.split(",").map((s) => s.trim()) : await c.stakersOf(COURSE);
if (!students.length) { console.log("no students to confirm"); process.exit(0); }

console.log(`tutor-agent ${wallet.address} · course ${COURSE} "${course.title}" · confirming ${students.length} student(s)…`);
const tx = await c.confirmMany(COURSE, students);
const rc = await tx.wait();
console.log(`✓ confirmed +1 lesson for ${students.length} student(s) in one tx · ${rc.hash}`);
