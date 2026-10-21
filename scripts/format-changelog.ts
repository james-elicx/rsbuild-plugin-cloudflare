/**
 * Moves the upstream changes in the plugin's latest release, which
 * `scripts/generate-changesets.ts` marks with a prefix, out of Changesets'
 * "Patch Changes" heading and under a heading of their own. Run after
 * `changeset version`. changesets/action reads the changelog for the "Version
 * Packages" pull request and the GitHub release, so both have the headings too.
 *
 * Usage: node --experimental-strip-types scripts/format-changelog.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Keep in sync with `upstreamPrefix` in `scripts/generate-changesets.ts`. */
const upstreamPrefix = "From `@cloudflare/vite-plugin`: ";
const upstreamHeading = "### Upstream Changes (`@cloudflare/vite-plugin`)";

const changelogPath = path.resolve(
	import.meta.dirname,
	"../packages/rsbuild-plugin/CHANGELOG.md"
);

/**
 * Splits markdown into blocks that each start with a line matching a pattern.
 *
 * @param lines The lines to split.
 * @param start Matches the first line of a block.
 * @returns The lines before the first block, then the blocks.
 */
function splitBlocks(lines: string[], start: RegExp): [string[], string[][]] {
	const head: string[] = [];
	const blocks: string[][] = [];
	for (const line of lines) {
		if (start.test(line)) {
			blocks.push([line]);
		} else {
			(blocks.at(-1) ?? head).push(line);
		}
	}
	return [head, blocks];
}

/**
 * Trims blank lines from the start and end of a block.
 *
 * @param lines The block's lines.
 * @returns The lines without the surrounding blank lines.
 */
function trimBlankLines(lines: string[]): string[] {
	const first = lines.findIndex((line) => line.trim() !== "");
	if (first === -1) {
		return [];
	}
	const last = lines.findLastIndex((line) => line.trim() !== "");
	return lines.slice(first, last + 1);
}

if (!existsSync(changelogPath)) {
	process.exit(0);
}

// The releases are `## <version>` sections, newest first.
const [preamble, releases] = splitBlocks(
	readFileSync(changelogPath, "utf8").split("\n"),
	/^## /
);
const latest = releases[0];
if (latest === undefined) {
	process.exit(0);
}

const [releaseHead, sections] = splitBlocks(latest.slice(1), /^### /);
const ownSections: string[][] = [];
const upstreamEntries: string[][] = [];
for (const [heading = "", ...body] of sections) {
	const [sectionHead, entries] = splitBlocks(body, /^- /);
	const ownEntries: string[][] = [];
	for (const entry of entries) {
		const [first = "", ...rest] = trimBlankLines(entry);
		if (first.startsWith(`- ${upstreamPrefix}`)) {
			upstreamEntries.push([
				`- ${first.slice(`- ${upstreamPrefix}`.length)}`,
				...rest,
			]);
		} else {
			ownEntries.push(trimBlankLines(entry));
		}
	}
	if (ownEntries.length > 0 || trimBlankLines(sectionHead).length > 0) {
		ownSections.push([heading, ...sectionHead, ...ownEntries.flat(), ""]);
	}
}

if (upstreamEntries.length > 0) {
	releases[0] = [
		latest[0] ?? "",
		...releaseHead,
		...ownSections.flatMap((section) => [...trimBlankLines(section), ""]),
		upstreamHeading,
		"",
		...upstreamEntries.flat(),
		"",
	];
	writeFileSync(changelogPath, [...preamble, ...releases.flat()].join("\n"));
}
