export function screenForPhase(phase) {
  if (phase === "config") return "config";
  if (phase === "pending" || phase === "linking") return "pending";
  return "ready";
}

/** Turns a scanner log line into a short step. `past` is the wording once a newer step exists. */
export function presentTraceLine(text) {
  const line = String(text || "");
  const seconds = line.match(/(\d+)s\s*$/)?.[1];
  const meta = seconds ? `${seconds}s` : "";
  if (line.startsWith("Waiting for a finger")) return step("wait", "Waiting for a finger", meta, "Waited");
  if (line.startsWith("Capture started")) return step("listen", "Listening");
  if (line === "Scanner ready") return step("ready", "Scanner ready");
  if (line === "Next capture scheduled") return step("again", "Next scan");
  if (line === "Finger detected") return step("down", "Reading the finger", "", "Finger seen");
  if (line === "Print captured") return step("saved", "Print saved");
  if (line === "Picture saved") return step("picture", "Picture saved");
  if (line.startsWith("Matched ")) {
    const name = line.slice("Matched ".length).replace(/ · score\b.*$/, "").trim();
    return step("match", name ? `Matched ${name}` : "Matched");
  }
  if (line.startsWith("No match")) return step("miss", "Not recognized");
  if (line.startsWith("No finger")) return step("idle", "No finger", meta);
  if (line.startsWith("Stopped a capture")) return step("trouble", "Took too long");
  if (line.startsWith("Scanner exited")) return step("again", "Trying again");
  if (line.startsWith("Scanner init failed")) return step("trouble", "Scanner not ready");
  if (!line) return null;
  return step("quiet", line);
}

function step(tone, title, meta = "", past = "") {
  return { tone, title, meta, past: past || title };
}

/**
 * now: the sensor is open and waiting, so this is the moment to place a finger.
 * hold: a finger is already down.
 * wait: the sensor is between captures or not ready yet.
 */
export function fingerCue(lines) {
  const steps = presentTrace(lines);
  const live = steps.at(-1);
  if (!live) return "wait";
  if (live.tone === "down") return "hold";
  let ready = false;
  for (const step of steps) {
    if (step.tone === "again" || step.tone === "listen" || step.tone === "trouble" || step.tone === "idle") ready = false;
    if (step.tone === "ready") ready = true;
  }
  if (ready && (live.tone === "wait" || live.tone === "ready")) return "now";
  return "wait";
}

/** Newest step keeps the live title. Earlier steps use the shorter past wording. */
export function presentTrace(lines) {
  const steps = (Array.isArray(lines) ? lines : []).map(presentTraceLine).filter(Boolean);
  return steps.map((item, index) => ({
    tone: item.tone,
    title: index === steps.length - 1 ? item.title : item.past,
    meta: item.meta,
    live: index === steps.length - 1,
  }));
}

/** Clock only. The name is already the card title, so it is not repeated here. */
export function matchTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
