/**
 * TanStack Query keys, in one place. Biome has no TanStack Query lint, so a
 * typo'd key would silently never invalidate; build every key here.
 */
export const homeKeys = {
	all: ["home"] as const,
};

export const ideaKeys = {
	all: ["ideas"] as const,
	byStatus: (status: string) => ["ideas", status] as const,
};

export const historyKeys = {
	all: ["history"] as const,
};

export const linkKeys = {
	all: ["links"] as const,
};
