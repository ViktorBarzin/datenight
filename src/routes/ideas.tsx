import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CLIENT_ID_HEADER, clientId } from "@viktorbarzin/realtime/client";
import { useRealtimeInvalidation } from "@viktorbarzin/realtime/react";
import { type FormEvent, useEffect, useState } from "react";

import { app } from "#/app.config";
import { IdeaCard } from "#/components/idea-card";
import { Section, Shell } from "#/components/shell";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "#/domain/types";
import { memberOnly } from "#/lib/member-loader";
import { ideaKeys, linkKeys } from "#/lib/query-keys";
import {
	getIdeas,
	getLinks,
	saveIdea,
	setIdea,
	submitLink,
	tryLinkAgain,
} from "#/server/app.functions";

export const Route = createFileRoute("/ideas")({
	loader: () => memberOnly("/ideas"),
	component: IdeasPage,
});

const TABS = [
	{ status: "open", label: "Open" },
	{ status: "liked", label: "Liked" },
	{ status: "booked", label: "Booked" },
	{ status: "dismissed", label: "Not for us" },
	{ status: "repeat", label: "Done before" },
] as const;

function IdeasPage() {
	const status = Route.useLoaderData();
	const [tab, setTab] = useState<(typeof TABS)[number]["status"]>("open");
	const queryClient = useQueryClient();
	// Writes from another tab arrive over SSE; with realtime off, the list polls.
	useRealtimeInvalidation({ queryClient, enabled: status.realtime });
	const list = useQuery({
		queryKey: ideaKeys.byStatus(tab),
		queryFn: () => getIdeas({ data: { status: tab } }),
		refetchInterval: status.realtime ? false : app.pollMs,
	});
	const change = useMutation({
		mutationFn: (v: { id: string; status: "open" | "dismissed" }) =>
			setIdea({ data: v, headers: { [CLIENT_ID_HEADER]: clientId() } }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ideaKeys.all }),
	});

	return (
		<Shell
			signOutUrl={status.signOutUrl}
			username={status.username}
			admin={status.admin}
		>
			<main className="flex flex-col gap-8">
				<PasteLink />
				<AddIdea />
				<Section title="Ideas">
					<div className="flex flex-wrap gap-2" role="tablist">
						{TABS.map((t) => (
							<Button
								key={t.status}
								size="sm"
								role="tab"
								aria-selected={tab === t.status}
								variant={tab === t.status ? "default" : "secondary"}
								onClick={() => setTab(t.status)}
							>
								{t.label}
							</Button>
						))}
					</div>
					{list.isPending ? (
						<p className="text-muted-foreground">Loading...</p>
					) : list.isError ? (
						<p role="alert">Could not load ideas.</p>
					) : (
						<div className="flex flex-col gap-3" data-testid="ideas">
							{list.data.length === 0 ? (
								<p className="text-muted-foreground" data-testid="no-ideas">
									None here.
								</p>
							) : null}
							{list.data.map((idea) => (
								<IdeaCard key={idea.id} idea={idea}>
									{tab === "open" ? (
										<button
											type="button"
											className="text-muted-foreground underline underline-offset-4"
											onClick={() =>
												change.mutate({ id: idea.id, status: "dismissed" })
											}
										>
											Not for us
										</button>
									) : tab === "dismissed" ? (
										<button
											type="button"
											className="text-muted-foreground underline underline-offset-4"
											onClick={() =>
												change.mutate({ id: idea.id, status: "open" })
											}
										>
											Bring back
										</button>
									) : null}
								</IdeaCard>
							))}
						</div>
					)}
				</Section>
			</main>
		</Shell>
	);
}

function AddIdea() {
	const queryClient = useQueryClient();
	const empty = {
		title: "",
		venue: "",
		category: "food" as Category,
		activityKind: "",
		price: "",
		area: "",
		postcode: "",
		url: "",
	};
	const [form, setForm] = useState(empty);
	const [open, setOpen] = useState(false);
	const save = useMutation({
		mutationFn: () =>
			saveIdea({
				data: {
					title: form.title,
					venue: form.venue,
					category: form.category,
					activityKind: form.activityKind,
					priceGbp:
						form.price.trim() === "" ? null : Number.parseInt(form.price, 10),
					area: form.area,
					postcode: form.postcode,
					url: form.url,
				},
				headers: { [CLIENT_ID_HEADER]: clientId() },
			}),
		onSuccess: () => {
			setForm(empty);
			setOpen(false);
			void queryClient.invalidateQueries({ queryKey: ideaKeys.all });
		},
	});
	const field = (
		key: keyof typeof form,
		label: string,
		extra: Record<string, string> = {},
	) => (
		<Input
			aria-label={label}
			placeholder={label}
			value={form[key]}
			onChange={(e) => setForm({ ...form, [key]: e.target.value })}
			{...extra}
		/>
	);
	function submit(e: FormEvent) {
		e.preventDefault();
		if (form.title.trim() && form.venue.trim() && form.activityKind.trim())
			save.mutate();
	}
	if (!open)
		return (
			<Button
				variant="secondary"
				className="self-start"
				onClick={() => setOpen(true)}
			>
				Add by hand
			</Button>
		);
	return (
		<form
			className="flex flex-col gap-2 rounded-lg border p-4"
			onSubmit={submit}
		>
			<p className="text-sm text-muted-foreground">
				Or forward the link to Muse on WhatsApp.
			</p>
			{field("title", "What it is")}
			{field("venue", "Venue")}
			<select
				aria-label="Category"
				className="h-9 rounded-md border bg-transparent px-3 text-sm"
				value={form.category}
				onChange={(e) =>
					setForm({ ...form, category: e.target.value as Category })
				}
			>
				{CATEGORIES.map((c) => (
					<option key={c} value={c}>
						{CATEGORY_LABELS[c]}
					</option>
				))}
			</select>
			{field("activityKind", "Kind of activity, such as pottery class")}
			<div className="grid grid-cols-3 gap-2">
				{field("price", "£ for two", { inputMode: "numeric" })}
				{field("area", "Area")}
				{field("postcode", "Postcode")}
			</div>
			{field("url", "Link")}
			<div className="flex gap-2">
				<Button type="submit" disabled={save.isPending}>
					Save
				</Button>
				<Button type="button" variant="ghost" onClick={() => setOpen(false)}>
					Cancel
				</Button>
			</div>
			{save.data ? (
				<p className="text-sm">
					{save.data.repeats > 0
						? "You did that before; it stays out of the shortlist."
						: "Saved."}
				</p>
			) : null}
			{save.isError ? (
				<p className="text-sm text-destructive">Could not save it.</p>
			) : null}
		</form>
	);
}

const LINK_STATUS: Record<string, string> = {
	pending: "Waiting",
	reading: "Reading",
	done: "Added",
	not_found: "No date in it",
	failed: "Could not read it",
};

/** Paste a link from Instagram, TikTok or anywhere; it turns into an Idea. */
function PasteLink() {
	const queryClient = useQueryClient();
	const [url, setUrl] = useState("");
	const [note, setNote] = useState("");
	const links = useQuery({
		queryKey: linkKeys.all,
		queryFn: () => getLinks(),
		// While a link is being read, look again every 5 s.
		refetchInterval: (q) =>
			q.state.data?.some(
				(l) => l.status === "pending" || l.status === "reading",
			)
				? 5_000
				: false,
	});
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: linkKeys.all });
		void queryClient.invalidateQueries({ queryKey: ideaKeys.all });
	};
	const send = useMutation({
		mutationFn: () => submitLink({ data: { url, note } }),
		onSuccess: () => {
			setUrl("");
			setNote("");
			refresh();
		},
	});
	const again = useMutation({
		mutationFn: (id: string) => tryLinkAgain({ data: { id } }),
		onSuccess: refresh,
	});
	// A finished link means a new idea; refresh the list once it lands.
	const finished = links.data?.filter((l) => l.status === "done").length ?? 0;
	useEffect(() => {
		if (finished > 0)
			void queryClient.invalidateQueries({ queryKey: ideaKeys.all });
	}, [finished, queryClient]);
	function submit(e: FormEvent) {
		e.preventDefault();
		if (url.trim()) send.mutate();
	}
	return (
		<Section title="Saw something cool?">
			<form className="flex flex-col gap-2" onSubmit={submit}>
				<div className="flex gap-2">
					<Input
						aria-label="Link"
						placeholder="Paste an Instagram, TikTok or any link"
						value={url}
						maxLength={4000}
						onChange={(e) => setUrl(e.target.value)}
					/>
					<Button type="submit" disabled={send.isPending}>
						Add
					</Button>
				</div>
				<Input
					aria-label="Note"
					placeholder="A note, if you like"
					value={note}
					maxLength={1000}
					onChange={(e) => setNote(e.target.value)}
				/>
				<p className="text-sm text-muted-foreground">
					Or forward the link to Koda on WhatsApp. Reading a link takes a minute
					or two.
				</p>
				{send.isError ? (
					<p className="text-sm text-destructive">{send.error.message}</p>
				) : null}
			</form>
			{links.data && links.data.length > 0 ? (
				<ul
					className="flex flex-col divide-y rounded-lg border text-sm"
					data-testid="links"
				>
					{links.data.map((l) => (
						<li
							key={l.id}
							className="flex flex-wrap items-baseline gap-x-2 gap-y-1 p-3"
						>
							<span
								className={`rounded-full px-2 py-0.5 text-xs ${
									l.status === "done"
										? "bg-primary/10 text-primary"
										: l.status === "failed" || l.status === "not_found"
											? "bg-destructive/10 text-destructive"
											: "bg-muted"
								}`}
							>
								{LINK_STATUS[l.status] ?? l.status}
							</span>
							<span className="font-medium">
								{l.ideaTitle ?? new URL(l.url).hostname}
							</span>
							<span className="text-muted-foreground">
								via {l.via === "muse" ? "WhatsApp" : "the app"}
							</span>
							{l.reason ? (
								<span className="basis-full text-muted-foreground">
									{l.reason}
								</span>
							) : null}
							{l.status === "failed" || l.status === "not_found" ? (
								<button
									type="button"
									className="text-primary underline underline-offset-4"
									onClick={() => again.mutate(l.id)}
								>
									Try again
								</button>
							) : null}
						</li>
					))}
				</ul>
			) : null}
		</Section>
	);
}
