import { WorkerEntrypoint } from "cloudflare:workers";

// The Worker only has named entrypoints, which other Workers call through
// service bindings.
export class Greeter extends WorkerEntrypoint {
	greet(name: string): string {
		return `Hello, ${name}`;
	}
}
