import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_COMPOSER_FILE_BYTES, validateComposerFiles, type ComposerFile, type ComposerFileInput } from "../shared/composer-attachments";

export function clipboardFilePaths(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("file://")).map((line) => {
    const url = new URL(line);
    if (url.hostname && url.hostname !== "localhost") throw new Error("Only local clipboard files can be attached.");
    return fileURLToPath(url);
  });
}

export class ComposerFiles {
  constructor(private readonly root: string, private readonly thumbnail?: (bytes: Buffer) => string | undefined) {}

  async importBytes(input: unknown): Promise<string[]> {
    if (!Array.isArray(input) || input.some((file) => !file || typeof file.name !== "string" || !(file.bytes instanceof Uint8Array))) throw new Error("Invalid attachment data.");
    const files = input as ComposerFileInput[];
    validateComposerFiles(files.map((file) => ({ name: file.name, size: file.bytes.byteLength })));
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const created: string[] = [];
    const paths: string[] = [];
    try {
      for (const file of files) {
        const directory = join(this.root, randomUUID());
        await mkdir(directory, { mode: 0o700 });
        created.push(directory);
        const name = basename(file.name.replaceAll("\\", "/")).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180);
        const path = join(directory, !name || name === "." || name === ".." ? "attachment" : name);
        await writeFile(path, file.bytes, { mode: 0o600, flag: "wx" });
        paths.push(path);
      }
      return paths;
    } catch (error) {
      await Promise.all(created.map((directory) => rm(directory, { recursive: true, force: true })));
      throw error;
    }
  }

  async importPaths(paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    if (paths.length > 25) throw new Error("Attach up to 25 files per message.");
    const files: ComposerFileInput[] = [];
    for (const path of paths) {
      const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        validateComposerFiles([...files.map((file) => ({ name: file.name, size: file.bytes.length })), { name: basename(path), size: stat.size }]);
        if (!stat.isFile()) throw new Error("Attach files, not folders.");
        // Bound reads even if the source grows during import.
        const bytes = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < bytes.length) {
          const read = await handle.read(bytes, length, bytes.length - length, null);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length !== stat.size) throw new Error("The file changed while attaching it. Try again.");
        files.push({ name: basename(path), bytes: bytes.subarray(0, length) });
      } finally { await handle.close(); }
    }
    return this.importBytes(files);
  }

  private async owned(path: string): Promise<boolean> {
    const directory = dirname(path);
    if (dirname(directory) !== resolve(this.root) || !/^[0-9a-f-]{36}$/.test(basename(directory))) return false;
    return await realpath(path).catch(() => "") === resolve(path);
  }

  async describe(paths: unknown): Promise<ComposerFile[]> {
    if (!Array.isArray(paths) || paths.length > 25 || paths.some((path) => typeof path !== "string")) throw new Error("Invalid attachments.");
    return Promise.all(paths.map(async (path: string) => {
      const file: ComposerFile = { path, name: basename(path) };
      if (!await this.owned(path)) return file;
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        file.byteSize = stat.size;
        // Decode small raster images only; never render uploaded HTML/SVG.
        if (stat.size <= Math.min(MAX_COMPOSER_FILE_BYTES, 10 * 1024 * 1024) && /\.(png|jpe?g|gif|webp|avif)$/i.test(path)) {
          file.previewUrl = this.thumbnail?.(await readFile(handle));
        }
      } finally { await handle.close(); }
      return file;
    }));
  }

  async remove(paths: unknown): Promise<void> {
    if (!Array.isArray(paths) || paths.length > 25 || paths.some((path) => typeof path !== "string")) throw new Error("Invalid attachments.");
    for (const path of paths) if (await this.owned(path)) await rm(dirname(path), { recursive: true, force: true });
  }
}
