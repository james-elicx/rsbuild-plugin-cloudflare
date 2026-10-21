/**
 * Checks that the upstream code copied into `src/upstream/copied.ts` hasn't
 * changed upstream. `upstream-copies.json` records a hash of each upstream
 * top-level declaration that a copy came from. When the submodule is bumped and
 * a hash no longer matches, review the upstream change, update the copy, then
 * record the new hashes with `--update`.
 *
 * Usage: node --experimental-strip-types scripts/check-copied-code.ts [--update]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

type Ledger = Record<string, Record<string, string>>;

const root = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(root, "workers-sdk");
const ledgerPath = path.join(
	root,
	"packages/rsbuild-plugin/src/upstream/upstream-copies.json"
);

/**
 * Hashes the named top-level declarations in an upstream file. Comments and
 * surrounding whitespace aren't hashed, so only changes to the code count.
 *
 * @param file The file's path, relative to the submodule.
 * @param names The declarations' names.
 * @returns The hashes, keyed by name. A missing declaration has no hash.
 */
function hashDeclarations(
	file: string,
	names: string[]
): Record<string, string | undefined> {
	const sourceFile = ts.createSourceFile(
		file,
		readFileSync(path.join(upstreamRoot, file), "utf8"),
		ts.ScriptTarget.Latest,
		true
	);
	const texts = new Map<string, string>();
	for (const statement of sourceFile.statements) {
		for (const name of getDeclaredNames(statement)) {
			texts.set(name, statement.getText(sourceFile));
		}
	}
	return Object.fromEntries(
		names.map((name) => {
			const text = texts.get(name);
			return [
				name,
				text === undefined
					? undefined
					: createHash("sha256").update(text).digest("hex"),
			];
		})
	);
}

/**
 * Gets the names that a top-level statement declares.
 *
 * @param statement The statement.
 * @returns The declared names.
 */
function getDeclaredNames(statement: ts.Statement): string[] {
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.flatMap((declaration) =>
			ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
		);
	}
	if (
		(ts.isFunctionDeclaration(statement) ||
			ts.isClassDeclaration(statement) ||
			ts.isInterfaceDeclaration(statement) ||
			ts.isTypeAliasDeclaration(statement) ||
			ts.isEnumDeclaration(statement)) &&
		statement.name
	) {
		return [statement.name.text];
	}
	return [];
}

const update = process.argv.includes("--update");
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Ledger;
const problems: string[] = [];
const updated: Ledger = {};

for (const [file, expected] of Object.entries(ledger)) {
	const actual = hashDeclarations(file, Object.keys(expected));
	updated[file] = {};
	for (const [name, hash] of Object.entries(actual)) {
		if (hash === undefined) {
			problems.push(`${file}: \`${name}\` no longer exists.`);
			continue;
		}
		updated[file][name] = hash;
		if (hash !== expected[name]) {
			problems.push(`${file}: \`${name}\` has changed.`);
		}
	}
}

if (update) {
	writeFileSync(ledgerPath, JSON.stringify(updated, null, "\t") + "\n");
	for (const problem of problems) {
		console.log(`Updated: ${problem}`);
	}
} else if (problems.length > 0) {
	console.error(
		[
			"Upstream code that `src/upstream/copied.ts` copies has changed:",
			...problems.map((problem) => `  - ${problem}`),
			"",
			"Review the upstream changes and update the copies, then run",
			"`pnpm check:copied-code --update`.",
		].join("\n")
	);
	process.exitCode = 1;
} else {
	console.log("The copied upstream code is up to date.");
}
