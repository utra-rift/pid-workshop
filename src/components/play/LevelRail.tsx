import { Link } from "@tanstack/react-router";
import { Check, Lock } from "lucide-react";
import { useEffect, useRef } from "react";
import { type Level, sectionOf } from "#/levels";
import { cn } from "#/lib/utils";

interface LevelRailProps {
	levels: Level[];
	currentId: string;
	/** Passed levels, by number. */
	passed: Record<number, unknown>;
	isUnlocked: (level: Level) => boolean;
}

export function LevelRail({
	levels,
	currentId,
	passed,
	isUnlocked,
}: LevelRailProps) {
	const current = useRef<HTMLAnchorElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll the new level into view when it changes
	useEffect(() => {
		current.current?.scrollIntoView({ block: "nearest", inline: "center" });
	}, [currentId]);

	return (
		<nav
			aria-label="Levels"
			className="min-w-0 flex-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			<ol className="flex min-w-max items-center gap-1 py-2">
				{levels.map((level, i) => {
					const unlocked = isUnlocked(level);
					const done = Boolean(passed[level.number]);
					const active = level.id === currentId;
					// A label where a new section starts: the flywheel, then the stretch levels.
					const section =
						i > 0 && sectionOf(level) !== sectionOf(levels[i - 1])
							? sectionOf(level)
							: null;
					const body = (
						<>
							<span
								className={cn(
									"type-data",
									active ? "text-surface" : "text-ink-muted",
								)}
							>
								{String(level.number).padStart(2, "0")}
							</span>
							<span className="type-body-sm whitespace-nowrap">
								{level.title}
							</span>
							{done && (
								<Check
									className={cn(
										"size-3.5",
										active ? "text-surface" : "text-cyan",
									)}
									aria-label="passed"
								/>
							)}
							{!unlocked && <Lock className="size-3.5" aria-label="locked" />}
						</>
					);
					return (
						<li key={level.id} className="flex items-center">
							{section && (
								<span className="mr-1 ml-2 border-l border-line pl-3 type-label text-[11px] text-ink-muted">
									{section}
								</span>
							)}
							{unlocked ? (
								<Link
									ref={active ? current : undefined}
									to="/level/$levelId"
									params={{ levelId: level.id }}
									search={(prev) => prev}
									aria-current={active ? "page" : undefined}
									className={cn(
										"flex items-center gap-2 rounded-sm px-2.5 py-1.5 transition-colors",
										active ? "bg-ink text-surface" : "text-ink hover:bg-ink/10",
									)}
								>
									{body}
								</Link>
							) : (
								<span
									title="Pass the level before this one to unlock it."
									className="flex cursor-not-allowed items-center gap-2 rounded-sm px-2.5 py-1.5 text-ink-muted/60"
								>
									{body}
								</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
