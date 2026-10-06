import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { DevTools } from "#/components/site/DevTools";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ name: "theme-color", content: "#07101F" },
			{ title: "Learn PID · RIFT" },
			{
				name: "description",
				content:
					"Write a PID controller in Python or C++ for a robot arm and a launcher flywheel, and run it in your browser.",
			},
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		// Arena (dark) theme: the workshop runs on projectors.
		<html lang="en" data-theme="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<DevTools />
				<Scripts />
			</body>
		</html>
	);
}
