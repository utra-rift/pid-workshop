/// <reference lib="webworker" />
// Runs clangd (compiled to WebAssembly) and speaks LSP over a MessagePort.
// The stdin/stdout plumbing follows clangd-in-browser by Guyutongxue (MIT):
// https://github.com/Guyutongxue/clangd-in-browser

import {
	BrowserMessageReader,
	BrowserMessageWriter,
} from "vscode-languageserver-protocol/browser";
import { CLANGD_FLAGS, PRELUDE_H, ROBOT_H } from "#/runtimes/cpp/files";
import { emit, fetchBytes } from "#/runtimes/rpc";
import { TOOLS } from "#/tools";

declare const self: DedicatedWorkerGlobalScope;

const WORKSPACE = "/workspace";

interface ClangdModule {
	FS: {
		writeFile(path: string, data: string): void;
		mkdirTree(path: string): void;
	};
	callMain(args: string[]): void;
}

type ClangdFactory = (
	options: Record<string, unknown>,
) => Promise<ClangdModule>;

/** Splits clangd's stdout into LSP messages: a Content-Length header, then that many bytes. */
class LspFramer {
	private buffer: number[] = [];
	private expected = -1;
	private readonly decoder = new TextDecoder();

	constructor(private readonly onMessage: (json: string) => void) {}

	push(byte: number) {
		this.buffer.push(byte);
		if (this.expected < 0) {
			const n = this.buffer.length;
			// Header ends at \r\n\r\n.
			if (
				n >= 4 &&
				this.buffer[n - 4] === 13 &&
				this.buffer[n - 3] === 10 &&
				this.buffer[n - 2] === 13 &&
				this.buffer[n - 1] === 10
			) {
				const header = this.decoder.decode(new Uint8Array(this.buffer));
				const length = header.match(/Content-Length:\s*(\d+)/i);
				this.buffer = [];
				this.expected = length ? Number(length[1]) : -1;
			}
			return;
		}
		if (this.buffer.length === this.expected) {
			const json = this.decoder.decode(new Uint8Array(this.buffer));
			this.buffer = [];
			this.expected = -1;
			this.onMessage(json);
		}
	}
}

async function start(port: MessagePort) {
	const wasm = await fetchBytes(
		TOOLS.clangd.wasm,
		"C++ language server",
		(loaded, total, label) => emit({ type: "progress", loaded, total, label }),
	);
	const wasmUrl = URL.createObjectURL(
		new Blob([wasm as BlobPart], { type: "application/wasm" }),
	);
	const { default: Clangd } = (await import(
		/* @vite-ignore */ TOOLS.clangd.js
	)) as { default: ClangdFactory };

	const reader = new BrowserMessageReader(port);
	const writer = new BrowserMessageWriter(port);
	const encoder = new TextEncoder();

	// clangd waits (via a patch to its JSON transport) before every read until
	// stdin() has data. Each message goes in as three chunks (header line, blank
	// line, body) and stdin() returns null at the end of each one. That ends
	// that read() call, so libc never buffers past a line clangd is about to
	// wait for, and the wait always sees the bytes it needs.
	const chunks: Uint8Array[] = [];
	let current: Uint8Array | null = null;
	let offset = 0;
	let wake: () => void = () => {};
	const framer = new LspFramer((json) => writer.write(JSON.parse(json)));

	const clangd = await Clangd({
		thisProgram: "/usr/bin/clangd",
		locateFile: (path: string, prefix: string) =>
			path.endsWith(".wasm") ? wasmUrl : `${prefix}${path}`,
		stdinReady: async () => {
			if ((current && offset < current.length) || chunks.length) return;
			await new Promise<void>((resolve) => {
				wake = resolve;
			});
		},
		stdin: () => {
			if (!current) {
				current = chunks.shift() ?? null;
				offset = 0;
				if (!current) return null;
			}
			if (offset < current.length) return current[offset++];
			current = null;
			return null;
		},
		stdout: (byte: number) => framer.push(byte),
		stderr: () => {},
		onExit: () => emit({ type: "failed", message: "clangd exited." }),
		onAbort: () => emit({ type: "failed", message: "clangd crashed." }),
	});

	clangd.FS.mkdirTree(WORKSPACE);
	clangd.FS.writeFile(`${WORKSPACE}/robot.h`, ROBOT_H);
	clangd.FS.writeFile(`${WORKSPACE}/prelude.h`, PRELUDE_H);
	clangd.FS.writeFile(`${WORKSPACE}/controller.cpp`, "");
	clangd.FS.writeFile(
		`${WORKSPACE}/.clangd`,
		JSON.stringify({ CompileFlags: { Add: CLANGD_FLAGS } }),
	);
	clangd.callMain([
		"--header-insertion=never",
		"--clang-tidy=false",
		"--background-index=false",
	]);

	reader.listen((message) => {
		const body = encoder.encode(JSON.stringify(message));
		chunks.push(
			encoder.encode(`Content-Length: ${body.byteLength}\r\n`),
			encoder.encode("\r\n"),
			body,
		);
		wake();
	});
	emit({ type: "ready" });
}

self.addEventListener("message", (event: MessageEvent) => {
	if (event.data?.type === "init" && event.data.port) {
		start(event.data.port as MessagePort).catch((error) =>
			emit({
				type: "failed",
				message: String((error as Error)?.message ?? error),
			}),
		);
	}
});
