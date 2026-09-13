import crypto from "node:crypto";
import fs from "node:fs";
import { list as listTar } from "tar";

export async function inspectSourceArchive(
  archivePath,
  { requiredEntries, sourceRoot },
) {
  const entries = [];
  const goSumChunks = [];
  await listTar({
    file: archivePath,
    onReadEntry(entry) {
      entries.push(
        Object.freeze({
          linkpath: entry.linkpath,
          mode: entry.mode & 0o777,
          path: entry.path,
          size: entry.size,
          type: entry.type,
        }),
      );
      if (entry.path === `${sourceRoot}/go.sum` && entry.type === "File") {
        entry.on("data", (chunk) => goSumChunks.push(Buffer.from(chunk)));
      } else {
        entry.resume();
      }
    },
    strict: true,
  });
  assertSourceArchiveEntries(entries, { requiredEntries, sourceRoot });
  if (goSumChunks.length === 0) {
    throw new Error("source archive omits readable go.sum contents");
  }
  const stats = fs.statSync(archivePath);
  return Object.freeze({
    entries: entries.length,
    moduleChecksums: parseGoSumCatalog(
      Buffer.concat(goSumChunks).toString("utf8"),
    ),
    sha256: sha256File(archivePath),
    size: stats.size,
  });
}

export function assertSourceArchiveEntries(
  entries,
  { requiredEntries, sourceRoot },
) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("source archive must contain entries");
  }
  if (entries.length > 100_000) {
    throw new Error("source archive exceeds the 100000 entry safety limit");
  }
  const identities = new Set();
  const portableIdentities = new Map();
  const normalizedEntries = [];
  for (const entry of entries) {
    const normalized = validateSourceArchiveEntry(entry, sourceRoot);
    if (identities.has(normalized)) {
      throw new Error(`source archive contains duplicate entry: ${normalized}`);
    }
    identities.add(normalized);
    const portableIdentity = normalized.normalize("NFC").toLowerCase();
    const collision = portableIdentities.get(portableIdentity);
    if (collision !== undefined) {
      throw new Error(
        `source archive contains portable path collision: ${collision} and ${normalized}`,
      );
    }
    portableIdentities.set(portableIdentity, normalized);
    normalizedEntries.push({ ...entry, path: normalized });
  }
  const prefix = `${sourceRoot}/`;
  const entrySet = new Map(
    normalizedEntries.map((entry) => [entry.path, entry]),
  );
  for (const required of requiredEntries) {
    if (entrySet.get(`${prefix}${required}`)?.type !== "File") {
      throw new Error(`source archive omits ${required}`);
    }
  }
}

export function parseGoSumCatalog(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("archived go.sum must be non-empty text");
  }
  const modules = [];
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.includes("/go.mod ")) continue;
    const [module, version, sum, ...extra] = line.split(/\s+/u);
    if (
      !module ||
      !version ||
      !/^h1:[A-Za-z0-9+/=]+$/u.test(sum) ||
      extra.length > 0
    ) {
      throw new Error(`archived go.sum contains an invalid entry: ${line}`);
    }
    modules.push({ module, sum, version });
  }
  modules.sort(compareModules);
  assertChecksumCatalog(modules, "archived go.sum checksum catalog");
  return Object.freeze(modules.map(Object.freeze));
}

function validateSourceArchiveEntry(entry, sourceRoot) {
  if (entry.type !== "File" && entry.type !== "Directory") {
    throw new Error(
      `source archive contains unsupported ${String(entry.type)} entry: ${entry.path}`,
    );
  }
  if (entry.linkpath !== undefined && entry.linkpath !== "") {
    throw new Error(
      `source archive entry contains a link target: ${entry.path}`,
    );
  }
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    (entry.type === "Directory" && entry.size !== 0)
  ) {
    throw new Error(`source archive entry has an invalid size: ${entry.path}`);
  }
  const rawPath = String(entry.path);
  const normalized =
    entry.type === "Directory" ? rawPath.replace(/\/+$/u, "") : rawPath;
  const expectedMode = entry.type === "Directory" ? 0o755 : 0o644;
  if ((entry.mode & 0o777) !== expectedMode) {
    throw new Error(
      `source archive entry ${normalized} mode is ${(entry.mode & 0o777).toString(8)}, expected ${expectedMode.toString(8)}`,
    );
  }
  if (
    normalized === "" ||
    normalized !== normalized.normalize("NFC") ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    containsControlCharacter(normalized)
  ) {
    throw new Error(`source archive entry is not portable: ${rawPath}`);
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`source archive entry is not portable: ${rawPath}`);
  }
  const prefix = `${sourceRoot}/`;
  if (normalized !== sourceRoot && !normalized.startsWith(prefix)) {
    throw new Error(`source archive entry escapes canonical root: ${rawPath}`);
  }
  return normalized;
}

function assertChecksumCatalog(modules, label) {
  if (modules.length === 0) throw new Error(`${label} must be non-empty`);
  const keys = modules.map((module) => `${module.module}@${module.version}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${label} contains duplicate module versions`);
  }
  for (const module of modules) {
    if (!/^h1:[A-Za-z0-9+/=]+$/u.test(module.sum)) {
      throw new Error(`${label} ${module.module} omits its exact Go checksum`);
    }
  }
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function compareModules(left, right) {
  return left.module === right.module
    ? compareText(left.version, right.version)
    : compareText(left.module, right.module);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
