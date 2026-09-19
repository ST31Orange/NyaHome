import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	loader: { ".jpg": "dataurl" },
	external: [
		"obsidian", "electron", "@codemirror/*", "@lezer/*", "node:*",
		// Node builtins referenced by the IMAP stack; Obsidian's desktop
		// renderer resolves them through require at runtime
		"net", "tls", "dns", "stream", "util", "events", "crypto", "zlib",
		"os", "path", "fs", "child_process", "http", "https", "querystring",
		"url", "string_decoder", "buffer", "process", "punycode",
	],
	format: "cjs",
	target: "es2020",
	// Lookbehind is a *parse*-time error on Safari below 16.4, so a single
	// literal anywhere in the bundle stops the whole plugin from loading on
	// older iOS. Our own source has none, but dependencies do. Declaring the
	// feature unavailable makes esbuild emit new RegExp("...") instead, which
	// parses on any engine and can only fail if that code path actually runs.
	// Obsidian evaluates main.js as CommonJS. Left alone, esbuild passes a
	// dynamic import() of an external module straight through, and a native
	// import("node:http") inside a CJS module in the renderer is not something
	// to rely on resolving. Declaring the syntax unavailable makes esbuild emit
	// the Promise.resolve().then(() => require(...)) form instead, which is what
	// the one lazy Node import (the Google sign-in server) needs at runtime.
	// The source keeps its import(): that is what the directory's linter reads,
	// and it is still the call that never happens on mobile.
	supported: { "regexp-lookbehind-assertions": false, "dynamic-import": false },
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

if (prod) {
	await ctx.rebuild();
	await ctx.dispose();
	await import("./check-bundle.mjs");
	await import("./check-icons.mjs");
	process.exit(0);
} else {
	await ctx.watch();
}
