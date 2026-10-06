import { useEffect, useRef } from "react";
import { cn } from "#/lib/utils";

export interface ConsoleLine {
	text: string;
	kind: "log" | "error" | "warning" | "info";
}

export function ConsolePane({
	lines,
	className,
}: {
	lines: ConsoleLine[];
	className?: string;
}) {
	const end = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the bottom whenever new lines arrive
	useEffect(() => {
		end.current?.scrollIntoView({ block: "nearest" });
	}, [lines]);
	return (
		<div
			className={cn(
				"overflow-auto bg-surface px-4 py-2 font-mono text-[12px] leading-5",
				className,
			)}
			role="log"
			aria-label="Console"
		>
			{lines.length === 0 ? (
				<p className="text-ink-muted">
					Output from print and printf shows up here.
				</p>
			) : (
				lines.map((line, i) => (
					<pre
						// biome-ignore lint/suspicious/noArrayIndexKey: console lines repeat and never reorder
						key={i}
						className={cn(
							"break-words whitespace-pre-wrap",
							line.kind === "error" && "text-[#FF6B81]",
							line.kind === "warning" && "text-[#FFC861]",
							line.kind === "info" && "text-ink-muted",
							line.kind === "log" && "text-ink",
						)}
					>
						{line.text}
					</pre>
				))
			)}
			<div ref={end} />
		</div>
	);
}
