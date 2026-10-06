import { Lightbulb } from "lucide-react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { type Level, localize } from "#/levels";
import { inline, RichText } from "#/lib/rich-text";
import type { Lang } from "#/sim/types";

interface LevelBriefProps {
	level: Level;
	lang: Lang;
	hintsShown: number;
	onShowHint: () => void;
	showAnswer: boolean;
	onUseAnswer: () => void;
}

export function LevelBrief({
	level,
	lang,
	hintsShown,
	onShowHint,
	showAnswer,
	onUseAnswer,
}: LevelBriefProps) {
	return (
		<section
			aria-labelledby="level-title"
			className="flex flex-col gap-4 rounded-md border border-line bg-surface-raised p-5"
		>
			<div className="flex items-center gap-3">
				<span className="type-label text-cyan-text">
					Level {String(level.number).padStart(2, "0")}
				</span>
				{level.stretch && <Badge variant="violet">Stretch</Badge>}
			</div>
			<h1 id="level-title" className="type-display-sm text-ink">
				{level.title}
			</h1>
			<p className="type-body text-ink-muted">{inline(level.story)}</p>
			<p className="type-body text-ink">
				<span className="type-label mr-2 text-ink-muted">Goal</span>
				{inline(level.goal)}
			</p>

			{hintsShown > 0 && (
				<ol className="flex flex-col gap-3">
					{level.hints.slice(0, hintsShown).map((hint, i) => (
						<li
							key={localize(hint, lang).slice(0, 24)}
							className="flex gap-3 rounded-sm border border-line bg-surface p-3 type-body-sm text-ink-muted"
						>
							<Lightbulb
								className="mt-0.5 size-4 shrink-0 text-cyan"
								aria-hidden
							/>
							<div className="min-w-0 flex-1">
								<span className="sr-only">Hint {i + 1}: </span>
								<RichText text={localize(hint, lang)} />
							</div>
						</li>
					))}
				</ol>
			)}

			<div className="flex flex-wrap gap-2">
				{hintsShown < level.hints.length && (
					<Button variant="outline" size="sm" onClick={onShowHint}>
						{hintsShown === 0 ? "Hint" : "Another hint"}
					</Button>
				)}
				{showAnswer && (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="ghost" size="sm">
								Answer
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent className="sm:max-w-2xl">
							<AlertDialogHeader>
								<AlertDialogTitle>One way to solve it</AlertDialogTitle>
								<AlertDialogDescription>
									Read it through before you copy it. Using it replaces the code
									in your editor.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<pre className="max-h-[50vh] overflow-auto rounded-sm border border-line bg-surface p-4 type-data text-ink">
								{level.solution[lang]}
							</pre>
							<AlertDialogFooter>
								<AlertDialogCancel>Close</AlertDialogCancel>
								<AlertDialogAction onClick={onUseAnswer}>
									Use this code
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				)}
			</div>
		</section>
	);
}
