import { K6_PACKAGE_NAMES, K6_RELEASE, REPOSITORY_ROOT } from "./contract.ts";
import { runManagedCommand } from "./command.ts";

const [tag] = process.argv.slice(2);
const expectedTag = `v${K6_RELEASE.packageVersion}`;
if (tag !== expectedTag) {
  throw new Error(`Release tag must be ${expectedTag}, got ${String(tag)}`);
}
for (const name of K6_PACKAGE_NAMES) {
  if ((await publishedVersions(name)).includes(K6_RELEASE.packageVersion)) {
    throw new Error(
      `${name}@${K6_RELEASE.packageVersion} is already published`,
    );
  }
}
console.log(
  `Ready to publish ${K6_PACKAGE_NAMES.length.toString()} packages at ${K6_RELEASE.packageVersion}`,
);

async function publishedVersions(name: string): Promise<string[]> {
  try {
    const result = await runManagedCommand(
      "npm",
      ["view", name, "versions", "--json"],
      { cwd: REPOSITORY_ROOT, label: `npm view ${name}`, timeoutMs: 60_000 },
    );
    const parsed: unknown = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch (error) {
    if (error instanceof Error && error.message.includes("E404")) return [];
    throw error;
  }
}
