const fs = require("fs");
const path = require("path");
const solc = require("solc");

const source = fs.readFileSync(path.join(__dirname, "../contracts/StudioStake.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "StudioStake.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors) {
  let fatal = false;
  for (const e of out.errors) {
    console.log(e.formattedMessage);
    if (e.severity === "error") fatal = true;
  }
  if (fatal) process.exit(1);
}

const c = out.contracts["StudioStake.sol"]["StudioStake"];
const shortVersion = "v" + solc.version().replace(/\.Emscripten.*$/, "");
const build = {
  contractName: "StudioStake",
  compilerVersion: shortVersion,
  evmVersion: "paris",
  optimizer: { enabled: true, runs: 200 },
  abi: c.abi,
  bytecode: "0x" + c.evm.bytecode.object,
  source,
};
fs.writeFileSync(path.join(__dirname, "../lib/studiostake_build.json"), JSON.stringify(build, null, 2));
console.log("compiler:", shortVersion, "| bytecode:", build.bytecode.length, "| abi:", c.abi.length);
console.log("→ lib/studiostake_build.json");
