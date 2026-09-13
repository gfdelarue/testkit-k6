import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPOSITORY_ROOT, tarballsRoot } from "./contract.ts";
import { runManagedStreamingCommand } from "./command.ts";

const root = tarballsRoot(REPOSITORY_ROOT);
const records = JSON.parse(
  fs.readFileSync(path.join(root, "integrity.json"), "utf8"),
);
const extraArguments = process.argv.slice(2);
for (const record of records) {
  const tarball = path.join(root, record.filename);
  const digest = `sha512-${crypto.createHash("sha512").update(fs.readFileSync(tarball)).digest("base64")}`;
  if (digest !== record.integrity) {
    throw new Error(
      `${record.filename} integrity ${digest} differs from packed ${record.integrity}`,
    );
  }
  await runManagedStreamingCommand(
    "npm",
    ["publish", tarball, "--access", "public", ...extraArguments],
    {
      cwd: REPOSITORY_ROOT,
      label: `npm publish ${record.name}`,
      timeoutMs: 5 * 60 * 1_000,
    },
  );
  console.log(`${record.name}@${record.version} ${record.integrity}`);
}
