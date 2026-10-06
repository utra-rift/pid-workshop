import type * as Monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import type { MonacoApi } from "#/editor/monaco";
import { FILE_URIS } from "#/editor/uris";
import type { RuntimeStatus } from "#/runtimes/client";
import type { Diagnostic } from "#/runtimes/types";
import type { Lang } from "#/sim/types";

export type EditorTab = "main" | "helper";

interface CodeEditorProps {
	lang: Lang;
	tab: EditorTab;
	value: string;
	onChange: (value: string) => void;
	onRun: () => void;
	/** Errors from the last Run, shown until the next edit. */
	runDiagnostics: Diagnostic[];
	onServerStatus?: (status: RuntimeStatus) => void;
}

const HELPER_TEXT: Record<Lang, () => Promise<string>> = {
	python: async () => (await import("#/runtimes/python/files")).ROBOT_PYI,
	cpp: async () => (await import("#/runtimes/cpp/files")).ROBOT_H,
};

/** Monaco, loaded on the client, with a language server per language. */
export function CodeEditor({
	lang,
	tab,
	value,
	onChange,
	onRun,
	runDiagnostics,
	onServerStatus,
}: CodeEditorProps) {
	const host = useRef<HTMLDivElement>(null);
	const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<MonacoApi | null>(null);
	const [ready, setReady] = useState(false);
	const latest = useRef({ onChange, onRun, onServerStatus, value });
	latest.current = { onChange, onRun, onServerStatus, value };
	// The last text the editor itself reported, so we don't write it back.
	const emitted = useRef<string | null>(null);

	// Create the editor once.
	useEffect(() => {
		let disposed = false;
		let created: Monaco.editor.IStandaloneCodeEditor | null = null;
		void (async () => {
			const { loadMonaco } = await import("#/editor/monaco");
			const monaco = await loadMonaco();
			if (disposed || !host.current) return;
			monacoRef.current = monaco;
			created = monaco.editor.create(host.current, {
				theme: "rift-arena",
				automaticLayout: true,
				fontFamily:
					'"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Menlo, monospace',
				fontSize: 14,
				lineHeight: 22,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				padding: { top: 12, bottom: 12 },
				renderLineHighlight: "line",
				fixedOverflowWidgets: true,
				tabSize: 4,
				insertSpaces: true,
				detectIndentation: false,
				guides: { indentation: true },
				// Enter only accepts a suggestion when it adds something, so a newline stays a newline.
				acceptSuggestionOnEnter: "smart",
				"semanticHighlighting.enabled": false,
				scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
			});
			created.addAction({
				id: "pid.run",
				label: "Run",
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
				run: () => latest.current.onRun(),
			});
			created.onDidChangeModelContent(() => {
				const model = created?.getModel();
				if (!model || created?.getOption(monaco.editor.EditorOption.readOnly))
					return;
				monaco.editor.setModelMarkers(model, "run", []);
				emitted.current = model.getValue();
				latest.current.onChange(emitted.current);
			});
			editor.current = created;
			setReady(true);
		})();
		return () => {
			disposed = true;
			created?.dispose();
			editor.current = null;
		};
	}, []);

	// Point the editor at this language's model, and start its language server.
	useEffect(() => {
		const monaco = monacoRef.current;
		const instance = editor.current;
		if (!ready || !monaco || !instance) return;
		let cancelled = false;
		let unsubscribe: (() => void) | undefined;

		void (async () => {
			const { getLanguageServer } = await import("#/editor/lsp/servers");
			const uris = FILE_URIS[lang];
			const mainUri = monaco.Uri.parse(uris.main);
			const helperUri = monaco.Uri.parse(uris.helper);
			let main = monaco.editor.getModel(mainUri);
			const fresh = !main;
			if (!main)
				main = monaco.editor.createModel(latest.current.value, lang, mainUri);
			let helper = monaco.editor.getModel(helperUri);
			if (!helper)
				helper = monaco.editor.createModel(
					await HELPER_TEXT[lang](),
					lang,
					helperUri,
				);
			if (cancelled) return;

			const model = tab === "main" ? main : helper;
			if (instance.getModel() !== model) instance.setModel(model);
			instance.updateOptions({
				readOnly: tab === "helper",
				tabSize: lang === "python" ? 4 : 2,
			});
			if (tab === "main") instance.focus();

			const server = getLanguageServer(lang, monaco);
			unsubscribe = server.subscribe((status) =>
				latest.current.onServerStatus?.(status),
			);
			if (fresh) {
				server
					.start()
					.then((client) => {
						client.attach(main);
						client.attach(helper);
					})
					.catch(() => {
						// The editor still works; Run reports errors instead.
					});
			}
		})();
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [ready, lang, tab]);

	// Load new text (level change, reset, shared link). Text that came from the
	// editor itself is skipped, or a fast typist would lose keystrokes.
	useEffect(() => {
		const monaco = monacoRef.current;
		if (!ready || !monaco || value === emitted.current) return;
		const model = monaco.editor.getModel(
			monaco.Uri.parse(FILE_URIS[lang].main),
		);
		if (!model || model.getValue() === value) return;
		model.pushEditOperations(
			[],
			[{ range: model.getFullModelRange(), text: value }],
			() => null,
		);
	}, [ready, lang, value]);

	// Errors from the last Run.
	useEffect(() => {
		const monaco = monacoRef.current;
		if (!ready || !monaco) return;
		{
			const model = monaco.editor.getModel(
				monaco.Uri.parse(FILE_URIS[lang].main),
			);
			if (!model) return;
			monaco.editor.setModelMarkers(
				model,
				"run",
				runDiagnostics.map((d) => ({
					severity:
						d.severity === "error"
							? monaco.MarkerSeverity.Error
							: monaco.MarkerSeverity.Warning,
					message: d.message,
					startLineNumber: d.line,
					startColumn: d.column,
					endLineNumber: d.endLine ?? d.line,
					endColumn:
						d.endColumn ??
						model.getLineMaxColumn(
							Math.min(d.endLine ?? d.line, model.getLineCount()),
						),
				})),
			);
		}
	}, [ready, lang, runDiagnostics]);

	return (
		<div className="relative h-full min-h-0">
			<div ref={host} className="absolute inset-0" />
			{!ready && (
				<div className="absolute inset-0 flex items-center justify-center type-body-sm text-ink-muted">
					Loading the editor…
				</div>
			)}
		</div>
	);
}
