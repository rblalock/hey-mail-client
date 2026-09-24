import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ComposerFiles, clipboardFilePaths } from "./composer-attachments";
import { validateComposerFiles, MAX_COMPOSER_FILE_BYTES } from "../shared/composer-attachments";

const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "hey-composer-test-")); directories.push(directory);
  return { directory, files: new ComposerFiles(join(directory, "profile-a"), () => "data:image/png;base64,cHJldmlldw==") };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("private composer attachment staging", () => {
  it("persists pasted bytes with safe names, unique paths and private permissions", async () => {
    const { files } = await setup();
    const paths = await files.importBytes([{ name: "../../photo.png", bytes: new Uint8Array([1, 2, 3]) }, { name: "photo.png", bytes: new Uint8Array([4]) }]);
    expect(basename(paths[0]!)).toBe("photo.png");
    expect(paths[0]).not.toBe(paths[1]);
    expect(Array.from(await readFile(paths[0]!))).toEqual([1, 2, 3]);
    expect((await stat(paths[0]!)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(paths[0]!))).mode & 0o777).toBe(0o700);
    expect(await files.describe(paths)).toEqual(paths.map((path, i) => ({ path, name: "photo.png", byteSize: i === 0 ? 3 : 1, previewUrl: "data:image/png;base64,cHJldmlldw==" })));
    await files.remove(paths);
    await expect(stat(paths[0]!)).rejects.toThrow();
  });
  it("snapshots selected files and does not delete their originals", async () => {
    const { files, directory } = await setup();
    const original = join(directory, "clip.mp4"); await writeFile(original, "video");
    const paths = await files.importPaths([original]);
    await writeFile(original, "changed");
    expect(await readFile(paths[0]!, "utf8")).toBe("video");
    expect((await files.describe(paths))[0]?.previewUrl).toBeUndefined();
    await files.remove([...paths, original]);
    expect(await readFile(original, "utf8")).toBe("changed");
  });
  it("does not preview or remove files owned by another profile or through symlinks", async () => {
    const { files, directory } = await setup();
    const other = new ComposerFiles(join(directory, "profile-b"));
    const [path] = await other.importBytes([{ name: "private.png", bytes: new Uint8Array([9]) }]);
    expect(await files.describe([path])).toEqual([{ path, name: "private.png" }]);
    await files.remove([path]); expect(await stat(path!)).toBeDefined();
    const [own] = await files.importBytes([{ name: "link.png", bytes: new Uint8Array([1]) }]);
    await rm(own!); await symlink(path!, own!);
    expect((await files.describe([own]))[0]?.previewUrl).toBeUndefined();
    await files.remove([own]); expect(await stat(path!)).toBeDefined();
  });
  it("rejects invalid batches before writing any files", async () => {
    const { files, directory } = await setup();
    await expect(files.importBytes([{ name: "okay", bytes: new Uint8Array([1]) }, { name: "empty", bytes: new Uint8Array() }])).rejects.toThrow("Empty");
    await expect(files.importBytes([{ name: "x", bytes: [1, 2] }])).rejects.toThrow("Invalid");
    expect(await readdir(directory)).toEqual([]);
    await expect(files.importPaths([directory])).rejects.toThrow();
  });
  it("enforces count and byte limits before reading renderer files", () => {
    expect(() => validateComposerFiles([{ name: "x", size: 1 }], 25)).toThrow("25");
    expect(() => validateComposerFiles([{ name: "x", size: MAX_COMPOSER_FILE_BYTES + 1 }])).toThrow("50 MB");
    expect(() => validateComposerFiles(Array.from({ length: 3 }, () => ({ name: "x", size: MAX_COMPOSER_FILE_BYTES })))).toThrow("100 MB");
  });
  it("decodes copied local file URIs without treating remote URLs as uploads", () => {
    expect(clipboardFilePaths("copy\nfile:///tmp/my%20photo.png\nhttps://example.com/photo.png")).toEqual(["/tmp/my photo.png"]);
    expect(() => clipboardFilePaths("file://remote/share/file")).toThrow("local");
  });
});
