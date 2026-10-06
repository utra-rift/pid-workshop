/// <reference lib="webworker" />
import { serve } from "../rpc";
import type { RunRequest } from "../types";
import { runCpp } from "./harness";

// Disposable: the page kills this worker if the student's code never returns.
serve({
	run(params: { wasm: Uint8Array; request: Omit<RunRequest, "source"> }) {
		return runCpp(params.wasm, params.request);
	},
});
