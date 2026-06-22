// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title StudioStake — a commitment bond against dropping out of a course
/// @notice A tutor opens a course of N lessons. A student locks a small bond of native USDC (1-5) before
///         it starts; the bond splits into N equal slices. For every lesson the tutor confirms the student
///         attended, that lesson's slice becomes withdrawable — your own money flowing back, a slice at a
///         time. Lessons left unconfirmed at the deadline forfeit their slice into a course pool, which is
///         shared pro-rata among the students who finished ALL N lessons (a strict finisher). Quitters
///         literally fund the people who beat dropout. No platform, no fee, no owner; every payout is
///         pull-based so the course can never be locked by a reverting recipient. Built for ARC: the slices
///         are micro ($3 / 12 lessons = $0.25 each), settled in native USDC by autonomous agents — per-lesson
///         micro-refunds that only make economic sense where USDC is the gas and finality is sub-second.
contract StudioStake {
    uint8 public constant OPEN = 1;
    uint8 public constant CANCELED = 2;

    uint8 public constant S_ACTIVE = 1;
    uint8 public constant S_FORFEITED = 2;
    uint8 public constant S_FINISHED = 3;

    uint256 public constant MIN_STAKE = 1 ether;     // native USDC, 18 decimals
    uint256 public constant MAX_STAKE = 5 ether;
    uint32 public constant MIN_LESSONS = 2;
    uint32 public constant MAX_LESSONS = 60;
    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 90 days;
    uint256 public constant MAX_TITLE = 80;

    struct Course {
        uint256 id;
        address tutor;
        string title;
        uint32 lessons;
        uint32 enrolled;
        uint32 settledCount;
        uint64 startAt;
        uint64 deadline;
        uint256 forfeitPool;     // total forfeited slices, to be shared by finishers
        uint256 finisherWeight;  // sum of finishers' stakes (pool denominator)
        uint8 status;
        bool poolSwept;          // zero-finisher fallback already paid to tutor
    }

    struct Stake {
        uint256 stake;     // the bond
        uint256 slice;     // stake / lessons
        uint32 attended;   // lessons the tutor has confirmed
        uint32 released;   // slices already withdrawn
        uint8 status;      // ACTIVE / FORFEITED / FINISHED
        bool poolPaid;     // finisher already claimed their pool dividend
    }

    uint256 public courseCount;
    uint256 public totalStaked;     // lifetime bonds locked
    uint256 public totalRefunded;   // lifetime slices returned to students
    uint256 public totalForfeited;  // lifetime slices forfeited into pools
    uint256 public totalPoolPaid;   // lifetime pool dividends + sweeps paid out

    mapping(uint256 => Course) public courses;
    mapping(uint256 => mapping(address => Stake)) public stakes;
    mapping(uint256 => address[]) private _stakers;
    mapping(address => uint256[]) private _taught;
    mapping(address => uint256[]) private _staked;

    event CourseCreated(uint256 indexed id, address indexed tutor, string title, uint32 lessons, uint64 deadline);
    event Staked(uint256 indexed id, address indexed student, uint256 stake, uint256 slice);
    event Confirmed(uint256 indexed id, address indexed student, uint32 lesson, address by);
    event Withdrawn(uint256 indexed id, address indexed student, uint256 amount);
    event Settled(uint256 indexed id, address indexed student, bool finisher, uint256 refunded, uint256 forfeited);
    event PoolClaimed(uint256 indexed id, address indexed student, uint256 amount);
    event PoolSwept(uint256 indexed id, uint256 amount);
    event Canceled(uint256 indexed id);

    // ── tutor ───────────────────────────────────────────────
    function createCourse(string calldata title, uint32 lessons, uint64 durationSecs) external returns (uint256) {
        require(bytes(title).length > 0 && bytes(title).length <= MAX_TITLE, "bad title");
        require(lessons >= MIN_LESSONS && lessons <= MAX_LESSONS, "bad lessons");
        require(durationSecs >= MIN_DURATION && durationSecs <= MAX_DURATION, "bad duration");

        uint256 id = ++courseCount;
        Course storage c = courses[id];
        c.id = id;
        c.tutor = msg.sender;
        c.title = title;
        c.lessons = lessons;
        c.startAt = uint64(block.timestamp);
        c.deadline = uint64(block.timestamp) + durationSecs;
        c.status = OPEN;

        _taught[msg.sender].push(id);
        emit CourseCreated(id, msg.sender, title, lessons, c.deadline);
        return id;
    }

    /// @notice Confirm a student attended one more lesson (the tutor-agent calls this). No money moves.
    function confirmAttend(uint256 id, address student) public {
        Course storage c = courses[id];
        require(c.tutor == msg.sender, "not tutor");
        require(c.status == OPEN, "not open");
        require(block.timestamp < c.deadline, "course ended");
        Stake storage s = stakes[id][student];
        require(s.status == S_ACTIVE && s.stake > 0, "no active stake");
        require(s.attended < c.lessons, "all confirmed");
        s.attended += 1;
        emit Confirmed(id, student, s.attended, msg.sender);
    }

    /// @notice Confirm a whole cohort in one tx (cheap on Arc; the agent controls the batch size).
    function confirmMany(uint256 id, address[] calldata students) external {
        for (uint256 i = 0; i < students.length; i++) confirmAttend(id, students[i]);
    }

    /// @notice Scrap a course — only while it holds no stakes (the tutor is powerless over locked bonds).
    function cancelCourse(uint256 id) external {
        Course storage c = courses[id];
        require(c.tutor == msg.sender, "not tutor");
        require(c.status == OPEN, "not open");
        require(c.enrolled == 0, "has stakes");
        c.status = CANCELED;
        emit Canceled(id);
    }

    // ── student ─────────────────────────────────────────────
    function openStake(uint256 id) external payable {
        Course storage c = courses[id];
        require(c.status == OPEN, "not open");
        require(block.timestamp < c.deadline, "course ended");
        require(msg.sender != c.tutor, "tutor can't stake");
        require(msg.value >= MIN_STAKE && msg.value <= MAX_STAKE, "stake 1-5");
        Stake storage s = stakes[id][msg.sender];
        require(s.stake == 0, "already staked");

        s.stake = msg.value;
        s.slice = msg.value / c.lessons;
        s.status = S_ACTIVE;
        c.enrolled += 1;
        _stakers[id].push(msg.sender);
        _staked[msg.sender].push(id);
        totalStaked += msg.value;
        emit Staked(id, msg.sender, msg.value, s.slice);
    }

    /// @notice Withdraw the slices of attended-and-confirmed lessons (pull; withdraw any time to amortize gas).
    function withdraw(uint256 id) external {
        Stake storage s = stakes[id][msg.sender];
        require(s.stake > 0, "no stake");
        uint256 amount = uint256(s.attended - s.released) * s.slice;
        require(amount > 0, "nothing to withdraw");
        s.released = s.attended;          // effects before interaction
        totalRefunded += amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(id, msg.sender, amount);
    }

    // ── settlement (after the deadline) ─────────────────────
    /// @notice Finalize one stake after the deadline — permissionless (the auditor-agent runs it).
    ///         Unattended slices forfeit to the pool; a perfect attender is marked a finisher.
    function settleStake(uint256 id, address student) external {
        Course storage c = courses[id];
        require(c.status == OPEN, "not open");
        require(block.timestamp >= c.deadline, "still open");
        Stake storage s = stakes[id][student];
        require(s.status == S_ACTIVE && s.stake > 0, "not settleable");
        _doSettle(c, s, id, student);
    }

    /// @notice Batch settle — already-settled stakes are skipped (robust against front-run griefing).
    function settleMany(uint256 id, address[] calldata students) external {
        Course storage c = courses[id];
        require(c.status == OPEN, "not open");
        require(block.timestamp >= c.deadline, "still open");
        for (uint256 i = 0; i < students.length; i++) {
            Stake storage s = stakes[id][students[i]];
            if (s.status == S_ACTIVE && s.stake > 0) _doSettle(c, s, id, students[i]);
        }
    }

    function _doSettle(Course storage c, Stake storage s, uint256 id, address student) private {
        uint256 forfeited = uint256(c.lessons - s.attended) * s.slice;
        uint256 refunded = uint256(s.attended) * s.slice;
        if (s.attended == c.lessons) {
            s.status = S_FINISHED;
            c.finisherWeight += s.stake;
        } else {
            s.status = S_FORFEITED;
            c.forfeitPool += forfeited;
            totalForfeited += forfeited;
        }
        c.settledCount += 1;
        emit Settled(id, student, s.status == S_FINISHED, refunded, forfeited);
    }

    /// @notice A finisher claims their pro-rata share of the forfeited pool (after every stake is settled).
    function claimPool(uint256 id) external {
        Course storage c = courses[id];
        require(c.enrolled > 0 && c.settledCount == c.enrolled, "not fully settled");
        require(c.finisherWeight > 0, "no finishers");
        Stake storage s = stakes[id][msg.sender];
        require(s.status == S_FINISHED, "not a finisher");
        require(!s.poolPaid, "already claimed");
        uint256 dividend = (c.forfeitPool * s.stake) / c.finisherWeight;
        s.poolPaid = true;                // effects before interaction
        require(dividend > 0, "nothing to claim");
        totalPoolPaid += dividend;
        (bool ok, ) = payable(msg.sender).call{value: dividend}("");
        require(ok, "claim failed");
        emit PoolClaimed(id, msg.sender, dividend);
    }

    /// @notice Zero-finisher fallback: if nobody finished, the pool routes to the tutor (never stranded).
    function sweepEmptyPool(uint256 id) external {
        Course storage c = courses[id];
        require(c.tutor == msg.sender, "not tutor");
        require(c.enrolled > 0 && c.settledCount == c.enrolled, "not fully settled");
        require(c.finisherWeight == 0 && !c.poolSwept && c.forfeitPool > 0, "not sweepable");
        c.poolSwept = true;
        uint256 amount = c.forfeitPool;
        totalPoolPaid += amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "sweep failed");
        emit PoolSwept(id, amount);
    }

    // ── views ───────────────────────────────────────────────
    function getCourse(uint256 id) external view returns (Course memory) { return courses[id]; }
    function getStake(uint256 id, address student) external view returns (Stake memory) { return stakes[id][student]; }
    function stakersOf(uint256 id) external view returns (address[] memory) { return _stakers[id]; }
    function coursesTaught(address who) external view returns (uint256[] memory) { return _taught[who]; }
    function coursesStaked(address who) external view returns (uint256[] memory) { return _staked[who]; }

    function withdrawable(uint256 id, address student) external view returns (uint256) {
        Stake storage s = stakes[id][student];
        return uint256(s.attended - s.released) * s.slice;
    }

    /// @notice Preview a finisher's pool dividend (0 until the course is fully settled).
    function pendingDividend(uint256 id, address student) external view returns (uint256) {
        Course storage c = courses[id];
        Stake storage s = stakes[id][student];
        if (c.enrolled == 0 || c.settledCount != c.enrolled || c.finisherWeight == 0) return 0;
        if (s.status != S_FINISHED || s.poolPaid) return 0;
        return (c.forfeitPool * s.stake) / c.finisherWeight;
    }
}
