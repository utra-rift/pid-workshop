import { Link } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge";
import { storage, useStored } from "#/lib/storage";
import { cn } from "#/lib/utils";

/** The top bar. On a level, the level chips sit in it (children). */
export function SiteHeader({
	className,
	children,
}: {
	className?: string;
	children?: React.ReactNode;
}) {
	const instructor = useStored(storage.isInstructor, false);
	return (
		<header
			className={cn(
				"flex h-14 items-center gap-4 border-b border-line px-4 sm:px-6",
				className,
			)}
		>
			<Link
				to="/"
				className="flex shrink-0 items-center gap-3"
				aria-label="Learn PID home"
			>
				<img
					src="/logos/rift-mark-white-cropped.svg"
					alt=""
					width={500}
					height={850}
					className="h-8 w-auto"
				/>
				<span
					className={cn("type-label text-ink", children && "max-lg:sr-only")}
				>
					Learn PID
				</span>
			</Link>
			{children && (
				<div className="flex h-full min-w-0 flex-1 items-center border-l border-line pl-2">
					{children}
				</div>
			)}
			{instructor && (
				<Badge variant="violet" className="ml-auto shrink-0">
					Instructor
				</Badge>
			)}
		</header>
	);
}
