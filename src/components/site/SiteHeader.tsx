import { Link } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge";
import { storage, useStored } from "#/lib/storage";
import { cn } from "#/lib/utils";

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
				"flex items-center justify-between gap-6 border-b border-line px-4 py-3 sm:px-6",
				className,
			)}
		>
			<Link
				to="/"
				className="flex items-center gap-3"
				aria-label="PID Workshop home"
			>
				<img
					src="/logos/rift-mark-white-cropped.svg"
					alt=""
					width={500}
					height={850}
					className="h-8 w-auto"
				/>
				<span className="type-label text-ink">PID Workshop</span>
			</Link>
			<div className="flex items-center gap-4">
				{children}
				{instructor && <Badge variant="violet">Instructor</Badge>}
				<nav aria-label="Primary" className="flex items-center gap-5">
					<Link
						to="/level/$levelId"
						params={{ levelId: "01-on-off" }}
						className="type-label text-ink-muted transition-colors hover:text-ink [&.active]:text-ink"
					>
						Levels
					</Link>
					<Link
						to="/setup"
						className="type-label text-ink-muted transition-colors hover:text-ink [&.active]:text-ink"
					>
						Setup
					</Link>
				</nav>
			</div>
		</header>
	);
}
