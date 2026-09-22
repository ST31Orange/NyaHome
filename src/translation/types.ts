/** Stable, versioned surface for translation back ends. Future V2 methods
 *  must be added as a new interface rather than breaking this one. */
export const TRANSLATION_SERVICE_VERSION = "v1" as const;

export type TranslationServiceVersion = typeof TRANSLATION_SERVICE_VERSION;

/** A translation returned by a service. Only primitive fields cross the V1
 *  boundary, so callers never depend on a particular HTTP client or model. */
export interface TranslationTextResult {
	translatedText: string;
	/** True when the result came from a cache rather than the network. */
	fromCache: boolean;
}

export interface ITranslationServiceV1 {
	readonly version: TranslationServiceVersion;
	/** Translate one subject or body. `html` tells the back end whether the
	 *  text should be treated as markup instead of plain text. */
	translateText(text: string, html: boolean, from: string, to: string): Promise<TranslationTextResult>;
	/** Best-effort availability probe; it must never throw. */
	healthCheck(): Promise<boolean>;
}

/** Configuration lives under `data.json -> translation`, completely apart
 *  from mail and calendar settings. */
export interface TranslationConfig {
	enabled: boolean;
	/** Base URL of MTranServer; `/translate` is appended unless already set. */
	endpoint: string;
	/** Optional bearer token. Empty sends no Authorization header. */
	token: string;
	sourceLanguage: string;
	targetLanguage: string;
	autoTranslate: boolean;
	translateSubject: boolean;
	translateBody: boolean;
	cacheEnabled: boolean;
	persistentCache: boolean;
	/** Request timeout in milliseconds. */
	timeoutMs: number;
	/** Maximum in-memory translation entries. */
	cacheMaxEntries: number;
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
	enabled: false,
	endpoint: "",
	token: "",
	sourceLanguage: "en",
	targetLanguage: "zh-Hans",
	autoTranslate: false,
	translateSubject: true,
	translateBody: true,
	cacheEnabled: true,
	persistentCache: true,
	timeoutMs: 15000,
	cacheMaxEntries: 500,
};

/** Normalize user-edited or synced data before the module ever sees it. */
export function normalizeTranslationConfig(raw: unknown): TranslationConfig {
	const value = (raw ?? {}) as Partial<TranslationConfig>;
	const timeout = Number(value.timeoutMs);
	const maxEntries = Number(value.cacheMaxEntries);
	return {
		enabled: value.enabled === true,
		endpoint: typeof value.endpoint === "string" ? value.endpoint.trim() : "",
		token: typeof value.token === "string" ? value.token : "",
		sourceLanguage: typeof value.sourceLanguage === "string" && value.sourceLanguage.trim() ? value.sourceLanguage.trim() : DEFAULT_TRANSLATION_CONFIG.sourceLanguage,
		targetLanguage: typeof value.targetLanguage === "string" && value.targetLanguage.trim() ? value.targetLanguage.trim() : DEFAULT_TRANSLATION_CONFIG.targetLanguage,
		autoTranslate: value.autoTranslate === true,
		translateSubject: value.translateSubject !== false,
		translateBody: value.translateBody !== false,
		cacheEnabled: value.cacheEnabled !== false,
		persistentCache: value.persistentCache !== false,
		timeoutMs: Number.isFinite(timeout) ? Math.min(120000, Math.max(1000, timeout)) : DEFAULT_TRANSLATION_CONFIG.timeoutMs,
		cacheMaxEntries: Number.isFinite(maxEntries) ? Math.min(10000, Math.max(10, maxEntries)) : DEFAULT_TRANSLATION_CONFIG.cacheMaxEntries,
	};
}

/** The minimum a mail view must expose for translation. It deliberately does
 *  not describe Graph mail, IMAP attachments, folders, or providers. */
export interface IMailMessage {
	/** Stable key for cache lookup and update events. */
	id: string;
	subject: string;
	/** Plain text when `isHtml` is false; markup when it is true. */
	body: string;
	isHtml: boolean;
}

/** A mail-sized result retained separately from the original message. */
export interface MailTranslationResult {
	key: string;
	translatedSubject: string;
	translatedBody: string;
	isHtml: boolean;
	targetLanguage: string;
	createdAt: number;
	fromCache: boolean;
}

export interface TranslationMailEvent {
	key: string;
	message: IMailMessage;
}

export interface TranslationErrorEvent {
	key: string;
	message: string;
}

/** Events emitted by hosts. `mail:selected` is the practical auto-translation
 *  trigger because message bodies can only be parsed after selection. */
export interface TranslationEventMap {
	"mail:received": TranslationMailEvent;
	"mail:selected": TranslationMailEvent;
	"translation:updated": { key: string; result: MailTranslationResult };
	"translation:error": TranslationErrorEvent;
}

export type TranslationEventName = keyof TranslationEventMap;

export type TranslationEventHandler<Event extends TranslationEventName> = (payload: TranslationEventMap[Event]) => void | Promise<void>;

export interface TranslationEventBus {
	on<Event extends TranslationEventName>(event: Event, handler: TranslationEventHandler<Event>): () => void;
	emit<Event extends TranslationEventName>(event: Event, payload: TranslationEventMap[Event]): void;
}

/** Storage adapter implemented by the host plugin. The module never imports
 *  the plugin class or knows where `data.json` really lives. */
export interface ISettingsStorage {
	get(): TranslationConfig;
	save(config: TranslationConfig): Promise<void> | void;
}

/** Optional JSON persistence adapter for translated text. */
export interface ITranslationCacheStore {
	read(): Promise<string | null>;
	write(value: string): Promise<void>;
	clear(): Promise<void>;
}

/** Transport adapter keeps the service testable and lets the host choose
 *  Obsidian's requestUrl without the module importing platform APIs. */
export interface HttpRequest {
	url: string;
	method: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
	timeoutMs: number;
}

export interface HttpResponse {
	status: number;
	body: string;
}

export interface HttpTransport {
	request(request: HttpRequest): Promise<HttpResponse>;
}

export interface TranslationLogger {
	debug(message: string, ...details: unknown[]): void;
	warn(message: string, ...details: unknown[]): void;
}

/** Command shape intentionally mirrors the subset the host needs. */
export interface TranslationCommand {
	id: string;
	name: string;
	icon?: string;
	callback: () => void;
}

export interface TranslationCommandRegistrar {
	addCommand(command: TranslationCommand): void;
}

/** The view owns how selected/current mail is resolved; the manager only
 *  asks it to perform user-facing work. */
export interface TranslationMailController {
	translateCurrent(): Promise<void>;
	translateSelected(): Promise<void>;
}

export interface TranslateMailOptions {
	/** Silent mode is for automatic translation; errors go to the event bus. */
	silent?: boolean;
}
