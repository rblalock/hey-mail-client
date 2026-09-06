import { describe, expect, it } from "vitest";
import { nextVersion, verifyReleaseBuild, verifyReleaseVersion } from "./release-version.mjs";

describe("release versions", () => {
  it.each([["patch", "0.3.8"], ["minor", "0.4.0"], ["major", "1.0.0"]])("bumps %s", (bump, expected) => {
    expect(nextVersion("0.3.7", bump)).toBe(expected);
  });
  it.each(["01.2.3", "v1.2.3", "1.2.3-beta.1", "1.2", "1.2.3;whoami"])("rejects invalid stable version %s", (version) => {
    expect(() => nextVersion(version, "patch")).toThrow();
  });
  it("rejects unsupported bump modes", () => expect(() => nextVersion("0.1.0", "auto")).toThrow());
  it("requires exact tag and lockfile agreement", () => {
    const pkg = { version: "0.2.0" };
    const lock = { version: "0.2.0", packages: { "": pkg } };
    expect(verifyReleaseVersion("v0.2.0", pkg, lock)).toBe("0.2.0");
    expect(() => verifyReleaseVersion("v0.3.0", pkg, lock)).toThrow();
    expect(() => verifyReleaseVersion("v0.2.0", pkg, { ...lock, version: "0.1.0" })).toThrow();
    expect(() => verifyReleaseVersion("v0.2.0", pkg, { ...lock, packages: { "": { version: "0.1.0" } } })).toThrow();
  });
  it("rejects stale, modified, wrong-version, or wrong-architecture builds", () => {
    const info = { version: "0.2.0", revision: "a".repeat(40), modified: false, arch: "x64" };
    expect(() => verifyReleaseBuild("v0.2.0", info, info.revision)).not.toThrow();
    for (const change of [{ revision: "b".repeat(40) }, { modified: true }, { version: "0.1.0" }, { arch: "arm64" }]) {
      expect(() => verifyReleaseBuild("v0.2.0", { ...info, ...change }, info.revision)).toThrow();
    }
  });
});
