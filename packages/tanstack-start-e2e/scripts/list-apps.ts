/**
 * Prints the names of the apps in `apps.ts` as a JSON array, for CI's job
 * matrix, which runs each app's suites in its own job.
 *
 * Usage: node --experimental-strip-types scripts/list-apps.ts
 */
import { apps } from "../apps.ts";

console.log(JSON.stringify(apps.map(({ name }) => name)));
