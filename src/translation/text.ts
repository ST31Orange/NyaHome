/** Upper bound per request. MTranServer can accept more, but mail often
 *  carries boilerplate, inline styles, and tracking markup; smaller chunks
 *  keep one bad sentence from failing an entire message. */
export const TRANSLATION_CHUNK_CHARS = 3500;

/** Convert translated-mail HTML to plain text for the fallback request. The
 *  output is only sent to the configured translation server; it never replaces
 *  the original message in the mail view. */
export function htmlToPlainText(html: string): string {
	try {
		const document = new DOMParser().parseFromString(html, "text/html");
		document.querySelectorAll("script, style, noscript, template").forEach((el) => el.remove());
		document.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
		for (const tag of ["p", "div", "section", "article", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]) {
			document.querySelectorAll(tag).forEach((el) => el.append("\n"));
		}
		const markupTokens = /<\s*\/?\s*(?:br|p|div|span|a|b|strong|em|i|ul|ol|li|table|tr|td|th|h[1-6]|section|article|blockquote)\b[^>]*>/gi;
		return (document.body.textContent ?? "")
			.replace(markupTokens, "\n")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	} catch {
		// The unit-test environment and a few non-browser hosts do not expose
		// DOMParser. Keep the same line-boundary behavior without one.
		return html
			.replace(/<\s*br\b[^>]*>/gi, "\n")
			.replace(/<\s*\/?\s*(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, "\n")
			.replace(/<[^>]*>/g, " ")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n[ \t]+/g, "\n")
			.replace(/[ \t]{2,}/g, " ")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}
}

/** Split plain text on paragraph, sentence, or word boundaries without losing
 *  the separator. This is used only after a whole-message request fails. */
export interface TranslationChunk {
	/** The text to send in one request, without its trailing separator. */
	text: string;
	/** Preserved when joining translated chunks; `\n` for line boundaries. */
	separator: string;
}

export function splitTranslationChunks(text: string, limit = TRANSLATION_CHUNK_CHARS): TranslationChunk[] {
	const safeLimit = Math.max(200, limit);
	if (text.length <= safeLimit) return text ? [{ text, separator: "" }] : [];
	const chunks: TranslationChunk[] = [];
	let start = 0;
	while (start < text.length) {
		const hardEnd = Math.min(text.length, start + safeLimit);
		if (hardEnd === text.length) {
			chunks.push({ text: text.slice(start), separator: "" });
			break;
		}
		const window = text.slice(start, hardEnd);
		const breakers = [/\r?\n\s*\r?\n/g, /[.!?。！？]\s/g, /[;；]\s/g, /\s/g];
		let boundaryStart = hardEnd;
		let boundaryEnd = hardEnd;
		for (const breaker of breakers) {
			const matches = Array.from(window.matchAll(breaker));
			const last = matches.at(-1);
			if (last && last.index !== undefined && last.index + last[0].length > safeLimit / 4) {
				boundaryStart = start + last.index;
				boundaryEnd = start + last.index + last[0].length;
				break;
			}
		}
		const separatorSource = text.slice(boundaryStart, boundaryEnd);
		const separator = /\r?\n/.test(separatorSource) ? "\n" : separatorSource;
		const chunkText = text.slice(start, boundaryStart);
		if (chunkText) chunks.push({ text: chunkText, separator });
		start = boundaryStart === start ? hardEnd : boundaryEnd;
	}
	return chunks.filter((chunk) => chunk.text.length > 0);
}
