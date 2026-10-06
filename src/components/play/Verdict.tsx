import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleDashed, CircleX, LoaderCircle } from "lucide-react";
import type { Grade } from "#/coach/grade";
import type { Level } from "#/levels";
import { inline } from "#/lib/rich-text";
import { cn } from "#/lib/utils";

interface VerdictProps {
	grade: Grade | null;
	running: boolean;
	loadingLabel?: string;
	next?: Level;
}

export function Verdict({ grade, running, loadingLabel, next }: VerdictProps) {
	const state = running
		? "running"
		: !grade
			? "idle"
			: grade.passed
				? "pass"
				: "fail";
	return (
		<section
			aria-live="polite"
			className={cn(
				"flex gap-3 rounded-md border bg-surface-raised p-4",
				state === "pass"
					? "border-cyan shadow-glow"
					: state === "fail"
						? "border-[#FF6B81]/60"
						: "border-line",
			)}
		>
			{state === "running" && (
				<LoaderCircle
					className="mt-0.5 size-5 shrink-0 animate-spin text-ink-muted"
					aria-hidden
				/>
			)}
			{state === "idle" && (
				<CircleDashed
					className="mt-0.5 size-5 shrink-0 text-ink-muted"
					aria-hidden
				/>
			)}
			{state === "pass" && (
				<CircleCheck className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden />
			)}
			{state === "fail" && (
				<CircleX
					className="mt-0.5 size-5 shrink-0 text-[#FF6B81]"
					aria-hidden
				/>
			)}
			<div className="flex min-w-0 flex-col gap-1">
				<p
					className={cn(
						"type-label",
						state === "pass"
							? "text-cyan-text"
							: state === "fail"
								? "text-[#FF6B81]"
								: "text-ink-muted",
					)}
				>
					{state === "running"
						? (loadingLabel ?? "Running")
						: state === "idle"
							? "Ready"
							: grade?.title}
				</p>
				<p className="type-body-sm text-ink">
					{state === "running"
						? "Hang on."
						: state === "idle"
							? "Press Run (or Ctrl+Enter) to test your controller."
							: inline(grade?.message ?? "")}
				</p>
				{state === "pass" && next && (
					<Link
						to="/level/$levelId"
						params={{ levelId: next.id }}
						search={(prev) => prev}
						className="mt-1 type-label text-cyan-text underline-offset-4 hover:underline"
					>
						Next: {next.title} →
					</Link>
				)}
			</div>
		</section>
	);
}
