import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "#/components/site/SiteHeader";
import { Badge } from "#/components/ui/badge";
import { LEVELS } from "#/levels";
import { storage, useStored } from "#/lib/storage";
import { cn } from "#/lib/utils";
import type { Lang } from "#/sim/types";

export const Route = createFileRoute("/")({
	component: Home,
});

const LANGUAGES: { lang: Lang; name: string; blurb: string; tag?: string }[] = [
	{
		lang: "python",
		name: "Python",
		blurb:
			"Never written code before? Start here. Short to type and easy to read.",
		tag: "First time",
	},
	{
		lang: "cpp",
		name: "C++",
		blurb:
			"What runs on the robot. Compiled in your browser with the real clang.",
	},
];

function Home() {
	const navigate = useNavigate();
	const lang = useStored(storage.getLang, null);
	const progress = useStored(storage.getProgress, {});
	const next = LEVELS.find((level) => !progress[level.id]) ?? LEVELS[0];
	const started = Object.keys(progress).length > 0;

	const start = (choice: Lang) => {
		storage.setLang(choice);
		void navigate({ to: "/level/$levelId", params: { levelId: next.id } });
	};

	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader />
			<main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-12 sm:px-8 sm:py-16">
				<section className="flex flex-col gap-5">
					<p className="type-label text-cyan-text">RIFT · ARC Championships</p>
					<h1 className="type-display-lg max-w-3xl text-ink sm:type-display-xl">
						Write your own controller
					</h1>
					<p className="type-body max-w-2xl text-ink-muted">
						A robot arm needs a few lines of code to hold its place: read the
						sensor, compare it with the target, set the motor. You'll write them
						yourself, one piece at a time, and watch the arm react. Eleven
						levels, from an on/off switch to a full PID controller.
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
						{LANGUAGES.map((option) => (
							<button
								key={option.lang}
								type="button"
								onClick={() => start(option.lang)}
								className={cn(
									"group flex cursor-pointer flex-col gap-3 rounded-md border bg-surface-raised p-6 text-left transition-colors hover:border-cyan",
									lang === option.lang ? "border-cyan" : "border-line",
								)}
							>
								<div className="flex items-center justify-between gap-3">
									<span className="type-display-sm text-ink">
										{option.name}
									</span>
									{option.tag && <Badge variant="cyan">{option.tag}</Badge>}
								</div>
								<p className="type-body-sm text-ink-muted">{option.blurb}</p>
								<span className="mt-auto flex items-center gap-2 type-label text-cyan-text">
									{started && lang === option.lang
										? `Continue at level ${next.number}`
										: "Start level 1"}
									<ArrowRight
										className="size-4 transition-transform group-hover:translate-x-1"
										aria-hidden
									/>
								</span>
							</button>
						))}
					</div>
					<p className="type-body-sm text-ink-muted">
						You can switch languages any time. The first load downloads the
						compiler or Python runtime, so{" "}
						<Link
							to="/setup"
							className="text-link underline-offset-4 hover:underline"
						>
							set up before the workshop
						</Link>{" "}
						if the wifi is busy.
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
								{level.stretch && (
									<span className="ml-auto type-label text-[11px] text-ink-muted">
										Stretch
									</span>
								)}
								{progress[level.id] && (
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
