/* Simplified-Chinese layer: a MutationObserver that swaps matching text
 * nodes, placeholders, and titles for their zh entries after render. Keyed by
 * the exact English source string, so main.ts stays untouched and upstream
 * merges carry no conflicts. Only mutates when the value would change, so
 * the observer's own writes converge instead of looping. */

import { zh } from "./i18n-zh";

const PREFIX_EN = "AmberNyaDesk: ";
const PREFIX_ZH = "AmberNyaDesk：";

/** The interface language: "zh" runs the swap layer, "en" leaves every
 *  string as its English source. Flip it from the language setting. */
let lang: "zh" | "en" = "zh";

export function setI18nLang(next: "zh" | "en"): void {
	lang = next;
}

/** Dictionary lookup for a single string: the exact zh hit, the "AmberNyaDesk: "
 *  prefix rule, or the original. Exported so main.ts can localize strings at
 *  the source — settings definitions, for instance, which Obsidian renders
 *  itself and whose DOM timing no observer can rely on. */
export function t(text: string): string {
	return translateText(text) ?? text;
}

function translateText(text: string): string | null {
	if (lang === "en") return null;
	const trimmed = text.trim();
	if (!trimmed) return null;
	const hit = zh[trimmed];
	if (hit && hit !== trimmed) {
		// keep any surrounding whitespace the node carried
		const lead = text.slice(0, text.length - text.trimStart().length);
		const tail = text.slice(text.trimEnd().length);
		return lead + hit + tail;
	}
	if (trimmed.startsWith(PREFIX_EN)) {
		const rest = trimmed.slice(PREFIX_EN.length);
		const restHit = zh[rest];
		const tailText = restHit && restHit !== rest ? restHit : rest;
		return PREFIX_ZH + tailText;
	}
	return null;
}

function walk(root: Node) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	const edits: { node: Text; value: string }[] = [];
	while (node) {
		const parent = node.parentElement;
		const skip = parent && /^(script|style|textarea)$/i.test(parent.tagName);
		if (!skip) {
			const next = translateText(node.nodeValue ?? "");
			if (next && next !== node.nodeValue) edits.push({ node: node as Text, value: next });
		}
		node = walker.nextNode();
	}
	for (const e of edits) e.node.nodeValue = e.value;

	if (root instanceof Element) {
		translateAttrs(root);
		const own = root.querySelectorAll("[placeholder], [title], [aria-label]");
		for (let i = 0; i < own.length; i++) translateAttrs(own[i]);
	} else {
		const own = document.querySelectorAll("[placeholder], [title], [aria-label]");
		for (let i = 0; i < own.length; i++) translateAttrs(own[i]);
	}
}

function translateAttrs(el: Element) {
	for (const attr of ["placeholder", "title", "aria-label"]) {
		const value = el.getAttribute(attr);
		if (!value) continue;
		const next = translateText(value) ?? (value.startsWith(PREFIX_EN) ? PREFIX_ZH + value.slice(PREFIX_EN.length) : null);
		if (next && next !== value) el.setAttribute(attr, next);
	}
}

/** Start the observer. Returns it so onload can unregister; null in
 *  environments without MutationObserver (no-ops everywhere else). */
export function startI18n(): MutationObserver | null {
	if (typeof MutationObserver === "undefined" || typeof document === "undefined") return null;
	let queued = false;
	let pendingRoots: Set<Node> | null = null;
	const obs = new MutationObserver((muts) => {
		// remember which subtrees changed so a full-document walk is only
		// needed for the first paint, never after that
		const roots = new Set<Node>();
		for (const m of muts) {
			roots.add(m.target);
			for (let i = 0; i < m.addedNodes.length; i++) roots.add(m.addedNodes[i]);
		}
		pendingRoots = roots;
		if (queued) return;
		queued = true;
		window.requestAnimationFrame(() => {
			queued = false;
			const roots = pendingRoots ?? new Set<Node>([document.body]);
			pendingRoots = null;
			for (const r of roots) {
				if (!r.isConnected) continue;
				walk(r instanceof Element ? r : r.parentElement ?? document.body);
			}
		});
	});
	obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
	walk(document.body);
	// the sweep is the safety net: whatever the observer's timing misses
	// (detached renders, virtualized lists) still converges within seconds
	sweepTimer = window.setInterval(() => walk(document.body), 2000);
	return obs;
}

let sweepTimer: number | null = null;

export function stopI18n() {
	if (sweepTimer != null) {
		window.clearInterval(sweepTimer);
		sweepTimer = null;
	}
}
