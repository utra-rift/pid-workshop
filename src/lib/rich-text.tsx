import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/** Renders the little markup level text uses: `code`, **bold** and ``` blocks. */
export function RichText({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	const blocks = text.split(/```\n?([\s\S]*?)```/g);
	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{blocks.map((block, i) => {
				const key = `${i}-${block.slice(0, 12)}`;
				if (i % 2 === 1) {
					return (
						<pre
							key={key}
							className="overflow-x-auto rounded-sm border border-line bg-surface px-3 py-2 type-data text-ink"
						>
							{block.replace(/\n$/, "")}
						</pre>
					);
				}
				return block.trim() ? <p key={key}>{inline(block.trim())}</p> : null;
			})}
		</div>
	);
}

export function inline(text: string): ReactNode[] {
	const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
	return parts.map((part, i) => {
		const key = `${i}-${part}`;
		if (part.startsWith("`") && part.endsWith("`")) {
			return (
				<code
					key={key}
					className="rounded-xs bg-cyan-soft px-1 py-0.5 font-mono text-[0.9em] text-ink"
				>
					{part.slice(1, -1)}
				</code>
			);
		}
		if (part.startsWith("**") && part.endsWith("**")) {
			return (
				<strong key={key} className="font-semibold text-ink">
					{part.slice(2, -2)}
				</strong>
			);
		}
		return part;
	});
}
