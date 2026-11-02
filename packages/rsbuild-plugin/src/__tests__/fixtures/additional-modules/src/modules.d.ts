declare module "*.bin" {
	const arrayBuffer: ArrayBuffer;
	export default arrayBuffer;
}

declare module "*.txt" {
	const text: string;
	export default text;
}

declare module "*.wasm" {
	const wasm: WebAssembly.Module;
	export default wasm;
}

declare module "*.wasm?init" {
	const init: (imports?: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
	export default init;
}
