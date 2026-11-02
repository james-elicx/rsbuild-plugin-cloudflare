import wasm from "./add.wasm";
import initWasm from "./add.wasm?init";
// Stands in for a dependency that imports its own modules, such as a package's
// WebAssembly build: rebuilds that the Worker's other changes cause don't
// change it, so Rspack doesn't resolve its imports again.
import data from "./data.bin";
import message from "./message.txt";

interface AddInstance {
	exports: { add(a: number, b: number): number };
}

export async function add(a: number, b: number): Promise<number> {
	const instance = (await WebAssembly.instantiate(wasm)) as AddInstance;
	return instance.exports.add(a, b);
}

export async function addWithInit(a: number, b: number): Promise<number> {
	const instance = (await initWasm()) as AddInstance;
	return instance.exports.add(a, b);
}

export { data, message };
