import { K6_RELEASE } from "./contract.ts";

const [tag] = process.argv.slice(2);
const expectedTag = `v${K6_RELEASE.packageVersion}`;
if (tag !== expectedTag) {
  throw new Error(`Release tag must be ${expectedTag}, got ${String(tag)}`);
}
console.log(`Release tag matches ${expectedTag}`);
