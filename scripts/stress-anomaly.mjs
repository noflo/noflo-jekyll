// The noflo #35 update #22 stress methodology, re-run against the current
// engine: N consecutive builds of the parity fixture site, each output
// tree hashed (relative paths + content digests). Any difference between
// runs is the intermittent silent-drop signature; identical trees across
// every run is the determinism evidence.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { jekyll } from "../lib/Jekyll.js";

// The debug instrumentation perturbs the race it exists to catch (the
// variant rate clustered differently with it on), so it is opt-in: the
// clean runs rely on the engine's dispatch-time stranded reports instead
// of polled buffer snapshots
globalThis.__builderDebug = process.env.BUILDER_DEBUG === "1";

/**
 * Zero-overhead-in-flight probe: at network end, snapshot every
 * top-level process's buffered data IPs (scope + msg.path) — the
 * shutdown has not cleared the buffers yet because this listener
 * registers before asPromise's own end listener.
 * @param {number} run
 * @returns {(network: any) => void}
 */
const endSnapshot = (run) => (network) => {
  // The engine's no-silent-loss surface: every stranded report — closedown
  // residue, control-stream clobbers, unattached sends — printed as it
  // dispatches. Dispatch-time observation, no polling
  network.addEventListener("stranded", (event) => {
    const d = event.detail ?? {};
    console.log(`run ${run} STRANDED: ${JSON.stringify(d).slice(0, 200)}`);
  });
  // Minimal in-flight counters: the builder's msg arrivals and out
  // emissions, per path. Two listener calls per IP.
  /** @type {Record<string, number>} */
  const builderIn = {};
  /** @type {Record<string, number>} */
  const builderOut = {};
  const builderComp = network.processes?.builder?.component;
  if (builderComp) {
    builderComp.inPorts.ports.msg.addEventListener("ip", (event) => {
      if (event.detail.type !== "data") return;
      const p = event.detail.data?.path ?? "?";
      builderIn[p] = (builderIn[p] ?? 0) + 1;
    });
    // OutPort does not dispatch "ip" — tap the edge socket instead
    const outSocket = builderComp.outPorts.ports.out.sockets[0];
    outSocket?.addEventListener("ip", (event) => {
      if (event.detail.type !== "data") return;
      const p = event.detail.data?.path ?? "?";
      builderOut[p] = (builderOut[p] ?? 0) + 1;
    });
  }
  /** @type {Record<string, number>} */
  const writeIn = {};
  const writeComp = network.processes?.write?.component;
  if (writeComp) {
    const writeSocket = writeComp.inPorts.ports.msg.sockets[0];
    writeSocket?.addEventListener("ip", (event) => {
      if (event.detail.type !== "data") return;
      const p = event.detail.data?.path ?? "?";
      writeIn[p] = (writeIn[p] ?? 0) + 1;
    });
  }
  if (builderComp) {
    // Send-time content probe on the builder's emission edge: classify
    // each page message's site.posts entries as converted (C, rendered
    // HTML starts with a tag) or raw (R, markdown source) AT SEND TIME.
    // The Flowtrace's payload references serialize the final state at
    // export, so it cannot answer this — the probe reads the live
    // object in the dispatch
    /** @type {string[]} */
    const emissionReport = [];
    const emissionSocket = builderComp.outPorts.ports.out.sockets[0];
    emissionSocket?.addEventListener("ip", (event) => {
      if (event.detail.type !== "data") return;
      const d = event.detail.data;
      const posts = d?.site?.posts ?? [];
      const marks = posts
        .map((/** @type {{ content?: string }} */ p) =>
          typeof p.content === "string" && p.content.trimStart().startsWith("<") ? "C" : "R")
        .join("");
      emissionReport.push(`${String(d?.path ?? "?").split("/").slice(-2).join("/")}=${marks}`);
    });
    network.addEventListener("end", () => {
      const raw = emissionReport.filter((line) => line.includes("R"));
      if (raw.length) {
        console.log(`run ${run} RAW-EMISSIONS: ${raw.join("; ")}`);
      }
    });
    // At the component's closedown the buffers are intact: shutdown
    // clears them later. This answers "did the root pages strand in
    // the builder's buffer" with zero in-flight cost
    builderComp.addEventListener("closedown", () => {
      /** @type {string[]} */
      const held = [];
      const scoped = builderComp.inPorts.ports.msg.scopedBuffer ?? {};
      for (const [scope, buf] of Object.entries(scoped)) {
        for (const ip of buf ?? []) {
          if (ip.type !== "data") continue;
          held.push(`[${scope}] ${ip.data?.path ?? "?"}`);
        }
      }
      // The unscoped document partition lives in the plain buffer
      const plain = builderComp.inPorts.ports.msg.buffer ?? [];
      for (const ip of plain) {
        if (ip.type !== "data") continue;
        held.push(`[unscoped] ${ip.data?.path ?? "?"}`);
      }
      const storeKeys = Object.keys(builderComp.templates ?? {});
      const configPosts = builderComp.config?.posts?.length ?? "null";
      if (held.length) {
        console.log(`run ${run} BUILDER-CLOSEDOWN: ${held.length} documents still buffered: ${held.join(", ")}`);
      }
      console.log(`run ${run} BUILDER-STORE: templates=[${storeKeys.join(", ")}] config.posts=${configPosts}`);
    });
  }
  network.addEventListener("end", () => {
    /** @type {string[]} */
    const buffered = [];
    /**
     * Walk a network's processes' port buffers, descending into
     * subgraph components' inner networks.
     * @param {any} net
     * @param {string} prefix
     * @returns {void}
     */
    const walkNetwork = (net, prefix) => {
      for (const [id, process] of Object.entries(net.processes)) {
        const comp = process.component;
        const ports = comp?.inPorts?.ports ?? {};
        for (const [pname, port] of Object.entries(ports)) {
          const scoped = port.scopedBuffer ?? {};
          for (const [scope, buf] of Object.entries(scoped)) {
            for (const ip of buf ?? []) {
              if (ip.type !== "data") continue;
              const label = ip.data?.path ?? (typeof ip.data === "string" ? ip.data.slice(0, 50) : "?");
              buffered.push(`${prefix}${id}.${pname} [scope=${scope}] ${label}`);
            }
          }
          // The plain unscoped buffer: standing-config ports (scoped:false)
          // hold their streams here, invisible to the scopedBuffer walk
          for (const ip of port.buffer ?? []) {
            if (ip.type !== "data") continue;
            const label = ip.data?.path ?? ip.data?.name ?? (typeof ip.data === "string" ? ip.data.slice(0, 50) : "?");
            buffered.push(`${prefix}${id}.${pname} [unscoped] ${label}`);
          }
          for (const ip of port.iipBuffer ?? []) {
            if (ip.type !== "data") continue;
            const label = ip.data?.path ?? (typeof ip.data === "string" ? ip.data.slice(0, 50) : "?");
            buffered.push(`${prefix}${id}.${pname} [iip] ${label}`);
          }
        }
        if (comp?.network?.processes) {
          walkNetwork(comp.network, `${prefix}${id}/`);
        }
      }
    };
    walkNetwork(network, "");
    if (buffered.length) {
      console.log(`run ${run} END-SNAPSHOT: ${buffered.length} buffered data IPs at network end:`);
      for (const line of buffered) console.log(`   ${line}`);
    } else {
      console.log(`run ${run} END-SNAPSHOT: no buffered data IPs at network end`);
    }
    const expected = [
      "bar.html", "foo.html", "nocontent.html",
      "index.html", "index.txt", "baz/index.html",
      join(process.env.HOME ?? "", "x"), "page2",
    ];
    const rootIn = Object.entries(builderIn).filter(([p]) => !p.includes("blog/"));
    const rootOut = Object.entries(builderOut).filter(([p]) => !p.includes("blog/"));
    const rootWrite = Object.entries(writeIn).filter(([p]) => !p.includes("blog/"));
    console.log(`run ${run} BUILDER: in=${rootIn.length} emitted=${JSON.stringify(rootOut)} writeIn=${rootWrite.length}: ${JSON.stringify(rootWrite.map(([p]) => p.split("/").slice(-2).join("/")))}`);
  });
};



const source = join(import.meta.dirname, "..", "test", "fixtures", "source");
const RUNS = Number(process.env.RUNS ?? 15);

/**
 * Hash an output tree: sorted relative paths with content digests.
 * @param {string} root
 * @returns {{ count: number, hash: string }}
 */
function treeHash(root) {
  const entries = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(root, full);
      const digest = createHash("sha256")
        .update(readFileSync(full))
        .digest("hex")
        .slice(0, 16);
      entries.push(`${rel}:${digest}`);
    }
  };
  walk(root);
  entries.sort();
  return {
    count: entries.length,
    hash: createHash("sha256").update(entries.join("\n")).digest("hex"),
  };
}

let goodTree = null;
let goodHash = null;
let otherTree = null;
let otherHash = null;
let badTree = null;
const results = [];
for (let run = 1; run <= RUNS; run += 1) {
  const target = mkdtempSync(join(tmpdir(), "noflo-jekyll-stress-"));
  const start = Date.now();
  /** @type {{ written: string[], failed: string[] }} */
  const runStats = { written: [], failed: [] };
  const drainLog = [];
  const origError = console.error;
  console.error = (...args) => {
    const line = args.join(" ");
    if (line.includes("[DRAIN]")) drainLog.push(line);
  };
  try {
    /** @type {any} */
    let result;
    await Promise.race([
      (async () => {
        result = await jekyll(source, target, {
          networkCallback: endSnapshot(run),
        });
      })(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("the build did not close down within 60s")),
          60000,
        ),
      ),
    ]);
    const written = Array.isArray(result?.written) ? result.written : [];
    const failed = Array.isArray(result?.failed) ? result.failed : [];
    runStats.written = written.map((ip) => ip?.data?.path ?? ip?.data ?? "?");
    runStats.failed = failed.map(
      (ip) =>
        `${ip?.data?.path ?? "?"}: ${(ip?.data?.errors ?? [])
          .map((e) => e?.message ?? String(e))
          .join("; ") || JSON.stringify(ip?.data).slice(0, 80)}`,
    );
    console.error = origError;
  } catch (err) {
    console.error = origError;
    console.log(`run ${run}: FAILED — ${err.message}`);
    results.push({ run, failed: true });
    rmSync(target, { recursive: true, force: true });
    continue;
  }
  const { count, hash } = treeHash(target);
  if (count < 987) {
    const consumed = drainLog.filter((l) => l.includes("consumed")).map((l) => l.split("path=").pop());
    const started = drainLog.filter((l) => l.includes("start")).length;
    console.log(`run ${run} BAD — drains started=${started} consumed=${consumed.length}: ${consumed.map((c) => c.split("/").slice(-2).join("/")).join(", ")}`);
    const threw = drainLog.filter((l) => l.includes("threw"));
    if (threw.length) console.log(`   threw: ${threw.join(" | ")}`);
    console.log(`   full drain log:`);
    for (const line of drainLog) console.log(`     ${line}`);
  }
  if (count < 987 && goodTree) {
    const { execFileSync } = await import("node:child_process");
    let out = "";
    try {
      out = execFileSync("diff", ["-rq", goodTree, target], { encoding: "utf8" });
    } catch (e) {
      out = /** @type {any} */ (e).stdout ?? "";
    }
    console.log(`run ${run} BAD (${count} files) — missing/differing vs good:`);
    for (const line of out.split("\n").filter((l) => l.startsWith("Only in"))) {
      console.log(`   ${line.replace(goodTree, "GOOD")}`);
    }
  }
  if (count === 987) {
    if (goodTree && hash !== goodHash && !otherTree) {
      otherTree = target;
      otherHash = hash;
      // Content variants need the drain log too: the emission-time
      // config/record state is the Shape C discriminator
      console.log(`run ${run} CONTENT-VARIANT — emissions at drain time:`);
      for (const line of drainLog) console.log(`     ${line}`);
    } else if (!goodTree) {
      goodTree = target;
      goodHash = hash;
    } else {
      rmSync(target, { recursive: true, force: true });
    }
  } else if (count < 987 && !badTree) {
    badTree = target;
  } else {
    rmSync(target, { recursive: true, force: true });
  }
  results.push({ run, count, hash, ms: Date.now() - start });
  console.log(`run ${run}: ${count} files, tree ${hash.slice(0, 12)}, ${Date.now() - start}ms, written=${runStats.written.length} failed=${runStats.failed.length}`);
  if (runStats.failed.length) {
    console.log(`   failed: ${runStats.failed.join(" | ")}`);
  }
}

if (goodTree && otherTree) {
  const { execFileSync } = await import("node:child_process");
  let out = "";
  try {
    out = execFileSync("diff", ["-r", goodTree, otherTree], { encoding: "utf8" });
  } catch (e) {
    out = /** @type {any} */ (e).stdout ?? "";
  }
  console.log(`--- content diff (two 987-file trees: ${goodHash?.slice(0,8)} vs ${otherHash?.slice(0,8)}):`);
  console.log(out.split("\n").slice(0, 40).join("\n"));
  process.exit(0);
}
if (goodTree && badTree) {
  const { execFileSync } = await import("node:child_process");
  let out = "";
  try {
    out = execFileSync("diff", ["-rq", goodTree, badTree], { encoding: "utf8" });
  } catch (e) {
    out = /** @type {any} */ (e).stdout ?? String(e);
  }
  console.log("--- tree diff (good vs bad):");
  console.log(out);
}
if (goodTree && otherTree) {
  const { execFileSync } = await import("node:child_process");
  let out = "";
  try {
    out = execFileSync("diff", ["-r", goodTree, otherTree], { encoding: "utf8" });
  } catch (e) {
    out = /** @type {any} */ (e).stdout ?? "";
  }
  console.log(`--- content diff (two 987-file trees: ${goodHash?.slice(0,8)} vs ${otherHash?.slice(0,8)}):`);
  console.log(out.split("\n").slice(0, 40).join("\n"));
  process.exit(0);
}
if (goodTree && badTree) {
  const { execFileSync } = await import("node:child_process");
  let out = "";
  try {
    out = execFileSync("diff", ["-rq", goodTree, badTree], { encoding: "utf8" });
  } catch (e) {
    out = e.stdout ?? String(e);
  }
  console.log("--- tree diff (good vs bad):");
  console.log(out);
  process.exit(0);
}
const ok = results.filter((r) => !r.failed);
const hashes = new Set(ok.map((r) => r.hash));
const counts = new Set(ok.map((r) => r.count));
console.log(`---`);
console.log(`builds=${ok.length} failed=${results.length - ok.length}`);
console.log(`distinct tree hashes: ${hashes.size} | distinct file counts: ${[...counts].join(", ")}`);
if (hashes.size > 1) {
  console.log("NONDETERMINISM: the runs produced different output trees");
  for (const [i, r] of ok.entries()) {
    const prev = ok[i - 1];
    if (prev && r.hash !== prev.hash) {
      console.log(`  run ${prev.run} → run ${r.run}: ${prev.count} → ${r.count} files`);
    }
  }
  process.exitCode = 1;
} else if (ok.length) {
  console.log("deterministic: every build produced the identical output tree");
}
