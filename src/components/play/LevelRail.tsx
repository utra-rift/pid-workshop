import { Link } from "@tanstack/react-router";
import { Check, Lock } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Level } from "#/levels";
import { cn } from "#/lib/utils";

interface LevelRailProps {
	levels: Level[];
	currentId: string;
	passed: Record<string, unknown>;
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
			className="overflow-x-auto border-b border-line [scrollbar-width:thin]"
		>
			<ol className="flex min-w-max items-stretch gap-1 px-4 py-2 sm:px-6">
				{levels.map((level, i) => {
					const unlocked = isUnlocked(level);
					const done = Boolean(passed[level.id]);
					const active = level.id === currentId;
					const firstStretch = level.stretch && !levels[i - 1]?.stretch;
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
							{firstStretch && (
								<span className="mr-2 ml-3 border-l border-line pl-3 type-label text-[11px] text-ink-muted">
									Stretch
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
										"flex items-center gap-2 rounded-sm px-3 py-1.5 transition-colors",
										active ? "bg-ink text-surface" : "text-ink hover:bg-ink/10",
									)}
								>
									{body}
								</Link>
							) : (
								<span
									title="Pass the level before this one to unlock it."
									className="flex cursor-not-allowed items-center gap-2 rounded-sm px-3 py-1.5 text-ink-muted/60"
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
