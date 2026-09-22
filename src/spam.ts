/** A small, local-first spam scorer for the IMAP mail view. It deliberately
 *  stays conservative: the view always asks the user to confirm the move. */

export const SPAM_THRESHOLD = 3;

export interface SpamVerdict {
	score: number;
	reasons: string[];
}

export interface SpamInput {
	subject?: string;
	from?: string;
	snippet?: string;
	/** Plain-text body sampled by the asynchronous IMAP scanner. */
	body?: string;
	headers?: Record<string, string>;
	blacklist?: string[];
	keywords?: string[];
}

export interface InvoiceInput {
	subject?: string;
	from?: string;
	snippet?: string;
	body?: string;
}

/** The defaults are intentionally review-oriented, not auto-delete rules:
 *  every hit is shown to the user before anything moves. */
export const DEFAULT_SPAM_KEYWORDS = [
	"邮件拦截提醒",
	"已用流量",
	"愿望单上的",
	"一次性",
	"登入",
	"Epic",
	"验证",
	"Steam",
	"verify",
];

/** Trim, drop blanks, and deduplicate keywords case-insensitively while
 *  keeping the first spelling the user entered. */
export function normalizeSpamKeywords(values: readonly string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const value = raw.trim().replace(/\s+/g, " ");
		const key = value.toLowerCase();
		if (!value || seen.has(key)) continue;
		seen.add(key);
		out.push(value);
	}
	return out;
}

/** Best-effort plain text for a partially fetched MIME source. The full mail
 *  parser handles normal messages; this only keeps the fallback readable. */
export function plainTextForSpam(value: string): string {
	return value
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

const MARKETING_TERMS = [
	"促销", "优惠", "折扣", "特价", "限时", "秒杀", "免费", "中奖", "抽奖", "领奖",
	"优惠券", "返现", "开票", "代开", "发票", "加微信", "加我", "推广", "广告",
	"sale", "discount", "promo", "offer", "deal", "coupon", "free", "winner",
	"prize", "cash", "investment", "loan", "crypto", "bitcoin", "casino",
	"limited time", "click here", "unsubscribe",
];

const SPAM_HEADERS = [
	"x-spam-flag",
	"x-spam-status",
	"x-spam-score",
	"x-spam-level",
	"x-spam",
	"x-original-spam-flag",
	"x-rspamd-score",
	"authentication-results",
	"arc-authentication-results",
	"received-spf",
	"list-unsubscribe",
	"precedence",
];

const INVOICE_TERMS = ["发票", "invoice"];

/** Providers often send a delivery or gateway notice when a message is held.
 *  The notice itself is not correspondence the user needs beside real mail. */
const SPAM_BLOCK_NOTICE = /邮件拦截提醒|邮件拦截通知|垃圾邮件拦截提醒|北航邮件拦截|spam.{0,12}interception|message.{0,12}interception/i;

function headerNumber(value: string | undefined): number | null {
	const match = (value ?? "").match(/-?\d+(?:\.\d+)?/);
	if (!match) return null;
	const number = Number(match[0]);
	return Number.isFinite(number) ? number : null;
}

/** Parse only the header lines we asked the server for. Folded headers are
 *  joined with a space; unknown lines are ignored rather than guessed. */
export function parseRawHeaders(raw: Buffer | string | null | undefined): Record<string, string> {
	if (!raw) return {};
	const text = typeof raw === "string" ? raw : raw.toString("utf8");
	const out: Record<string, string> = {};
	let lastKey = "";
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (!line) break;
		if (/^[ \t]/.test(line)) {
			if (lastKey) out[lastKey] = `${out[lastKey]} ${line.trim()}`.trim();
			continue;
		}
		const at = line.indexOf(":");
		if (at < 1) continue;
		const key = line.slice(0, at).trim().toLowerCase();
		if (!SPAM_HEADERS.includes(key)) continue;
		const value = line.slice(at + 1).trim();
		out[key] = out[key] ? `${out[key]} ${value}` : value;
		lastKey = key;
	}
	return out;
}

export function scoreSpam(input: SpamInput): SpamVerdict {
	const verdict: SpamVerdict = { score: 0, reasons: [] };
	const headers = input.headers ?? {};
	const subject = (input.subject ?? "").toLowerCase();
	const from = (input.from ?? "").toLowerCase();
	const snippet = (input.snippet ?? "").toLowerCase();
	const body = (input.body ?? "").toLowerCase();
	const bump = (points: number, reason: string) => {
		verdict.score += points;
		verdict.reasons.push(reason);
	};

	if (/^yes\b/i.test(headers["x-spam-flag"] ?? "")) bump(4, "Spam header: X-Spam-Flag");
	if (/^yes\b/i.test(headers["x-spam-status"] ?? "")) bump(4, "Spam header: X-Spam-Status");
	if (/^yes\b/i.test(headers["x-original-spam-flag"] ?? headers["x-spam"] ?? "")) bump(4, "Spam header: original flag");

	const spamScore = headerNumber(headers["x-spam-score"]);
	if (spamScore != null) {
		if (spamScore >= 10) bump(4, `Spam score ${spamScore}`);
		else if (spamScore >= 5) bump(2, `Spam score ${spamScore}`);
	}

	const levelHeader = headers["x-spam-level"] ?? "";
	const spamLevel = levelHeader.includes("*") ? levelHeader.split("*").length - 1 : headerNumber(levelHeader) ?? 0;
	if (spamLevel >= 5) bump(3, `Spam level ${spamLevel}`);

	const rspamd = headerNumber(headers["x-rspamd-score"]);
	if (rspamd != null) {
		if (rspamd >= 10) bump(4, `Rspamd score ${rspamd}`);
		else if (rspamd >= 5) bump(2, `Rspamd score ${rspamd}`);
	}

	let auth = [headers["authentication-results"], headers["arc-authentication-results"], headers["received-spf"]]
		.filter(Boolean)
		.join(" ");
	if (/^fail\b/i.test(headers["received-spf"] ?? "")) auth += " spf=fail";
	const authFailures = ["spf", "dkim", "dmarc"].filter((mechanism) => new RegExp(`\\b${mechanism}\\s*=\\s*fail\\b`, "i").test(auth));
	if (authFailures.length) bump(Math.min(4, authFailures.length * 2), `Authentication failed: ${authFailures.join(", ")}`);

	if (headers["list-unsubscribe"]) bump(1, "Bulk mail header");
	if (/^bulk|^junk/i.test(headers["precedence"] ?? "")) bump(1, "Bulk precedence");

	const text = `${subject}\n${snippet}\n${body}`;
	const term = MARKETING_TERMS.find((word) => text.includes(word));
	if (term) bump(2, `Promotional language: ${term}`);

	const blockNotice = SPAM_BLOCK_NOTICE.test(text);
	if (blockNotice) bump(4, "Mail interception notice");

	for (const raw of normalizeSpamKeywords(input.keywords ?? DEFAULT_SPAM_KEYWORDS)) {
		const token = raw.trim().toLowerCase();
		// The interception phrase already has a dedicated high-confidence rule.
		if (blockNotice && token === "邮件拦截提醒") continue;
		if (from.includes(token) || text.includes(token)) {
			bump(4, `Sensitive word: ${raw.trim()}`);
			break;
		}
	}

	for (const raw of input.blacklist ?? []) {
		const token = raw.trim().toLowerCase();
		if (!token) continue;
		if (from.includes(token) || text.includes(token)) {
			bump(4, `Blacklist: ${raw.trim()}`);
			break;
		}
	}

	return verdict;
}

/** Invoice mail is deliberately pulled out of the spam scan and filed in its
 *  own mailbox instead, even when it looks promotional. */
export function invoiceReasons(input: InvoiceInput): string[] {
	const subject = (input.subject ?? "").toLowerCase();
	const from = (input.from ?? "").toLowerCase();
	const snippet = (input.snippet ?? "").toLowerCase();
	const body = (input.body ?? "").toLowerCase();
	const text = `${subject}\n${from}\n${snippet}\n${body}`;
	return INVOICE_TERMS.filter((term) => text.includes(term)).map((term) => `Invoice keyword: ${term}`);
}
