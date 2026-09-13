import fs from "node:fs";
import path from "node:path";
import {
  K6_RELEASE,
  REPOSITORY_ROOT,
  packageRoots,
  tarballsRoot,
  verifyK6ReleaseMaterials,
} from "./contract.ts";
import { runManagedCommand } from "./command.ts";

await verifyK6ReleaseMaterials(REPOSITORY_ROOT);
const destination = tarballsRoot(REPOSITORY_ROOT);
fs.rmSync(destination, { force: true, recursive: true });
fs.mkdirSync(destination, { recursive: true });
const records = [];
for (const { name, root } of packageRoots(REPOSITORY_ROOT)) {
  const result = await runManagedCommand(
    "npm",
    ["pack", "--json", "--pack-destination", destination],
    { cwd: root, label: `npm pack ${name}`, timeoutMs: 5 * 60 * 1_000 },
  );
  const [packed] = JSON.parse(result.stdout);
  if (packed.name !== name || packed.version !== K6_RELEASE.packageVersion) {
    throw new Error(
      `npm pack produced ${packed.name}@${packed.version} for ${name}`,
    );
  }
  records.push({
    filename: packed.filename,
    integrity: packed.integrity,
    name,
    shasum: packed.shasum,
    size: packed.size,
    unpackedSize: packed.unpackedSize,
    version: packed.version,
  });
  console.log(
    `${name}@${packed.version} ${packed.integrity} ${packed.size.toString()} bytes`,
  );
}
fs.writeFileSync(
  path.join(destination, "integrity.json"),
  `${JSON.stringify(records, null, 2)}\n`,
);
