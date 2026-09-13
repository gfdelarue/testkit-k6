import { K6_PACKAGE_NAMES, K6_RELEASE, REPOSITORY_ROOT } from "./contract.ts";
import { runManagedCommand } from "./command.ts";

const [tag] = process.argv.slice(2);
const expectedTag = `v${K6_RELEASE.packageVersion}`;
if (tag !== expectedTag) {
  throw new Error(`Release tag must be ${expectedTag}, got ${String(tag)}`);
}
for (const name of K6_PACKAGE_NAMES) {
  const result = await runManagedCommand(
    "npm",
    ["view", `${name}@${K6_RELEASE.packageVersion}`, "version", "--json"],
    { cwd: REPOSITORY_ROOT, label: `npm view ${name}`, timeoutMs: 60_000 },
  );
  if (result.stdout.trim() !== "") {
    throw new Error(
      `${name}@${K6_RELEASE.packageVersion} is already published`,
    );
  }
}
console.log(
  `Ready to publish ${K6_PACKAGE_NAMES.length.toString()} packages at ${K6_RELEASE.packageVersion}`,
);
