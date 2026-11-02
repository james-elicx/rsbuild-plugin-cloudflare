import { add, addWithInit, data, message } from "./modules";

export default {
	async fetch(request) {
		switch (new URL(request.url).pathname) {
			case "/wasm": {
				return new Response(String(await add(3, 4)));
			}
			case "/wasm-init": {
				return new Response(String(await addWithInit(5, 6)));
			}
			case "/text": {
				return new Response(message);
			}
			case "/bin": {
				return new Response(String(data.byteLength));
			}
		}

		return new Response("Hello from additional modules");
	},
} satisfies ExportedHandler;
