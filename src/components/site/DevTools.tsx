import { Wrench } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import { Separator } from "#/components/ui/separator";
import { Switch } from "#/components/ui/switch";
import { LEVELS } from "#/levels";
import { storage, useStored } from "#/lib/storage";
import { TOOLS } from "#/tools";

const KONAMI = [
	"ArrowUp",
	"ArrowUp",
	"ArrowDown",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"ArrowLeft",
	"ArrowRight",
	"b",
	"a",
].join();

/** Keys typed into the editor or a field don't count toward the code. */
function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target.closest("input, textarea, select, .monaco-editor") !== null)
	);
}

/**
 * The Konami code shows or hides a small button in the bottom right. It opens
 * tools for testing the levels: unlock everything, pass or reset progress.
 */
export function DevTools() {
	const on = useStored(storage.isDev, false);

	useEffect(() => {
		const recent: string[] = [];
		const onKey = (event: KeyboardEvent) => {
			if (isTyping(event.target)) return;
			recent.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
			if (recent.length > 10) recent.shift();
			if (recent.join() === KONAMI) {
				recent.length = 0;
				storage.setDev(!storage.isDev());
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	if (!on) return null;
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Dev tools"
					className="fixed right-4 bottom-4 z-40 border border-line bg-surface-raised text-ink-muted shadow-lg animate-in fade-in-0 zoom-in-75 hover:bg-surface-raised hover:text-ink data-[state=open]:border-cyan data-[state=open]:text-cyan"
				>
					<Wrench />
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="end" className="flex flex-col gap-4">
				<DevPanel />
			</PopoverContent>
		</Popover>
	);
}

function DevPanel() {
	const unlockId = useId();
	const instructor = useStored(storage.isInstructor, false);
	const progress = useStored(storage.getProgress, {});
	const passed = LEVELS.filter((level) => progress[level.number]).length;

	// Resetting asks twice: the second click within 3 s does it.
	const [confirming, setConfirming] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const reset = () => {
		clearTimeout(timer.current);
		if (!confirming) {
			setConfirming(true);
			timer.current = setTimeout(() => setConfirming(false), 3000);
			return;
		}
		setConfirming(false);
		storage.resetProgress();
	};

	return (
		<>
			<div className="flex items-center justify-between gap-3">
				<span className="type-label text-cyan-text">Dev tools</span>
				<span className="type-data text-[11px] text-ink-muted">
					Konami code hides this
				</span>
			</div>

			<div className="flex items-start gap-3">
				<Switch
					id={unlockId}
					checked={instructor}
					onCheckedChange={(checked) => storage.setInstructor(checked)}
					className="mt-0.5"
				/>
				<label
					htmlFor={unlockId}
					className="flex cursor-pointer flex-col gap-0.5"
				>
					<span className="type-body-sm text-ink">Unlock every level</span>
					<span className="type-body-sm text-[12px] text-ink-muted">
						Also shows the Answer button. Same as{" "}
						<code className="type-data text-[11px]">?instructor=1</code>.
					</span>
				</label>
			</div>

			<Separator />

			<div className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between gap-3">
					<span className="type-label text-[11px] text-ink-muted">
						Progress
					</span>
					<span className="type-data text-[11px] text-ink-muted tabular-nums">
						{passed}/{LEVELS.length} passed
					</span>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<Button
						variant="outline"
						size="sm"
						className="px-2"
						disabled={passed === LEVELS.length}
						onClick={() => storage.passAll(LEVELS.map((level) => level.number))}
					>
						Pass all
					</Button>
					<Button
						variant="outline"
						size="sm"
						className={
							confirming
								? "border-[#FF6B81] px-2 text-[#FF6B81] hover:bg-[#FF6B81]/10"
								: "px-2"
						}
						onClick={reset}
					>
						{confirming ? "Sure?" : "Reset"}
					</Button>
				</div>
				<span className="type-body-sm text-[12px] text-ink-muted">
					Reset clears passed levels, saved code and hints.
				</span>
			</div>

			<Separator />

			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-data text-[11px]">
				<dt className="text-ink-muted">Isolated</dt>
				<dd
					className={
						globalThis.crossOriginIsolated ? "text-cyan-text" : "text-[#FF6B81]"
					}
				>
					{globalThis.crossOriginIsolated ? "yes" : "no, so clangd can't start"}
				</dd>
				<dt className="text-ink-muted">Python</dt>
				<dd className="text-ink">
					Pyodide {TOOLS.pyodide.version}, basedpyright{" "}
					{TOOLS.basedpyright.version}
				</dd>
				<dt className="text-ink-muted">C++</dt>
				<dd className="text-ink">
					clang {TOOLS.clang.version.split("-")[0]}, clangd{" "}
					{TOOLS.clangd.version}
				</dd>
			</dl>

			<Button
				variant="ghost"
				size="sm"
				className="self-start px-2 text-ink-muted"
				onClick={() => storage.setDev(false)}
			>
				Hide dev tools
			</Button>
		</>
	);
}
