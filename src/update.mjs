import semver from "semver";

export function updaterChannel({ configuredChannel, currentVersion } = {}) {
  const configured = configuredChannel === "nightly" ? "nightly" : "stable";
  const version = String(currentVersion || "");
  return configured === "nightly" || /-nightly(?:\.|$)/i.test(version) ? "nightly" : "stable";
}

export function updaterShouldOffer({ currentVersion, nextVersion, channel } = {}) {
  const current = semver.parse(String(currentVersion || ""));
  const next = semver.parse(String(nextVersion || ""));
  if (!current || !next || !semver.gt(next, current)) return false;
  if (channel !== "nightly" && next.prerelease.length > 0) return false;
  return true;
}

export function updaterErrorDetails(error) {
  const rawMessage = error?.message || (typeof error === "string" ? error : "") || "Unknown updater error";
  return {
    message: String(rawMessage)
      .split(/\r?\n/, 1)[0]
      .slice(0, 600),
    code: error?.code || "",
    statusCode: error?.statusCode || 0,
  };
}

export function updaterInfoDetails(info) {
  return {
    version: String(info?.version || ""),
    releaseName: String(info?.releaseName || "").slice(0, 200),
    files: Array.isArray(info?.files) ? info.files.length : 0,
  };
}
