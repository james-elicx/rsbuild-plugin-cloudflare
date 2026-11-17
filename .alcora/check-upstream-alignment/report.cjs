#!/usr/bin/env node
/**
 * The sync's reports, for sync.sh and the skill's phases:
 *
 *   report.cjs answer --transcript <file> --out <dir>
 *     Reads the agent's answer (alcora.md) from its stream-json transcript
 *     into <out>/sync-report.json. Exits 1 when it has none. `flaky` is only
 *     an answer in a round for failed checks (ROUND=checks in sync.env).
 *   report.cjs report --out <dir> --result <result> --summary <text> [--reason <text>]
 *     Writes <out>/sync-report.json for a round that ends without the agent.
 *   report.cjs log --from <sha> --to <sha> [--limit <n>]
 *     Prints upstream's commits between two workers-sdk commits, newest
 *     first, as `git log --oneline` does, from GitHub's API, or a link to
 *     them when the API doesn't answer.
 *   report.cjs body --out <dir> --main-pin <sha> --pin <sha> --changes <subjects> --previous <file>
 *     Prints the sync pull request's description.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const UPSTREAM = "cloudflare/workers-sdk";
const RESULTS = ["ready", "flaky", "needs_human"];
// The commits that bump workers-sdk and update the dependencies, as
// scripts/generate-changesets.ts knows them.
const SYNC_COMMIT =
	/^(?:Bump workers-sdk to |Update dependencies$|Sync with workers-sdk )/;
const DEPENDENCIES =
	/<!-- dependencies -->\n([\s\S]*?)\n<!-- \/dependencies -->/;

function args() {
	const out = { command: process.argv[2] };
	const argv = process.argv.slice(3);
	for (let i = 0; i < argv.length; i += 2)
		out[argv[i].replace(/^--/, "")] = argv[i + 1] ?? "";
	return out;
}

const str = (value, max) =>
	typeof value === "string" ? value.trim().slice(0, max) : "";

/** What the earlier phases of the step recorded in sync.env. */
function state(out) {
	const values = {};
	const file = path.join(out, "sync.env");
	if (!fs.existsSync(file)) return values;
	for (const line of fs.readFileSync(file, "utf8").split("\n")) {
		const at = line.indexOf("=");
		if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
	}
	return values;
}

function write(out, report) {
	const upstream = state(out).PIN ?? "";
	fs.writeFileSync(
		path.join(out, "sync-report.json"),
		`${JSON.stringify({ ...report, upstream }, null, 2)}\n`
	);
	console.log(`Result ${report.result}: ${report.summary}`);
}

/** The agent's final text: the `result` message, or failing that its last assistant text. */
function finalText(transcript) {
	let result = null;
	let last = "";
	for (const line of transcript.split("\n")) {
		if (!line.trim()) continue;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			continue;
		}
		if (message.type === "result" && typeof message.result === "string")
			result = message.result;
		if (message.type === "assistant") {
			const text = (message.message?.content ?? [])
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			if (text.trim()) last = text;
		}
	}
	return result ?? last;
}

/** The last ```json block that parses. */
function extractJson(text) {
	for (const match of [
		...text.matchAll(/```json\s*\n([\s\S]*?)```/g),
	].reverse()) {
		try {
			return JSON.parse(match[1]);
		} catch {}
	}
	return null;
}

function answer(options) {
	const raw = extractJson(
		finalText(fs.readFileSync(options.transcript, "utf8"))
	);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		console.error("The agent's reply has no JSON answer.");
		process.exit(1);
	}
	// An answer that can't say how it ended needs a person, as does a flake
	// outside a round for failed checks, since nothing re-runs them then.
	const checks = state(options.out).ROUND === "checks";
	let result = RESULTS.includes(raw.result) ? raw.result : "needs_human";
	let reason = str(raw.reason, 4000);
	if (result === "flaky" && !checks) {
		result = "needs_human";
		reason ||=
			"The agent found checks that fail by chance, which only a round for CI's failures re-runs.";
	}
	write(options.out, {
		result,
		summary: str(raw.summary, 4000),
		tests: str(raw.tests, 4000),
		reason:
			result === "needs_human"
				? reason || "The agent didn't say why it needs a person."
				: "",
	});
}

/** Upstream's commits from `from` to `to`, newest first, or a link to them. */
async function upstreamLog(from, to, limit) {
	const compare = `https://github.com/${UPSTREAM}/compare/${from}...${to}`;
	if (from === to) return [];
	try {
		// Anonymously: the sandbox's token is for this repository alone.
		const response = await fetch(
			`https://api.github.com/repos/${UPSTREAM}/compare/${from}...${to}`,
			{
				headers: {
					accept: "application/vnd.github+json",
					"user-agent": "rsbuild-plugin-cloudflare-sync",
				},
			}
		);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const { commits, total_commits: total } = await response.json();
		const lines = commits
			.slice()
			.reverse()
			.slice(0, limit)
			.map((c) => `${c.sha.slice(0, 9)} ${c.commit.message.split("\n")[0]}`);
		if (total > lines.length)
			lines.push(`… and ${total - lines.length} more: ${compare}`);
		return lines;
	} catch (error) {
		console.error(`Couldn't list upstream's commits: ${error.message}`);
		return [compare];
	}
}

const STATUS = {
	ready:
		"The agent's checks and tests pass in the sandbox. `.github/workflows/merge-upstream-sync.yml` merges this pull request once CI passes too.",
	flaky:
		"The agent found that CI's failures were flaky, so the workflow re-runs them.",
};

async function body(options) {
	const report = fs.existsSync(path.join(options.out, "sync-report.json"))
		? JSON.parse(
				fs.readFileSync(path.join(options.out, "sync-report.json"), "utf8")
			)
		: { result: "needs_human", reason: "The round left no report." };
	const previous = fs.existsSync(options.previous)
		? fs.readFileSync(options.previous, "utf8")
		: "";
	const dependenciesFile = path.join(options.out, "dependencies.md");
	// A round that didn't update the dependencies keeps what the last one said.
	const dependencies = fs.existsSync(dependenciesFile)
		? fs.readFileSync(dependenciesFile, "utf8").trim()
		: (DEPENDENCIES.exec(previous)?.[1] ?? "").trim();
	const changes = options.changes
		.split("\n")
		.filter((subject) => subject && !SYNC_COMMIT.test(subject))
		.map((subject) => `- ${subject}`);
	const from = options["main-pin"];
	const to = options.pin;

	const lines = [];
	const out = (...text) => lines.push(...text);
	out(
		`Moves the workers-sdk submodule from ${UPSTREAM}@${from} to ${UPSTREAM}@${to}, updates the dependencies that don't follow workers-sdk within their ranges, and aligns the plugin with the upstream changes, following the \`check-upstream-alignment\` skill.`,
		""
	);
	if (report.result === "needs_human")
		out(
			`> [!WARNING]`,
			`> **This needs a person.** ${report.reason.replace(/\n/g, "\n> ")}`,
			""
		);
	else if (STATUS[report.result]) out(STATUS[report.result], "");
	out("### The plugin's changes", "");
	out(
		...(changes.length > 0 ? changes : ["None: the plugin needed no changes."]),
		""
	);
	if (report.summary) out("The agent, this round:", "", report.summary, "");
	if (report.tests) out("What it ran:", "", report.tests, "");
	out("### Upstream's changes", "");
	if (from === to) out("None: workers-sdk is at `main`'s pin.", "");
	else {
		out(
			"<details>",
			`<summary>${from.slice(0, 9)}…${to.slice(0, 9)}</summary>`,
			"",
			"```",
			...(await upstreamLog(from, to, 100)),
			"```",
			"",
			"</details>",
			""
		);
	}
	out("<!-- dependencies -->", dependencies, "<!-- /dependencies -->", "");
	out(
		"<sub>Opened and updated by the Upstream sync Alcora workflow (`.alcora/upstream-sync`). The plugin's changes are an AI agent's, and may be wrong: review them as you would anyone's. Later syncs rebase this branch onto `main` and keep what is pushed to it.</sub>"
	);
	console.log(lines.join("\n"));
}

const options = args();
switch (options.command) {
	case "answer":
		answer(options);
		break;
	case "report":
		write(options.out, {
			result: options.result,
			summary: str(options.summary, 4000),
			tests: "",
			reason: str(options.reason, 4000),
		});
		break;
	case "log":
		upstreamLog(options.from, options.to, Number(options.limit || 100)).then(
			(lines) => {
				if (lines.length > 0) console.log(lines.join("\n"));
			}
		);
		break;
	case "body":
		body(options);
		break;
	default:
		console.error(`report.cjs: unknown command ${options.command}`);
		process.exit(2);
}
