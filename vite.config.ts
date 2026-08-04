import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

const config = defineConfig({
	base: "./",
	resolve: { tsconfigPaths: true },
	plugins: [
		devtools(),
		tailwindcss(),
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		viteReact(),
		electron({
			main: {
				entry: {
					"index": "electron/main.ts",
					"decipher-worker": "electron/decipher-worker.ts",
				},
				onstart: async ({ startup }) => {
					await startup(["."]);
				},
				vite: {
					build: {
						outDir: "dist-electron/main",
						rolldownOptions: { output: { entryFileNames: "[name].js" } },
					},
				},
			},
			preload: {
				input: "electron/preload.ts",
				vite: {
					build: {
						outDir: "dist-electron/preload",
						rolldownOptions: { output: { entryFileNames: "preload.mjs" } },
					},
				},
			},
		}),
	],
});

export default config;
