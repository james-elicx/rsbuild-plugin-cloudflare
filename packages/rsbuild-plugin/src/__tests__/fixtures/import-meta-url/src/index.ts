// Packages such as `@tanstack/devtools-ui` import assets this way.
const logoUrl = new URL("./logo.svg", import.meta.url).href;

export default {
	fetch() {
		return new Response(logoUrl);
	},
} satisfies ExportedHandler;
