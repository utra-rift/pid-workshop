import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteHeader } from "#/components/site/SiteHeader";
import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { storage, useStored } from "#/lib/storage";
import { getRuntime, type RuntimeStatus } from "#/runtimes/client";
import { fetchBytes } from "#/runtimes/rpc";
import type { Lang } from "#/sim/types";
import { TOOLS } from "#/tools";

export const Route = createFileRoute("/setup")({
	ssr: false,
	head: () => ({ meta: [{ title: "Setup · PID Workshop" }] }),
	component: Setup,
});

const PARTS: Record<
	Lang,
	{
		title: string;
		size: string;
		runtime: string;
		server: string;
		serverUrl: () => string;
	}
> = {
	python: {
		title: "Python",
		size: "about 10 MB",
		runtime: "Python runtime (Pyodide)",
		server: "Language server (basedpyright)",
		serverUrl: () => TOOLS.basedpyright.worker,
	},
	cpp: {
		title: "C++",
		size: "about 45 MB",
		runtime: "Compiler (clang)",
		server: "Language server (clangd)",
		serverUrl: () => TOOLS.clangd.wasm,
	},
};

const IDLE: RuntimeStatus = { state: "idle", loaded: 0, total: 0, label: "" };

function Setup() {
	const lang = useStored(storage.getLang, null);
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader />
			<main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-8">
				<section className="flex flex-col gap-3">
					<p className="type-label text-cyan-text">Before the workshop</p>
					<h1 className="type-display-lg text-ink">Get set up</h1>
					<p className="type-body text-ink-muted">
						Everything runs in your browser, so the first time you use a
						language it downloads a compiler or a Python runtime. Do it here on
						good wifi and your browser keeps a copy. Chrome, Edge, Firefox and
						Safari all work.
					</p>
				</section>
				{(["python", "cpp"] as const).map((l) => (
					<LanguageSetup key={l} lang={l} preferred={lang === l} />
				))}
				<Link
					to="/level/$levelId"
					params={{ levelId: "01-on-off" }}
					className="type-label text-cyan-text underline-offset-4 hover:underline"
				>
					Go to level 1 →
				</Link>
			</main>
		</div>
	);
}

function LanguageSetup({
	lang,
	preferred,
}: {
	lang: Lang;
	preferred: boolean;
}) {
	const part = PARTS[lang];
	const [runtime, setRuntime] = useState<RuntimeStatus>(IDLE);
	const [server, setServer] = useState<RuntimeStatus>(IDLE);
	const [started, setStarted] = useState(false);

	useEffect(() => getRuntime(lang).subscribe(setRuntime), [lang]);

	const start = () => {
		setStarted(true);
		void getRuntime(lang)
			.ready()
			.catch(() => {});
		setServer({ ...IDLE, state: "loading" });
		fetchBytes(part.serverUrl(), part.server, (loaded, total) =>
			setServer({ state: "loading", loaded, total, label: part.server }),
		)
			.then(() => setServer((s) => ({ ...s, state: "ready" })))
			.catch((error) =>
				setServer({
					...IDLE,
					state: "failed",
					error: String(error?.message ?? error),
				}),
			);
	};

	const done = runtime.state === "ready" && server.state === "ready";
	return (
		<section className="flex flex-col gap-4 rounded-md border border-line bg-surface-raised p-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 className="type-display-sm text-ink">{part.title}</h2>
					<p className="type-body-sm text-ink-muted">{part.size}</p>
				</div>
				{done ? (
					<span className="flex items-center gap-2 type-label text-cyan-text">
						<Check className="size-4" aria-hidden /> Ready
					</span>
				) : (
					<Button
						variant={preferred ? "accent" : "outline"}
						size="sm"
						onClick={start}
						disabled={started}
					>
						{started ? "Downloading" : "Download"}
					</Button>
				)}
			</div>
			{started && (
				<div className="flex flex-col gap-3">
					<StatusRow label={part.runtime} status={runtime} />
					<StatusRow label={part.server} status={server} />
				</div>
			)}
		</section>
	);
}

function StatusRow({
	label,
	status,
}: {
	label: string;
	status: RuntimeStatus;
}) {
	const percent =
		status.state === "ready"
			? 100
			: status.total
				? Math.round((status.loaded / status.total) * 100)
				: 0;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex justify-between gap-3 type-body-sm">
				<span className="text-ink">{label}</span>
				<span className="type-data text-ink-muted">
					{status.state === "failed"
						? "Failed"
						: status.state === "ready"
							? "Done"
							: status.total
								? `${(status.loaded / 1e6).toFixed(1)} / ${(status.total / 1e6).toFixed(1)} MB`
								: "Starting"}
				</span>
			</div>
			<Progress value={percent} />
			{status.error && (
				<p className="type-body-sm text-[#FF6B81]">{status.error}</p>
			)}
		</div>
	);
}
