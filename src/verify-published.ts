import fs from "node:fs";
import path from "node:path";
import { REPOSITORY_ROOT, tarballsRoot } from "./contract.ts";
import { runManagedCommand } from "./command.ts";

const records = JSON.parse(
  fs.readFileSync(
    path.join(tarballsRoot(REPOSITORY_ROOT), "integrity.json"),
    "utf8",
  ),
);
for (const record of records) {
  const result = await runManagedCommand(
    "npm",
    ["view", `${record.name}@${record.version}`, "dist.integrity", "--json"],
    {
      cwd: REPOSITORY_ROOT,
      label: `npm view ${record.name}`,
      timeoutMs: 60_000,
    },
  );
  const published = JSON.parse(result.stdout);
  if (published !== record.integrity) {
    throw new Error(
      `${record.name}@${record.version} integrity ${String(published)} differs from packed ${record.integrity}`,
    );
  }
  console.log(`${record.name}@${record.version} ${published}`);
}
