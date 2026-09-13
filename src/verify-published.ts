import fs from "node:fs";
import path from "node:path";
import { REPOSITORY_ROOT, tarballsRoot } from "./contract.ts";
import { runManagedCommand } from "./command.ts";

const VISIBILITY_DEADLINE_MS = 10 * 60 * 1_000;
const VISIBILITY_POLL_MS = 15_000;

const records = JSON.parse(
  fs.readFileSync(
    path.join(tarballsRoot(REPOSITORY_ROOT), "integrity.json"),
    "utf8",
  ),
);
for (const record of records) {
  const published = await publishedIntegrity(record.name, record.version);
  if (published !== record.integrity) {
    throw new Error(
      `${record.name}@${record.version} integrity ${String(published)} differs from packed ${record.integrity}`,
    );
  }
  console.log(`${record.name}@${record.version} ${published}`);
}

async function publishedIntegrity(
  name: string,
  version: string,
): Promise<unknown> {
  const deadline = Date.now() + VISIBILITY_DEADLINE_MS;
  for (;;) {
    try {
      const result = await runManagedCommand(
        "npm",
        [
          "view",
          `${name}@${version}`,
          "dist.integrity",
          "--json",
          "--prefer-online",
        ],
        { cwd: REPOSITORY_ROOT, label: `npm view ${name}`, timeoutMs: 60_000 },
      );
      return JSON.parse(result.stdout);
    } catch (error) {
      const notVisibleYet =
        error instanceof Error && error.message.includes("E404");
      if (!notVisibleYet || Date.now() >= deadline) throw error;
      console.log(`${name}@${version} is not visible yet; retrying`);
      await new Promise((resolve) => setTimeout(resolve, VISIBILITY_POLL_MS));
    }
  }
}
