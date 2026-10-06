import type * as Monaco from "monaco-editor";
import {
	type CompletionItem,
	CompletionItemKind,
	type CompletionList,
	createProtocolConnection,
	type Diagnostic,
	DiagnosticSeverity,
	DiagnosticTag,
	type Hover,
	type InitializeResult,
	InsertTextFormat,
	type Location,
	type LocationLink,
	type MarkedString,
	type MarkupContent,
	type MessageReader,
	type MessageWriter,
	type ProtocolConnection,
	type PublishDiagnosticsParams,
	type Range,
	type SignatureHelp,
	type TextEdit,
} from "vscode-languageserver-protocol/browser";
import type { MonacoApi } from "../monaco";

export interface LspClientOptions {
	/** Shown as the source of diagnostics. */
	name: string;
	languageId: string;
	monaco: MonacoApi;
	reader: MessageReader;
	writer: MessageWriter;
	rootUri: string;
	initializationOptions?: unknown;
	/** Answers workspace/configuration requests. */
	configuration?: (section: string | undefined) => unknown;
}

/**
 * A small LSP client for Monaco, scoped to one language and the models attached
 * to it. Covers what students use: errors as you type, completion, hover,
 * signature help and go to definition.
 */
export class LspClient {
	private connection: ProtocolConnection;
	private capabilities: InitializeResult["capabilities"] = {};
	private readonly models = new Map<
		string,
		{
			model: Monaco.editor.ITextModel;
			version: number;
			dirty: boolean;
			timer?: ReturnType<typeof setTimeout>;
		}
	>();
	private readonly disposables: Monaco.IDisposable[] = [];
	private started?: Promise<void>;

	constructor(private readonly options: LspClientOptions) {
		this.connection = createProtocolConnection(options.reader, options.writer);
	}

	start(): Promise<void> {
		this.started ??= this.initialize();
		return this.started;
	}

	private async initialize() {
		const { connection, options } = this;
		// localStorage["pid:debug-lsp"] = "1" logs the traffic to the console.
		if (
			typeof localStorage !== "undefined" &&
			localStorage.getItem("pid:debug-lsp")
		) {
			connection.trace(2, {
				log: (message: string, data?: string) =>
					console.debug(`[${options.name}]`, message, data ?? ""),
			});
		}
		connection.onNotification(
			"textDocument/publishDiagnostics",
			(params: PublishDiagnosticsParams) => this.showDiagnostics(params),
		);
		connection.onRequest(
			"workspace/configuration",
			(params: { items: { section?: string }[] }) =>
				params.items.map(
					(item) => options.configuration?.(item.section) ?? null,
				),
		);
		connection.onRequest("client/registerCapability", () => null);
		connection.onRequest("client/unregisterCapability", () => null);
		connection.onRequest("window/workDoneProgress/create", () => null);
		connection.onNotification("window/logMessage", () => {});
		connection.onNotification("$/progress", () => {});
		connection.listen();

		const result: InitializeResult = await connection.sendRequest(
			"initialize",
			{
				processId: null,
				rootUri: options.rootUri,
				workspaceFolders: [{ uri: options.rootUri, name: "workspace" }],
				initializationOptions: options.initializationOptions,
				capabilities: {
					workspace: { configuration: true, workspaceFolders: true },
					textDocument: {
						synchronization: { dynamicRegistration: false, didSave: false },
						publishDiagnostics: {
							relatedInformation: false,
							tagSupport: { valueSet: [1, 2] },
						},
						completion: {
							completionItem: {
								snippetSupport: true,
								documentationFormat: ["markdown", "plaintext"],
								insertReplaceSupport: false,
							},
							contextSupport: true,
						},
						hover: { contentFormat: ["markdown", "plaintext"] },
						signatureHelp: {
							signatureInformation: {
								documentationFormat: ["markdown", "plaintext"],
								parameterInformation: { labelOffsetSupport: true },
							},
						},
						definition: { linkSupport: false },
					},
				},
			},
		);
		this.capabilities = result.capabilities;
		connection.sendNotification("initialized", {});
		connection.sendNotification("workspace/didChangeConfiguration", {
			settings: {},
		});
		this.registerProviders();
	}

	/** Starts syncing a model with the server. */
	attach(model: Monaco.editor.ITextModel): Monaco.IDisposable {
		const uri = model.uri.toString();
		const entry = { model, version: 1, dirty: false } as {
			model: Monaco.editor.ITextModel;
			version: number;
			dirty: boolean;
			timer?: ReturnType<typeof setTimeout>;
		};
		this.models.set(uri, entry);
		void this.start().then(() =>
			this.connection.sendNotification("textDocument/didOpen", {
				textDocument: {
					uri,
					languageId: this.options.languageId,
					version: entry.version,
					text: model.getValue(),
				},
			}),
		);
		const change = model.onDidChangeContent(() => {
			entry.dirty = true;
			clearTimeout(entry.timer);
			entry.timer = setTimeout(() => this.flush(uri), 250);
		});
		return {
			dispose: () => {
				change.dispose();
				clearTimeout(entry.timer);
				this.models.delete(uri);
				this.options.monaco.editor.setModelMarkers(
					model,
					this.options.name,
					[],
				);
				void this.started?.then(() =>
					this.connection.sendNotification("textDocument/didClose", {
						textDocument: { uri },
					}),
				);
			},
		};
	}

	/** Sends pending edits, so a request sees the text the student sees. */
	private flush(uri: string) {
		const entry = this.models.get(uri);
		if (!entry?.dirty) return;
		clearTimeout(entry.timer);
		entry.dirty = false;
		entry.version++;
		this.connection.sendNotification("textDocument/didChange", {
			textDocument: { uri, version: entry.version },
			contentChanges: [{ text: entry.model.getValue() }],
		});
	}

	private tracked(model: Monaco.editor.ITextModel): string | undefined {
		const uri = model.uri.toString();
		if (!this.models.has(uri)) return undefined;
		this.flush(uri);
		return uri;
	}

	private showDiagnostics({ uri, diagnostics }: PublishDiagnosticsParams) {
		const { monaco, name } = this.options;
		const model = monaco.editor.getModel(monaco.Uri.parse(uri));
		if (!model) return;
		monaco.editor.setModelMarkers(
			model,
			name,
			diagnostics.map((d) => toMarker(monaco, d, name)),
		);
	}

	private registerProviders() {
		const { monaco, languageId } = this.options;
		const caps = this.capabilities;
		const connection = this.connection;

		if (caps.completionProvider) {
			const resolve = caps.completionProvider.resolveProvider;
			this.disposables.push(
				monaco.languages.registerCompletionItemProvider(languageId, {
					triggerCharacters: caps.completionProvider.triggerCharacters,
					provideCompletionItems: async (model, position, context) => {
						const uri = this.tracked(model);
						if (!uri) return undefined;
						const result: CompletionItem[] | CompletionList | null =
							await connection.sendRequest("textDocument/completion", {
								textDocument: { uri },
								position: toPosition(position),
								context: {
									triggerKind: context.triggerKind + 1,
									triggerCharacter: context.triggerCharacter,
								},
							});
						if (!result) return undefined;
						const items = Array.isArray(result) ? result : result.items;
						const word = model.getWordUntilPosition(position);
						const fallback = new monaco.Range(
							position.lineNumber,
							word.startColumn,
							position.lineNumber,
							word.endColumn,
						);
						return {
							incomplete: !Array.isArray(result) && result.isIncomplete,
							suggestions: items.map((item) =>
								toCompletion(monaco, item, fallback),
							),
						};
					},
					resolveCompletionItem: resolve
						? async (item) => {
								const original = (item as { lsp?: CompletionItem }).lsp;
								if (!original) return item;
								const resolved: CompletionItem = await connection.sendRequest(
									"completionItem/resolve",
									original,
								);
								if (resolved.documentation)
									item.documentation = toMarkdown(resolved.documentation);
								if (resolved.detail) item.detail = resolved.detail;
								return item;
							}
						: undefined,
				}),
			);
		}

		if (caps.hoverProvider) {
			this.disposables.push(
				monaco.languages.registerHoverProvider(languageId, {
					provideHover: async (model, position) => {
						const uri = this.tracked(model);
						if (!uri) return undefined;
						const hover: Hover | null = await connection.sendRequest(
							"textDocument/hover",
							{
								textDocument: { uri },
								position: toPosition(position),
							},
						);
						if (!hover) return undefined;
						const contents = Array.isArray(hover.contents)
							? hover.contents
							: [hover.contents];
						return {
							contents: contents
								.map((c) => toMarkdown(c))
								.filter((c) => c.value.trim()),
							range: hover.range ? toRange(monaco, hover.range) : undefined,
						};
					},
				}),
			);
		}

		if (caps.signatureHelpProvider) {
			this.disposables.push(
				monaco.languages.registerSignatureHelpProvider(languageId, {
					signatureHelpTriggerCharacters:
						caps.signatureHelpProvider.triggerCharacters,
					signatureHelpRetriggerCharacters:
						caps.signatureHelpProvider.retriggerCharacters,
					provideSignatureHelp: async (model, position) => {
						const uri = this.tracked(model);
						if (!uri) return undefined;
						const help: SignatureHelp | null = await connection.sendRequest(
							"textDocument/signatureHelp",
							{
								textDocument: { uri },
								position: toPosition(position),
							},
						);
						if (!help?.signatures.length) return undefined;
						return {
							value: {
								activeSignature: help.activeSignature ?? 0,
								activeParameter: help.activeParameter ?? 0,
								signatures: help.signatures.map((s) => ({
									label: s.label,
									documentation: s.documentation
										? toMarkdown(s.documentation)
										: undefined,
									parameters: (s.parameters ?? []).map((p) => ({
										label: p.label,
										documentation: p.documentation
											? toMarkdown(p.documentation)
											: undefined,
									})),
									activeParameter: s.activeParameter ?? undefined,
								})),
							},
							dispose: () => {},
						};
					},
				}),
			);
		}

		if (caps.definitionProvider) {
			this.disposables.push(
				monaco.languages.registerDefinitionProvider(languageId, {
					provideDefinition: async (model, position) => {
						const uri = this.tracked(model);
						if (!uri) return undefined;
						const result: Location | Location[] | LocationLink[] | null =
							await connection.sendRequest("textDocument/definition", {
								textDocument: { uri },
								position: toPosition(position),
							});
						if (!result) return undefined;
						const list = Array.isArray(result) ? result : [result];
						return list.map((loc) =>
							"targetUri" in loc
								? {
										uri: monaco.Uri.parse(loc.targetUri),
										range: toRange(monaco, loc.targetSelectionRange),
									}
								: {
										uri: monaco.Uri.parse(loc.uri),
										range: toRange(monaco, loc.range),
									},
						);
					},
				}),
			);
		}
	}

	dispose() {
		for (const d of this.disposables) d.dispose();
		this.disposables.length = 0;
		void this.started
			?.then(() => this.connection.sendRequest("shutdown"))
			.then(() => this.connection.sendNotification("exit"))
			.catch(() => {})
			.finally(() => this.connection.dispose());
	}
}

function toPosition(position: Monaco.Position) {
	return { line: position.lineNumber - 1, character: position.column - 1 };
}

function toRange(monaco: MonacoApi, range: Range): Monaco.Range {
	return new monaco.Range(
		range.start.line + 1,
		range.start.character + 1,
		range.end.line + 1,
		range.end.character + 1,
	);
}

function toMarkdown(
	content: MarkupContent | MarkedString | string,
): Monaco.IMarkdownString {
	if (typeof content === "string") return { value: content };
	if ("kind" in content) {
		return {
			value:
				content.kind === "markdown"
					? content.value
					: escapeMarkdown(content.value),
		};
	}
	return { value: `\`\`\`${content.language}\n${content.value}\n\`\`\`` };
}

function escapeMarkdown(text: string) {
	return text.replace(/[\\`*_{}[\]()#+\-.!<>]/g, "\\$&");
}

function toMarker(
	monaco: MonacoApi,
	d: Diagnostic,
	source: string,
): Monaco.editor.IMarkerData {
	const severity =
		d.severity === DiagnosticSeverity.Error
			? monaco.MarkerSeverity.Error
			: d.severity === DiagnosticSeverity.Warning
				? monaco.MarkerSeverity.Warning
				: d.severity === DiagnosticSeverity.Information
					? monaco.MarkerSeverity.Info
					: monaco.MarkerSeverity.Hint;
	return {
		severity,
		message: typeof d.message === "string" ? d.message : d.message.value,
		source: d.source ?? source,
		code: typeof d.code === "number" ? String(d.code) : d.code,
		startLineNumber: d.range.start.line + 1,
		startColumn: d.range.start.character + 1,
		endLineNumber: d.range.end.line + 1,
		endColumn: d.range.end.character + 1,
		tags: d.tags?.map((tag) =>
			tag === DiagnosticTag.Unnecessary
				? monaco.MarkerTag.Unnecessary
				: monaco.MarkerTag.Deprecated,
		),
	};
}

const KIND: Partial<
	Record<CompletionItemKind, keyof typeof Monaco.languages.CompletionItemKind>
> = {
	[CompletionItemKind.Text]: "Text",
	[CompletionItemKind.Method]: "Method",
	[CompletionItemKind.Function]: "Function",
	[CompletionItemKind.Constructor]: "Constructor",
	[CompletionItemKind.Field]: "Field",
	[CompletionItemKind.Variable]: "Variable",
	[CompletionItemKind.Class]: "Class",
	[CompletionItemKind.Interface]: "Interface",
	[CompletionItemKind.Module]: "Module",
	[CompletionItemKind.Property]: "Property",
	[CompletionItemKind.Unit]: "Unit",
	[CompletionItemKind.Value]: "Value",
	[CompletionItemKind.Enum]: "Enum",
	[CompletionItemKind.Keyword]: "Keyword",
	[CompletionItemKind.Snippet]: "Snippet",
	[CompletionItemKind.Color]: "Color",
	[CompletionItemKind.File]: "File",
	[CompletionItemKind.Reference]: "Reference",
	[CompletionItemKind.Folder]: "Folder",
	[CompletionItemKind.EnumMember]: "EnumMember",
	[CompletionItemKind.Constant]: "Constant",
	[CompletionItemKind.Struct]: "Struct",
	[CompletionItemKind.Event]: "Event",
	[CompletionItemKind.Operator]: "Operator",
	[CompletionItemKind.TypeParameter]: "TypeParameter",
};

function toCompletion(
	monaco: MonacoApi,
	item: CompletionItem,
	fallback: Monaco.IRange,
): Monaco.languages.CompletionItem {
	const edit = item.textEdit as
		| TextEdit
		| { newText: string; insert: Range; replace: Range }
		| undefined;
	const range = edit
		? toRange(monaco, "range" in edit ? edit.range : edit.replace)
		: fallback;
	const snippet = item.insertTextFormat === InsertTextFormat.Snippet;
	const completion: Monaco.languages.CompletionItem & { lsp?: CompletionItem } =
		{
			label: item.label,
			kind: monaco.languages.CompletionItemKind[
				KIND[item.kind ?? CompletionItemKind.Text] ?? "Text"
			],
			detail: item.detail,
			documentation: item.documentation
				? toMarkdown(item.documentation)
				: undefined,
			insertText: edit?.newText ?? item.insertText ?? item.label,
			insertTextRules: snippet
				? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
				: undefined,
			range,
			sortText: item.sortText,
			filterText: item.filterText,
			preselect: item.preselect,
			additionalTextEdits: item.additionalTextEdits?.map((e) => ({
				range: toRange(monaco, e.range),
				text: e.newText,
			})),
			commitCharacters: item.commitCharacters,
			lsp: item,
		};
	return completion;
}
