import { CATEGORY_LABELS, isCategory } from "#/domain/types";
import type { IdeaView } from "#/server/week.server";
import { CATEGORY_TINT, pounds } from "./shell";

/** One Idea, as the Shortlist and the Ideas page show it. */
export function IdeaCard({
	idea,
	index,
	children,
}: {
	idea: IdeaView;
	index?: number;
	children?: React.ReactNode;
}) {
	const label = isCategory(idea.category)
		? CATEGORY_LABELS[idea.category]
		: idea.category;
	return (
		<article
			className="flex flex-col gap-2 rounded-lg border bg-white/70 p-4 dark:bg-white/5 shadow-[0_1px_0_rgba(0,0,0,0.03)]"
			data-testid="idea"
		>
			<div className="flex flex-wrap items-center gap-2 text-xs">
				{index !== undefined ? (
					<span className="flex size-6 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
						{index}
					</span>
				) : null}
				<span
					className={`rounded-full px-2 py-0.5 font-medium ${CATEGORY_TINT[idea.category] ?? "bg-muted"}`}
				>
					{label}
				</span>
				{idea.splurge ? (
					<span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
						Splurge
					</span>
				) : null}
				{idea.saved ? (
					<span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
						Saved by you
					</span>
				) : null}
				<span className="ml-auto text-muted-foreground">
					{pounds(idea.priceGbp)}
				</span>
			</div>
			<h3 className="font-serif text-lg leading-snug font-semibold">
				{idea.title}
			</h3>
			<p className="text-sm text-muted-foreground">
				{idea.venue}
				{idea.area ? ` · ${idea.area}` : ""}
				{idea.activityKind ? ` · ${idea.activityKind}` : ""}
				{idea.endsOn ? ` · until ${idea.endsOn}` : ""}
			</p>
			{idea.why ? (
				<p className="text-sm">{idea.why}</p>
			) : idea.description ? (
				<p className="text-sm">{idea.description}</p>
			) : null}
			<div className="flex flex-wrap items-center gap-3 text-sm">
				{idea.bookingUrl || idea.url ? (
					<a
						className="text-primary underline underline-offset-4"
						href={idea.bookingUrl || idea.url}
						target="_blank"
						rel="noreferrer"
					>
						Open
					</a>
				) : null}
				{children}
			</div>
		</article>
	);
}
