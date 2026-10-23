// Registers `node-hooks.ts`, with `--import`. See there for why.
import { register } from "node:module";

register("./node-hooks.ts", import.meta.url);
