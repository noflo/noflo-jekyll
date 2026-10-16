// Trace the real e2e path: jekyll() via asPromise, dumping the Flowtrace
// activation walk when the build hangs or completes.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EVENT_TYPE, Flowtrace } from "@noflo/noflo";
import { jekyll } from "../lib/Jekyll.js";

const root = join(import.meta.dirname, "..");
const fixtureDir = join(root, "test", "fixtures", "site");
const target = join(fixtureDir, "..", "target-trace");

const trace = new Flowtrace({ runtimeMetadata: { type: "jekyll-e2e-trace" } });
let done = false;
// Hard exit: the network holds the event loop when it hangs; register
// before the await so it survives an unsettled top-level await
setTimeout(() => {
  if (!done) console.error("HARD TIMEOUT: asPromise never resolved within 30s");
  dump();
}, 30000);
try {
  const result = await jekyll(fixtureDir, target, { flowtrace: trace });
  done = true;
  console.error("BUILD COMPLETED:", JSON.stringify(result).slice(0, 200));
} catch (err) {
  done = true;
  console.error("BUILD FAILED:", err);
}
if (done) dump();

function dump() {
  const state = trace.toJSON();
  const typeNames = {
    [EVENT_TYPE.DATA]: "DATA",
    [EVENT_TYPE.BEGIN_BRACKET]: "OPEN",
    [EVENT_TYPE.END_BRACKET]: "CLOSE",
    [EVENT_TYPE.ERROR]: "ERROR",
    [EVENT_TYPE.CONSOLE]: "CONSOLE",
    [EVENT_TYPE.LIFECYCLE]: "LIFECYCLE",
    [EVENT_TYPE.ACTIVATION_BEGIN]: "ACT_BEGIN",
    [EVENT_TYPE.ACTIVATION_END]: "ACT_END",
  };

  const load = new Map();
  const last = new Map();
  for (const [, eventType, payload] of state.chunks) {
    if (eventType === EVENT_TYPE.ACTIVATION_BEGIN || eventType === EVENT_TYPE.ACTIVATION_END) {
      const [node, value] = payload;
      load.set(node, value);
      last.set(node, eventType);
    }
  }
  console.error("\n=== Final loads ===");
  for (const [node, value] of [...load.entries()].sort((a, b) => b[1] - a[1])) {
    const lastEv = last.get(node) === EVENT_TYPE.ACTIVATION_BEGIN ? "ACT_BEGIN" : "ACT_END";
    if (value > 0) console.error(`  ${node}: load=${value} last=${lastEv}`);
  }
  console.error(`\n=== ${state.chunks.length} events (last 60) ===`);
  for (const [ts, eventType, payload, meta] of state.chunks.slice(-60)) {
    const type = typeNames[eventType] ?? `ev:${eventType}`;
    const sub = meta?.subgraph ? ` @${meta.subgraph.join("/")}` : "";
    let loc = "";
    if (meta?.src) loc += ` ${meta.src.node}:${meta.src.port} ->`;
    if (meta?.tgt) loc += ` ${meta.tgt.node}:${meta.tgt.port}`;
    let data = JSON.stringify(payload);
    if (data.length > 80) data = `${data.slice(0, 80)}…`;
    console.error(`  +${ts}ms ${type}${sub}${loc} ${data}`);
  }
  writeFile(join(root, ".flowtrace-e2e.json"), JSON.stringify(state, null, 2)).then(() => {
    process.exit(0);
  });
}
