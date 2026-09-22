import { HttpResponse, HttpTransport, HttpRequest, ITranslationServiceV1, TranslationConfig, TranslationTextResult, TRANSLATION_SERVICE_VERSION } from "./types";

interface MTranRequestBody {
	from: string;
	to: string;
	text: string;
	html: boolean;
}

interface MTranResponseBody {
	translatedText?: unknown;
	/** MTranServer v4 returns `result`; older guides often show `translatedText`. */
	result?: unknown;
	message?: unknown;
	error?: unknown;
}

function endpointFor(baseUrl: string): string {
	const url = baseUrl.trim().replace(/\/+$/, "");
	if (!url) return "";
	return /\/translate\/?$/i.test(url) ? url : `${url}/translate`;
}

function timeoutError(ms: number): Error {
	return new Error(`MTranServer request timed out after ${ms} ms.`);
}

async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			task,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(timeoutError(ms)), ms);
			}),
		]);
	} finally {
		if (timer !== null) clearTimeout(timer);
	}
}

/** Adapter for a local MTranServer deployment. It owns only HTTP concerns;
 *  caching, settings, and mail-shaped orchestration live above it. */
export class MTranServerTranslationService implements ITranslationServiceV1 {
	readonly version = TRANSLATION_SERVICE_VERSION;

	constructor(
		private readonly configProvider: () => TranslationConfig,
		private readonly http: HttpTransport
	) {}

	async translateText(text: string, html: boolean, from: string, to: string): Promise<TranslationTextResult> {
		const config = this.configProvider();
		if (!config.enabled) throw new Error("Translation is disabled.");
		if (!config.endpoint.trim()) throw new Error("MTranServer endpoint is not configured.");
		if (!text.trim()) return { translatedText: text, fromCache: false };

		const requestBody: MTranRequestBody = { from, to, text, html };
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (config.token.trim()) headers.Authorization = `Bearer ${config.token.trim()}`;
		const request: HttpRequest = {
			url: endpointFor(config.endpoint),
			method: "POST",
			headers,
			body: JSON.stringify(requestBody),
			timeoutMs: config.timeoutMs,
		};
		const response = await withTimeout(this.http.request(request), config.timeoutMs);
		const result = this.parseResponse(response);
		return { translatedText: result, fromCache: false };
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.translateText("ok", false, this.configProvider().sourceLanguage, this.configProvider().targetLanguage);
			return true;
		} catch {
			return false;
		}
	}

	private parseResponse(response: HttpResponse): string {
		let parsed: MTranResponseBody;
		try {
			parsed = JSON.parse(response.body) as MTranResponseBody;
		} catch {
			throw new Error(`MTranServer returned non-JSON output (status ${response.status}).`);
		}
		const translated = typeof parsed.translatedText === "string" ? parsed.translatedText : parsed.result;
		if (typeof translated !== "string") {
			const detail = typeof parsed.error === "string" ? parsed.error : typeof parsed.message === "string" ? parsed.message : "invalid response";
			throw new Error(`MTranServer request failed (status ${response.status}): ${detail}.`);
		}
		return translated;
	}
}
