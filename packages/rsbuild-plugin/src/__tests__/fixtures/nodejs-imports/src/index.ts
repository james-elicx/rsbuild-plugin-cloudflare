import { EventEmitter } from "events";
import { strictEqual } from "node:assert/strict";

export default {
	async fetch() {
		strictEqual(typeof EventEmitter, "function");
		return new Response("OK");
	},
} satisfies ExportedHandler;
