import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { History, Play, RotateCcw, Share2, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Grade, grade as gradeRun } from "#/coach/grade";
import { ArmView } from "#/components/play/ArmView";
import { CodeEditor, type EditorTab } from "#/components/play/CodeEditor";
import { type ConsoleLine, ConsolePane } from "#/components/play/ConsolePane";
import { FlywheelView } from "#/components/play/FlywheelView";
import { LevelBrief } from "#/components/play/LevelBrief";
import { LevelRail } from "#/components/play/LevelRail";
import { MetricsRow } from "#/components/play/MetricsRow";
import { ResponseChart } from "#/components/play/ResponseChart";
import { usePlayback } from "#/components/play/usePlayback";
import { Verdict } from "#/components/play/Verdict";
import { SiteHeader } from "#/components/site/SiteHeader";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { ENTRY, getLevel, LEVELS, type Level } from "#/levels";
import { readSharedCode, shareUrl } from "#/lib/share";
import { storage, useStored } from "#/lib/storage";
import { cn } from "#/lib/utils";
import { getRuntime, type RuntimeStatus } from "#/runtimes/client";
import type { Diagnostic, RunResponse } from "#/runtimes/types";
import { computeMetrics } from "#/sim/metrics";
import { MECHANISMS } from "#/sim/robot";
import type { Lang } from "#/sim/types";

interface LevelSearch {
	lang?: Lang;
	instructor?: "1" | "0";
}

export const Route = createFileRoute("/level/$levelId")({
	// Monaco, Pyodide and clang only run in the browser.
	ssr: false,
	// Search values arrive JSON-parsed, so ?instructor=1 is the number 1.
	validateSearch: (search: Record<string, unknown>): LevelSearch => ({
		lang:
			search.lang === "cpp" || search.lang === "python"
				? search.lang
				: undefined,
		instructor: [1, "1", true].includes(search.instructor as never)
			? "1"
			: [0, "0", false].includes(search.instructor as never)
				? "0"
				: undefined,
	}),
	loader: ({ params }) => {
		const level = getLevel(params.levelId);
		if (!level) throw notFound();
		return { levelId: level.id };
	},
	head: ({ params }) => {
		const level = getLevel(params.levelId);
		return {
			meta: [
				{
					title: level
						? `${level.number}. ${level.title} · Learn PID`
						: "Learn PID",
				},
			],
		};
	},
	component: LevelPage,
	notFoundComponent: () => (
		<div className="flex min-h-screen flex-col">
			<SiteHeader />
			<main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-16">
				<h1 className="type-display-sm">No such level</h1>
				<Link to="/" className="text-link underline-offset-4 hover:underline">
					Back to the start
				</Link>
			</main>
		</div>
	),
});

const IDLE: RuntimeStatus = { state: "idle", loaded: 0, total: 0, label: "" };

function initialCode(level: Level, lang: Lang): string {
	return storage.getCode(level.number, lang) ?? level.starter[lang];
}

function LevelPage() {
	const { levelId } = Route.useLoaderData();
	const level = getLevel(levelId) as Level;
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	// A share link carries code in the hash. Read it once, before anything rewrites the URL.
	const sharedCode = useRef<string | null | undefined>(undefined);
	if (sharedCode.current === undefined) sharedCode.current = readSharedCode();

	// Search params set persistent preferences; then the URL goes back to plain.
	useEffect(() => {
		if (search.instructor) storage.setInstructor(search.instructor === "1");
		if (search.lang) storage.setLang(search.lang);
		if (search.instructor || search.lang || location.hash) {
			void navigate({ search: {}, hash: "", replace: true });
		}
	}, [search.instructor, search.lang, navigate]);

	const storedLang = useStored(storage.getLang, null);
	const lang: Lang = search.lang ?? storedLang ?? "python";
	const instructor = useStored(storage.isInstructor, false);
	const progress = useStored(storage.getProgress, {});

	const isUnlocked = useCallback(
		(l: Level) =>
			instructor || l.number === 1 || Boolean(progress[l.number - 1]),
		[instructor, progress],
	);
	const unlocked = isUnlocked(level);
	const next = LEVELS[level.number];
	const previous = LEVELS[level.number - 2];
	// Passing code carries over from the last level with the same mechanism.
	const carryFrom = LEVELS.slice(0, level.number - 1)
		.reverse()
		.find((l) => l.spec.mechanism === level.spec.mechanism);
	const previousCode = carryFrom
		? storage.getPassedCode(carryFrom.number, lang)
		: null;

	// Code for this level and language.
	const [code, setCode] = useState(() => initialCode(level, lang));
	const [tab, setTab] = useState<EditorTab>("main");
	useEffect(() => {
		const shared = sharedCode.current;
		if (shared) {
			sharedCode.current = null;
			storage.setCode(level.number, lang, shared);
			setCode(shared);
			return;
		}
		setCode(initialCode(level, lang));
	}, [level, lang]);

	const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const updateCode = useCallback(
		(value: string) => {
			setCode(value);
			clearTimeout(saveTimer.current);
			saveTimer.current = setTimeout(
				() => storage.setCode(level.number, lang, value),
				400,
			);
		},
		[level.number, lang],
	);
	const replaceCode = (value: string) => {
		storage.setCode(level.number, lang, value);
		setCode(value);
		setTab("main");
	};

	// Hints.
	const hintsShown = useStored(() => storage.getHints(level.number), 0);
	const [failedRuns, setFailedRuns] = useState(0);
	const showAnswer =
		instructor || (hintsShown >= level.hints.length && failedRuns >= 2);

	// Toolchain and language server status.
	const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(IDLE);
	const [serverStatus, setServerStatus] = useState<RuntimeStatus>(IDLE);
	useEffect(() => {
		const runtime = getRuntime(lang);
		const unsubscribe = runtime.subscribe(setRuntimeStatus);
		void runtime.ready().catch(() => {});
		return unsubscribe;
	}, [lang]);

	// Running and grading.
	const [response, setResponse] = useState<RunResponse | null>(null);
	const [grade, setGrade] = useState<Grade | null>(null);
	const [running, setRunning] = useState(false);
	const [selected, setSelected] = useState(0);
	const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
	const [runDiagnostics, setRunDiagnostics] = useState<Diagnostic[]>([]);
	const playback = usePlayback(level.spec.durationS);

	// A different level or language starts clean.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on level or language change only
	useEffect(() => {
		setResponse(null);
		setGrade(null);
		setConsoleLines([]);
		setRunDiagnostics([]);
		setFailedRuns(0);
		setSelected(0);
		playback.reset();
	}, [level.id, lang]);

	const run = useCallback(async () => {
		if (running) return;
		setRunning(true);
		setTab("main");
		playback.reset();
		try {
			const runtime = getRuntime(lang);
			await runtime.ready();
			const result = await runtime.run({
				source: code,
				spec: level.spec,
				variants: level.variants,
				entry: ENTRY,
			});
			const g = gradeRun(level, result.build, result.results);
			setResponse(result);
			setGrade(g);

			const failing = g.variants.findIndex((v) => !v.passed);
			const shown =
				failing > 0 && !g.variants[0].passed ? 0 : Math.max(0, failing);
			setSelected(g.passed ? 0 : shown);

			const lines: ConsoleLine[] = [];
			if (result.build.output) {
				lines.push({
					text: result.build.output,
					kind: result.build.ok ? "warning" : "error",
				});
			}
			const shownRun = result.results[g.passed ? 0 : shown];
			for (const log of shownRun?.logs ?? [])
				lines.push({ text: log, kind: "log" });
			const issue = g.variants.find((v) => v.issue)?.issue;
			if (issue?.detail && issue.detail !== result.build.output)
				lines.push({ text: issue.detail, kind: "error" });
			lines.push({
				text: `${g.passed ? "Passed" : "Not yet"}: ${g.variants.map((v) => `${v.variant.name} ${v.passed ? "✓" : "✗"}`).join(", ")}`,
				kind: "info",
			});
			setConsoleLines(lines);

			const diagnostics = [...result.build.diagnostics];
			if (g.line && !diagnostics.some((d) => d.line === g.line)) {
				diagnostics.push({
					line: g.line,
					column: 1,
					severity: "error",
					message: g.message,
				});
			}
			setRunDiagnostics(diagnostics);

			if (g.passed) storage.markPassed(level.number, lang, code);
			else setFailedRuns((n) => n + 1);
			if (result.results.length) playback.play(0);
		} catch (error) {
			setGrade({
				passed: false,
				title: "Couldn't run",
				message: `Something went wrong loading the ${lang === "cpp" ? "C++ compiler" : "Python runtime"}: ${String((error as Error)?.message ?? error)}`,
				variants: [],
			});
		} finally {
			setRunning(false);
		}
	}, [running, lang, code, level, playback]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
				event.preventDefault();
				void run();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [run]);

	const shownVariant = grade?.variants[selected];
	const shownRun = response?.results[selected] ?? null;
	const metrics = useMemo(
		() =>
			shownRun && !shownRun.issue ? computeMetrics(level.spec, shownRun) : null,
		[shownRun, level.spec],
	);

	const [copied, setCopied] = useState(false);
	const share = async () => {
		await navigator.clipboard.writeText(shareUrl(level.id, lang, code));
		setCopied(true);
		setTimeout(() => setCopied(false), 1600);
	};

	const loading =
		runtimeStatus.state === "loading" || runtimeStatus.state === "idle";
	const percent = runtimeStatus.total
		? Math.round((runtimeStatus.loaded / runtimeStatus.total) * 100)
		: 0;

	return (
		<TooltipProvider>
			<div className="flex min-h-screen flex-col">
				<SiteHeader>
					<LevelRail
						levels={LEVELS}
						currentId={level.id}
						passed={progress}
						isUnlocked={isUnlocked}
					/>
				</SiteHeader>

				{!unlocked ? (
					<main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-16">
						<h1 className="type-display-sm">Locked</h1>
						<p className="type-body text-ink-muted">
							Pass level {level.number - 1} first.
						</p>
						<Link
							to="/level/$levelId"
							params={{ levelId: previous?.id ?? LEVELS[0].id }}
							className="text-link underline-offset-4 hover:underline"
						>
							Go to {previous?.title}
						</Link>
					</main>
				) : (
					<main className="grid flex-1 gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:grid-rows-[auto_1fr]">
						{/* DOM order is for narrow screens: the level, then the code, then the mechanism. */}
						<div className="min-w-0 xl:col-start-1 xl:row-start-1">
							<LevelBrief
								level={level}
								lang={lang}
								hintsShown={hintsShown}
								onShowHint={() =>
									storage.setHints(level.number, hintsShown + 1)
								}
								showAnswer={showAnswer}
								onUseAnswer={() => replaceCode(level.solution[lang])}
							/>
						</div>

						<div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:h-[calc(100vh-2rem)] xl:self-start">
							<section
								aria-label="Your code"
								className="flex min-h-[560px] flex-1 flex-col overflow-hidden rounded-md border border-line bg-surface-raised"
							>
								<div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
									<ToggleGroup
										type="single"
										variant="outline"
										size="sm"
										value={lang}
										onValueChange={(value) =>
											value && storage.setLang(value as Lang)
										}
										aria-label="Language"
									>
										<ToggleGroupItem value="python">Python</ToggleGroupItem>
										<ToggleGroupItem value="cpp">C++</ToggleGroupItem>
									</ToggleGroup>
									<div
										className="flex items-center"
										role="tablist"
										aria-label="Files"
									>
										{(["main", "helper"] as const).map((t) => (
											<button
												key={t}
												type="button"
												role="tab"
												aria-selected={tab === t}
												onClick={() => setTab(t)}
												className={cn(
													"cursor-pointer border-b-2 px-2.5 py-1 font-mono text-[12px] transition-colors",
													tab === t
														? "border-cyan text-ink"
														: "border-transparent text-ink-muted hover:text-ink",
												)}
											>
												{t === "main"
													? lang === "python"
														? "controller.py"
														: "controller.cpp"
													: lang === "python"
														? "robot.py"
														: "robot.h"}
											</button>
										))}
									</div>
									<div className="ml-auto flex items-center gap-1">
										{previousCode && previousCode !== code && (
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon-sm"
														aria-label={`Use my code from level ${carryFrom?.number}`}
														onClick={() => replaceCode(previousCode)}
													>
														<History />
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													Use your passing code from level {carryFrom?.number}
												</TooltipContent>
											</Tooltip>
										)}
										<AlertDialog>
											<Tooltip>
												<TooltipTrigger asChild>
													<AlertDialogTrigger asChild>
														<Button
															variant="ghost"
															size="icon-sm"
															aria-label="Reset code"
														>
															<RotateCcw />
														</Button>
													</AlertDialogTrigger>
												</TooltipTrigger>
												<TooltipContent>
													Start over from the level's starter code
												</TooltipContent>
											</Tooltip>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Start over?</AlertDialogTitle>
													<AlertDialogDescription>
														This replaces your{" "}
														{lang === "cpp" ? "C++" : "Python"} code for this
														level with the starter code.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Keep my code</AlertDialogCancel>
													<AlertDialogAction
														onClick={() => replaceCode(level.starter[lang])}
													>
														Start over
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label="Copy a share link"
													onClick={share}
												>
													<Share2 />
												</Button>
											</TooltipTrigger>
											<TooltipContent>
												{copied ? "Link copied" : "Copy a link to this code"}
											</TooltipContent>
										</Tooltip>
										<Button
											variant="accent"
											size="sm"
											onClick={run}
											disabled={running}
										>
											<Play />
											Run
										</Button>
									</div>
								</div>

								{loading && (
									<div className="flex items-center gap-3 border-b border-line px-4 py-2">
										<span className="type-body-sm whitespace-nowrap text-ink-muted">
											{runtimeStatus.label
												? `Downloading ${runtimeStatus.label}`
												: "Starting"}
											{percent ? ` · ${percent}%` : ""}
										</span>
										<Progress value={percent} className="flex-1" />
									</div>
								)}
								{runtimeStatus.state === "failed" && (
									<p className="border-b border-line px-4 py-2 type-body-sm text-[#FF6B81]">
										Couldn't load the{" "}
										{lang === "cpp" ? "C++ compiler" : "Python runtime"}:{" "}
										{runtimeStatus.error}
									</p>
								)}

								<div className="min-h-0 flex-1">
									<CodeEditor
										lang={lang}
										tab={tab}
										value={code}
										onChange={updateCode}
										onRun={run}
										runDiagnostics={runDiagnostics}
										onServerStatus={setServerStatus}
									/>
								</div>

								<div className="flex items-center justify-between gap-3 border-t border-line px-4 py-1.5 type-data text-[11px] text-ink-muted">
									<span>{serverLabel(lang, serverStatus)}</span>
									<span>
										{runtimeStatus.state === "ready"
											? `${lang === "cpp" ? "clang" : "Python"} ready`
											: ""}
									</span>
								</div>
								<ConsolePane
									lines={consoleLines}
									className="h-36 border-t border-line"
								/>
							</section>

							<Verdict
								grade={grade}
								running={running}
								loadingLabel={loading ? "Loading" : "Running"}
								next={grade?.passed ? next : undefined}
							/>
						</div>

						<div className="flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-2">
							<section
								aria-label={`The ${MECHANISMS[level.spec.mechanism].name}`}
								className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised p-4"
							>
								<div className="flex items-center justify-between gap-3">
									<span className="type-label text-ink-muted">
										The {MECHANISMS[level.spec.mechanism].name}
										{shownVariant && grade && grade.variants.length > 1
											? ` · ${shownVariant.variant.name}`
											: ""}
									</span>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Replay"
											disabled={!response?.results.length}
											onClick={() => playback.play(0)}
										>
											<RotateCcw />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Skip to the end"
											disabled={!playback.playing}
											onClick={playback.skip}
										>
											<SkipForward />
										</Button>
									</div>
								</div>
								<div className="mx-auto w-full max-w-xl">
									{level.spec.mechanism === "flywheel" ? (
										<FlywheelView
											spec={level.spec}
											variant={shownVariant?.variant ?? level.variants[0]}
											run={shownRun}
											t={playback.t}
										/>
									) : (
										<ArmView
											spec={level.spec}
											variant={shownVariant?.variant ?? level.variants[0]}
											run={shownRun}
											t={playback.t}
										/>
									)}
								</div>
							</section>

							<section
								aria-label="Response"
								className="rounded-md border border-line bg-surface-raised p-4"
							>
								<ResponseChart
									spec={level.spec}
									run={shownRun}
									t={playback.t}
								/>
							</section>

							<MetricsRow
								spec={level.spec}
								metrics={metrics}
								variants={grade?.variants ?? []}
								selected={selected}
								onSelect={(i) => {
									setSelected(i);
									playback.play(0);
								}}
							/>
						</div>
					</main>
				)}
			</div>
		</TooltipProvider>
	);
}

function serverLabel(lang: Lang, status: RuntimeStatus): string {
	const name = lang === "cpp" ? "clangd" : "basedpyright";
	switch (status.state) {
		case "ready":
			return `${name}: checking as you type`;
		case "loading":
			return status.total
				? `${name}: loading ${Math.round((status.loaded / status.total) * 100)}%`
				: `${name}: starting`;
		case "failed":
			return `${name} didn't start. Run still shows errors.`;
		default:
			return "";
	}
}
