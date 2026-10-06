import type { Lang } from "#/sim/types";

export const ROOT_URI = "file:///workspace";

/** Where each language's files live, for Monaco models and the language servers. */
export const FILE_URIS: Record<Lang, { main: string; helper: string }> = {
	python: {
		main: `${ROOT_URI}/controller.py`,
		helper: `${ROOT_URI}/robot.pyi`,
	},
	cpp: { main: `${ROOT_URI}/controller.cpp`, helper: `${ROOT_URI}/robot.h` },
};
