export function nextVersion(current, bump) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(current)) {
    throw new Error("Releases require a stable major.minor.patch version.");
  }
  const parts = current.split(".").map(Number);
  const index = ["major", "minor", "patch"].indexOf(bump);
  if (index < 0) throw new Error("Choose patch, minor, or major.");
  parts[index] += 1;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error("Version exceeds safe integer range.");
  return parts.join(".");
}

export function verifyReleaseVersion(tag, pkg, lock) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error("Invalid release tag.");
  if (tag !== `v${pkg.version}` || pkg.version !== lock.version || pkg.version !== lock.packages?.[""]?.version) {
    throw new Error("Release tag, package.json, and package-lock.json must have the same version.");
  }
  return pkg.version;
}

export function verifyReleaseBuild(tag, info, revision) {
  if (tag !== `v${info.version}` || info.revision !== revision || info.modified !== false || info.arch !== "x64") {
    throw new Error("Release requires a clean x64 build of the exact tagged source and version.");
  }
}
