import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CLIENT_ID_HEADER, clientId } from "@viktorbarzin/realtime/client";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { CATEGORY_TINT, pounds, Shell } from "#/components/shell";
import { Button } from "#/components/ui/button";
import { CATEGORY_LABELS, isCategory } from "#/domain/types";
import { memberOnly } from "#/lib/member-loader";
import { deckKeys, ideaKeys } from "#/lib/query-keys";
import { getDeck, swipeIdea, undoSwipeIdea } from "#/server/app.functions";
import type { IdeaView } from "#/server/week.server";

export const Route = createFileRoute("/swipe")({
	loader: () => memberOnly("/swipe"),
	component: SwipePage,
});

/** How far a card must travel, in pixels, to count as a swipe. */
const THRESHOLD = 110;

type Direction = "like" | "pass";

function SwipePage() {
	const status = Route.useLoaderData();
	const queryClient = useQueryClient();
	const deck = useQuery({ queryKey: deckKeys.all, queryFn: () => getDeck() });
	// Swiped this visit, so a refetch never shows them again before the server catches up.
	const [gone, setGone] = useState<string[]>([]);
	const [last, setLast] = useState<IdeaView | null>(null);
	const [leaving, setLeaving] = useState<{
		id: string;
		direction: Direction;
	} | null>(null);

	const queue = (deck.data?.ideas ?? []).filter((i) => !gone.includes(i.id));
	const top = queue[0];
	const next = queue[1];

	const send = useMutation({
		mutationFn: (v: { id: string; direction: Direction }) =>
			swipeIdea({ data: v, headers: { [CLIENT_ID_HEADER]: clientId() } }),
		onSuccess: () =>
			void queryClient.invalidateQueries({ queryKey: ideaKeys.all }),
	});
	const undo = useMutation({
		mutationFn: (id: string) =>
			undoSwipeIdea({
				data: { id },
				headers: { [CLIENT_ID_HEADER]: clientId() },
			}),
		onSuccess: (_d, id) => {
			setGone((g) => g.filter((x) => x !== id));
			setLast(null);
			void queryClient.invalidateQueries({ queryKey: deckKeys.all });
			void queryClient.invalidateQueries({ queryKey: ideaKeys.all });
		},
	});

	const decide = useCallback(
		(idea: IdeaView, direction: Direction) => {
			if (leaving) return;
			setLeaving({ id: idea.id, direction });
			// Let the card fly out, then drop it from the queue.
			window.setTimeout(() => {
				setGone((g) => [...g, idea.id]);
				setLast(idea);
				setLeaving(null);
			}, 220);
			send.mutate({ id: idea.id, direction });
		},
		[leaving, send],
	);

	// Fetch more before the last card goes.
	useEffect(() => {
		if (
			deck.data &&
			queue.length < 4 &&
			!deck.isFetching &&
			deck.data.ideas.length > gone.length
		) {
			void queryClient.invalidateQueries({ queryKey: deckKeys.all });
		}
	}, [deck.data, deck.isFetching, gone.length, queue.length, queryClient]);

	// While the deck is empty and a refill runs, look again every 20 s.
	useEffect(() => {
		if (!top && deck.data && (deck.data.refilling || send.data?.refilling)) {
			const t = window.setInterval(
				() => void queryClient.invalidateQueries({ queryKey: deckKeys.all }),
				20_000,
			);
			return () => window.clearInterval(t);
		}
	}, [top, deck.data, send.data, queryClient]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			)
				return;
			if (e.key === "ArrowRight" && top) decide(top, "like");
			else if (e.key === "ArrowLeft" && top) decide(top, "pass");
			else if ((e.key === "z" || e.key === "Backspace") && last)
				undo.mutate(last.id);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [top, last, decide, undo]);

	const left = Math.max(0, (deck.data?.left ?? 0) - gone.length);

	return (
		<Shell
			signOutUrl={status.signOutUrl}
			username={status.username}
			admin={status.admin}
		>
			<main
				className="mx-auto flex w-full max-w-md flex-col gap-4"
				data-testid="swipe"
			>
				<p className="text-sm text-muted-foreground">
					Swipe right if you would go, left if not. Likes come first on Monday.
				</p>
				<div className="relative h-[34rem]">
					{deck.isPending ? (
						<p className="text-muted-foreground">Loading...</p>
					) : !top ? (
						<div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center">
							<p className="font-serif text-xl">You have seen everything.</p>
							<p className="text-sm text-muted-foreground">
								{deck.data?.refilling || send.data?.refilling
									? "The scout is looking for more. New ideas show here in a few minutes."
									: "More arrive with Sunday's scout run, or paste a link on the Ideas page."}
							</p>
						</div>
					) : (
						<>
							{next ? <Card key={next.id} idea={next} behind /> : null}
							<Card
								key={top.id}
								idea={top}
								leaving={leaving?.id === top.id ? leaving.direction : null}
								onDecide={(d) => decide(top, d)}
							/>
						</>
					)}
				</div>
				<div className="flex items-center justify-center gap-4">
					<Button
						variant="secondary"
						size="lg"
						aria-label="Pass"
						disabled={!top || !!leaving}
						onClick={() => top && decide(top, "pass")}
						className="h-14 w-14 rounded-full p-0"
					>
						<CrossIcon />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={!last || undo.isPending}
						onClick={() => last && undo.mutate(last.id)}
					>
						Undo
					</Button>
					<Button
						size="lg"
						aria-label="Like"
						disabled={!top || !!leaving}
						onClick={() => top && decide(top, "like")}
						className="h-14 w-14 rounded-full p-0"
					>
						<HeartIcon />
					</Button>
				</div>
				<p
					className="text-center text-xs text-muted-foreground"
					data-testid="left"
				>
					{left} left to swipe · arrow keys work too
				</p>
			</main>
		</Shell>
	);
}

function Card({
	idea,
	behind = false,
	leaving = null,
	onDecide,
}: {
	idea: IdeaView;
	behind?: boolean;
	leaving?: Direction | null;
	onDecide?: (d: Direction) => void;
}) {
	const [dx, setDx] = useState(0);
	const [dragging, setDragging] = useState(false);
	const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
	const [photo, setPhoto] = useState(0);
	const [broken, setBroken] = useState<Set<string>>(new Set());
	const photos = idea.photos.filter((p) => !broken.has(p));
	const shown = photos[Math.min(photo, Math.max(0, photos.length - 1))];
	const label = isCategory(idea.category)
		? CATEGORY_LABELS[idea.category]
		: idea.category;

	function down(e: ReactPointerEvent) {
		if (behind) return;
		start.current = { x: e.clientX, y: e.clientY, moved: false };
		setDragging(true);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: ReactPointerEvent) {
		if (!start.current) return;
		const x = e.clientX - start.current.x;
		if (Math.abs(x) > 6) start.current.moved = true;
		setDx(x);
	}
	function up(e: ReactPointerEvent) {
		const s = start.current;
		start.current = null;
		setDragging(false);
		if (!s) return;
		if (dx > THRESHOLD) onDecide?.("like");
		else if (dx < -THRESHOLD) onDecide?.("pass");
		else if (!s.moved && photos.length > 1) {
			// A tap: right half shows the next photo, left half the one before.
			const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const right = e.clientX > box.left + box.width / 2;
			setPhoto((p) =>
				right ? Math.min(photos.length - 1, p + 1) : Math.max(0, p - 1),
			);
		}
		setDx(0);
	}

	const x = leaving === "like" ? 600 : leaving === "pass" ? -600 : dx;
	const style = behind
		? { transform: "scale(0.95) translateY(10px)", opacity: 0.6 }
		: {
				transform: `translateX(${x}px) rotate(${x / 18}deg)`,
				transition: dragging ? "none" : "transform 220ms ease-out",
			};
	const likeShow = Math.max(0, Math.min(1, x / THRESHOLD));
	const passShow = Math.max(0, Math.min(1, -x / THRESHOLD));

	return (
		<article
			className="absolute inset-0 flex touch-pan-y select-none flex-col overflow-hidden rounded-2xl border bg-background shadow-lg"
			style={style}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={() => {
				start.current = null;
				setDragging(false);
				setDx(0);
			}}
			data-testid={behind ? "card-behind" : "card"}
			aria-label={idea.title}
		>
			<div className="relative h-[62%] shrink-0 bg-muted">
				{shown ? (
					<img
						src={shown}
						alt={idea.title}
						draggable={false}
						referrerPolicy="no-referrer"
						onError={() => setBroken((b) => new Set(b).add(shown))}
						className="h-full w-full object-cover"
					/>
				) : (
					<div className="flex h-full items-center justify-center p-6 text-center font-serif text-2xl text-muted-foreground">
						{idea.venue}
					</div>
				)}
				{photos.length > 1 ? (
					<div className="absolute inset-x-3 top-2 flex gap-1">
						{photos.map((p, i) => (
							<span
								key={p}
								className={`h-1 flex-1 rounded-full ${i === photo ? "bg-white" : "bg-white/40"}`}
							/>
						))}
					</div>
				) : null}
				<span
					className="absolute top-6 left-4 rotate-[-12deg] rounded-md border-4 border-emerald-500 px-2 py-1 text-2xl font-bold text-emerald-500"
					style={{ opacity: likeShow }}
				>
					LIKE
				</span>
				<span
					className="absolute top-6 right-4 rotate-[12deg] rounded-md border-4 border-rose-500 px-2 py-1 text-2xl font-bold text-rose-500"
					style={{ opacity: passShow }}
				>
					PASS
				</span>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-1.5 p-4">
				<div className="flex flex-wrap items-center gap-2 text-xs">
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
					<span className="ml-auto text-muted-foreground">
						{pounds(idea.priceGbp)}
					</span>
				</div>
				<h2 className="font-serif text-xl leading-snug font-semibold">
					{idea.title}
				</h2>
				<p className="text-sm text-muted-foreground">
					{idea.venue}
					{idea.area ? ` · ${idea.area}` : ""}
					{idea.endsOn ? ` · until ${idea.endsOn}` : ""}
				</p>
				<p className="line-clamp-3 text-sm">{idea.why || idea.description}</p>
				{idea.bookingUrl || idea.url ? (
					<a
						className="mt-auto self-start text-sm text-primary underline underline-offset-4"
						href={idea.bookingUrl || idea.url}
						target="_blank"
						rel="noreferrer"
						onPointerDown={(e) => e.stopPropagation()}
					>
						Open
					</a>
				) : null}
			</div>
		</article>
	);
}

function CrossIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			className="size-6"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			aria-hidden="true"
		>
			<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
		</svg>
	);
}

function HeartIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			className="size-6"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M12 21s-7.5-4.6-9.5-9.2C1.1 8.4 3.3 5 6.8 5c2 0 3.4 1.1 5.2 3 1.8-1.9 3.2-3 5.2-3 3.5 0 5.7 3.4 4.3 6.8C19.5 16.4 12 21 12 21z" />
		</svg>
	);
}
