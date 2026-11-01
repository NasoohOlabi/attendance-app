export function updaterChannel({ configuredChannel, currentVersion } = {}) {
  const configured = configuredChannel === "nightly" ? "nightly" : "stable";
  const version = String(currentVersion || "");
  return configured === "nightly" || /-nightly(?:\.|$)/i.test(version) ? "nightly" : "stable";
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
