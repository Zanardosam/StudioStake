import { ethers } from "ethers";
import { ARC_RPC } from "./arcNetwork";

// ─────────────────────────────────────────────────────────────
// StudioStake — a commitment bond against dropping out of a course.
// One deployed contract; the single source of truth.
// ─────────────────────────────────────────────────────────────
export const CONTRACT_ADDRESS = "0x9F171Ee048542257C24e07Db4DCC8DeF3bCf2506";

export const STUDIOSTAKE_ABI = [
  "function createCourse(string title, uint32 lessons, uint64 durationSecs) returns (uint256)",
  "function confirmAttend(uint256 id, address student)",
  "function confirmMany(uint256 id, address[] students)",
  "function cancelCourse(uint256 id)",
  "function openStake(uint256 id) payable",
  "function withdraw(uint256 id)",
  "function settleStake(uint256 id, address student)",
  "function settleMany(uint256 id, address[] students)",
  "function claimPool(uint256 id)",
  "function sweepEmptyPool(uint256 id)",
  "function courseCount() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function totalRefunded() view returns (uint256)",
  "function totalForfeited() view returns (uint256)",
  "function totalPoolPaid() view returns (uint256)",
  "function getCourse(uint256) view returns (tuple(uint256 id, address tutor, string title, uint32 lessons, uint32 enrolled, uint32 settledCount, uint64 startAt, uint64 deadline, uint256 forfeitPool, uint256 finisherWeight, uint8 status, bool poolSwept))",
  "function getStake(uint256, address) view returns (tuple(uint256 stake, uint256 slice, uint32 attended, uint32 released, uint8 status, bool poolPaid))",
  "function stakersOf(uint256) view returns (address[])",
  "function coursesTaught(address) view returns (uint256[])",
  "function coursesStaked(address) view returns (uint256[])",
  "function withdrawable(uint256, address) view returns (uint256)",
  "function pendingDividend(uint256, address) view returns (uint256)",
  "event CourseCreated(uint256 indexed id, address indexed tutor, string title, uint32 lessons, uint64 deadline)",
  "event Staked(uint256 indexed id, address indexed student, uint256 stake, uint256 slice)",
  "event Confirmed(uint256 indexed id, address indexed student, uint32 lesson, address by)",
  "event Withdrawn(uint256 indexed id, address indexed student, uint256 amount)",
  "event Settled(uint256 indexed id, address indexed student, bool finisher, uint256 refunded, uint256 forfeited)",
  "event PoolClaimed(uint256 indexed id, address indexed student, uint256 amount)",
];

export const OPEN = 1, CANCELED = 2;
export const S_ACTIVE = 1, S_FORFEITED = 2, S_FINISHED = 3;
export const MIN_STAKE = ethers.parseEther("1");
export const MAX_STAKE = ethers.parseEther("5");
export const MAX = 60;

export interface Stake {
  student: string;
  stake: bigint;
  slice: bigint;
  attended: number;
  released: number;
  status: number;
  poolPaid: boolean;
}

export interface Course {
  id: number;
  tutor: string;
  title: string;
  lessons: number;
  enrolled: number;
  settledCount: number;
  startAt: number;
  deadline: number;
  forfeitPool: bigint;
  finisherWeight: bigint;
  status: number;
  poolSwept: boolean;
  stakers: Stake[];
}

export interface Stats { courses: number; staked: bigint; refunded: bigint; forfeited: bigint; poolPaid: bigint; }
export const EMPTY_STATS: Stats = { courses: 0, staked: 0n, refunded: 0n, forfeited: 0n, poolPaid: 0n };

export function readProvider() { return new ethers.JsonRpcProvider(ARC_RPC); }
export function readContract(p?: ethers.Provider) { return new ethers.Contract(CONTRACT_ADDRESS, STUDIOSTAKE_ABI, p ?? readProvider()); }
export function hasContract(): boolean { return /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS); }

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const s = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    s.forEach((r) => { if (r.status === "fulfilled") out.push(r.value); });
  }
  return out;
}

type RawStake = { stake: bigint; slice: bigint; attended: bigint; released: bigint; status: bigint; poolPaid: boolean };
function toStake(student: string, s: RawStake): Stake {
  return { student, stake: s.stake, slice: s.slice, attended: Number(s.attended), released: Number(s.released), status: Number(s.status), poolPaid: s.poolPaid };
}

export async function fetchCourse(id: number, contract?: ethers.Contract, withStakers = true): Promise<Course | null> {
  const c = contract ?? readContract();
  try {
    const r = await c.getCourse(id);
    if (r.tutor === ethers.ZeroAddress) return null;
    let stakers: Stake[] = [];
    if (withStakers && Number(r.enrolled) > 0) {
      const addrs: string[] = await c.stakersOf(id);
      stakers = await mapLimit(addrs.slice(0, 200), 8, async (a) => toStake(a, await c.getStake(id, a)));
    }
    return {
      id: Number(r.id), tutor: r.tutor, title: r.title, lessons: Number(r.lessons),
      enrolled: Number(r.enrolled), settledCount: Number(r.settledCount),
      startAt: Number(r.startAt), deadline: Number(r.deadline),
      forfeitPool: r.forfeitPool, finisherWeight: r.finisherWeight,
      status: Number(r.status), poolSwept: r.poolSwept, stakers,
    };
  } catch { return null; }
}

export async function fetchStats(contract?: ethers.Contract): Promise<Stats> {
  const c = contract ?? readContract();
  const [courses, staked, refunded, forfeited, poolPaid] = await Promise.all([
    c.courseCount(), c.totalStaked(), c.totalRefunded(), c.totalForfeited(), c.totalPoolPaid(),
  ]);
  return { courses: Number(courses), staked, refunded, forfeited, poolPaid };
}

export async function fetchFeed(count: number, contract?: ethers.Contract): Promise<Course[]> {
  const c = contract ?? readContract();
  const total = Number(await c.courseCount());
  if (total === 0) return [];
  const ids: number[] = [];
  for (let i = total; i >= 1 && ids.length < count; i--) ids.push(i);
  const out = await mapLimit(ids, 6, (id) => fetchCourse(id, c));
  return out.filter((x): x is Course => !!x).sort((a, b) => b.id - a.id);
}

export async function fetchCoursesOf(addr: string, which: "taught" | "staked", contract?: ethers.Contract): Promise<Course[]> {
  const c = contract ?? readContract();
  const ids: bigint[] = which === "taught" ? await c.coursesTaught(addr) : await c.coursesStaked(addr);
  const out = await mapLimit(ids.slice(-MAX).map(Number), 6, (id) => fetchCourse(id, c));
  return out.filter((x): x is Course => !!x).sort((a, b) => b.id - a.id);
}

// ── helpers ──────────────────────────────────────────────────
export function shortAddr(a: string, lead = 6, tail = 4): string { return a ? `${a.slice(0, lead)}…${a.slice(-tail)}` : ""; }

export function fmtUsdc(wei: bigint, dp = 2): string {
  const n = parseFloat(ethers.formatEther(wei));
  if (n === 0) return "0";
  if (n < 0.01) { const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); return s === "0" ? "<0.01" : s; }
  const s = n.toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** now = client-seeded unix seconds; 0 (SSR / first render) is treated as "not ended" to avoid hydration drift. */
export function courseEnded(c: Course, now: number): boolean { return now > 0 && now >= c.deadline; }
export function fullySettled(c: Course): boolean { return c.enrolled > 0 && c.settledCount === c.enrolled; }

/** Per-stake derived money state. */
export function refundedSoFar(s: Stake): bigint { return BigInt(s.attended) * s.slice; }
export function burnedSoFar(s: Stake, lessons: number): bigint { return BigInt(lessons - s.attended) * s.slice; }
export function withdrawableNow(s: Stake): bigint { return BigInt(s.attended - s.released) * s.slice; }

export function timeLeft(deadline: number, now: number): string {
  if (now <= 0) return "…";
  let diff = deadline - now;
  if (diff <= 0) return "ended";
  const d = Math.floor(diff / 86400); diff -= d * 86400;
  const h = Math.floor(diff / 3600); diff -= h * 3600;
  const m = Math.floor(diff / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const s = diff - m * 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
