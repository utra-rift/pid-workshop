import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteHeader } from "#/components/site/SiteHeader";
import { Badge } from "#/components/ui/badge";
import { Progress } from "#/components/ui/progress";
import { LEVELS, sectionOf } from "#/levels";
import { storage, useStored } from "#/lib/storage";
import { cn } from "#/lib/utils";
import {
	type PrepareStatus,
	prepareLanguage,
	prepareProgress,
	watchPrepare,
} from "#/runtimes/prepare";
import type { Lang } from "#/sim/types";

export const Route = createFileRoute("/")({
	component: Home,
});

const LANGUAGES: {
	lang: Lang;
	name: string;
	blurb: string;
	tag?: string;
}[] = [
	{
		lang: "python",
		name: "Python",
		blurb:
			"Never written code before? Start here. Python has no braces, semicolons or type names to get wrong.",
		tag: "First time",
	},
	{
		lang: "cpp",
		name: "C++",
		blurb:
			"The language the robot runs. Clang compiles it in your browser and shows the same errors it would on a laptop.",
	},
];

function Home() {
	const navigate = useNavigate();
	const lang = useStored(storage.getLang, null);
	const progress = useStored(storage.getProgress, {});
	const next = LEVELS.find((level) => !progress[level.number]) ?? LEVELS[0];
	const started = Object.keys(progress).length > 0;

	// Everything a lesson needs downloads first, so it opens ready to run.
	const [preparing, setPreparing] = useState<Lang | null>(null);
	const [status, setStatus] = useState<PrepareStatus | null>(null);
	useEffect(() => {
		if (!preparing) return;
		return watchPrepare(preparing, setStatus);
	}, [preparing]);

	// A returning student's language starts downloading as soon as they arrive.
	useEffect(() => {
		const saved = storage.getLang();
		if (saved) void prepareLanguage(saved).catch(() => {});
	}, []);

	const start = async (choice: Lang) => {
		storage.setLang(choice);
		setPreparing(choice);
		try {
			await prepareLanguage(choice);
		} catch {
			return;
		}
		void navigate({ to: "/level/$levelId", params: { levelId: next.id } });
	};

	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader />
			<main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-12 sm:px-8 sm:py-16">
				<section className="flex flex-col gap-5">
					<p className="type-label text-cyan-text">RIFT · ARC Championships</p>
					<h1 className="type-display-lg max-w-3xl text-ink sm:type-display-xl">
						Learn PID
					</h1>
					<p className="type-body max-w-2xl text-ink-muted">
						PID controllers are about 20 lines of code. In this short course,
						you'll learn how to write and tune them.
					</p>
				</section>

				<section
					aria-labelledby="pick-language"
					className="flex flex-col gap-4"
				>
					<h2 id="pick-language" className="type-label text-ink-muted">
						Pick a language
					</h2>
					<div className="grid gap-4 sm:grid-cols-2">
						{LANGUAGES.map((option) => {
							const busy = preparing === option.lang;
							const progressValue =
								busy && status ? prepareProgress(status) : null;
							return (
								// A real link, so a click before the page hydrates still opens the
								// lesson (which then downloads with its own progress bar).
								<a
									key={option.lang}
									href={`/level/${next.id}?lang=${option.lang}`}
									onClick={(event) => {
										event.preventDefault();
										if (preparing === null || status?.error)
											void start(option.lang);
									}}
									aria-disabled={
										(preparing !== null && !status?.error) || undefined
									}
									aria-busy={busy && !status?.error}
									className={cn(
										"group flex cursor-pointer flex-col gap-3 rounded-md border bg-surface-raised p-6 text-left transition-colors hover:border-cyan aria-disabled:cursor-default",
										busy || (!preparing && lang === option.lang)
											? "border-cyan"
											: "border-line",
										preparing &&
											!busy &&
											!status?.error &&
											"opacity-50 hover:border-line",
									)}
								>
									<div className="flex items-center justify-between gap-3">
										<span className="type-display-sm text-ink">
											{option.name}
										</span>
										{option.tag && <Badge variant="cyan">{option.tag}</Badge>}
									</div>
									<p className="type-body-sm text-ink-muted">{option.blurb}</p>
									{busy && status?.error ? (
										<span className="mt-auto flex flex-col gap-1 type-body-sm">
											<span className="text-[#FF6B81]">
												Couldn't download: {status.error}
											</span>
											<span className="type-label text-cyan-text">
												Try again
											</span>
										</span>
									) : busy ? (
										<span className="mt-auto flex flex-col gap-2">
											<span className="flex items-center justify-between gap-3 type-label text-cyan-text">
												<span className="flex items-center gap-2">
													<LoaderCircle
														className="size-4 animate-spin"
														aria-hidden
													/>
													Getting {option.name} ready
												</span>
												<span className="inline-block w-[4ch] text-right type-data tabular-nums">
													{progressValue === null
														? ""
														: `${Math.round(progressValue * 100)}%`}
												</span>
											</span>
											<Progress value={(progressValue ?? 0) * 100} />
										</span>
									) : (
										<span className="mt-auto flex items-center gap-2 type-label text-cyan-text">
											{started && lang === option.lang
												? `Continue at level ${next.number}`
												: "Start level 1"}
											<ArrowRight
												className="size-4 transition-transform group-hover:translate-x-1"
												aria-hidden
											/>
										</span>
									)}
								</a>
							);
						})}
					</div>
					<p className="type-body-sm text-ink-muted">
						Picking a language downloads it first: about 10 MB for Python, 50 MB
						for C++. Your browser keeps a copy, so that only happens once. You
						can switch languages on any level.
					</p>
				</section>

				<section aria-labelledby="levels" className="flex flex-col gap-4">
					<h2 id="levels" className="type-label text-ink-muted">
						Levels
					</h2>
					<ol className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
						{LEVELS.map((level) => (
							<li
								key={level.id}
								className="flex items-baseline gap-3 bg-surface-raised px-4 py-3"
							>
								<span className="type-data text-ink-muted">
									{String(level.number).padStart(2, "0")}
								</span>
								<span className="type-body-sm text-ink">{level.title}</span>
								{sectionOf(level) !== "Arm" && (
									<span className="ml-auto type-label text-[11px] text-ink-muted">
										{sectionOf(level)}
									</span>
								)}
								{progress[level.number] && (
									<span className="ml-auto type-label text-[11px] text-cyan-text">
										Done
									</span>
								)}
							</li>
						))}
					</ol>
				</section>

				<footer className="mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 type-body-sm text-ink-muted">
					<span>Built for the RIFT controls workshop.</span>
					<span>
						Inspired by{" "}
						<a
							href="https://pid-playground.rishaan.cc/"
							className="text-link underline-offset-4 hover:underline"
						>
							PID Playground
						</a>
						. Tune the controller you wrote there next.
					</span>
				</footer>
			</main>
		</div>
	);
}
