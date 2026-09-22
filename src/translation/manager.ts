import { TranslationCache, translationCacheKey } from "./cache";
import { MTranServerTranslationService } from "./mtran-service";
import { SimpleTranslationEventBus } from "./event-bus";
import { TRANSLATION_CHUNK_CHARS, htmlToPlainText, splitTranslationChunks } from "./text";
import {
	HttpTransport,
	IMailMessage,
	ISettingsStorage,
	ITranslationCacheStore,
	ITranslationServiceV1,
	MailTranslationResult,
	TranslateMailOptions,
	TranslationCommand,
	TranslationCommandRegistrar,
	TranslationConfig,
	TranslationEventBus,
	TranslationEventHandler,
	TranslationLogger,
	TranslationMailController,
	TranslationMailEvent,
	TranslationServiceVersion,
	normalizeTranslationConfig,
} from "./types";

export interface TranslationManagerDeps {
	settings: ISettingsStorage;
	logger?: TranslationLogger;
	events?: TranslationEventBus;
	transport?: HttpTransport;
	cacheStore?: ITranslationCacheStore;
	/** Injection point for tests and future back ends. */
	service?: ITranslationServiceV1;
}

const MAIL_CACHE_LIMIT = 200;

/** Facade and lifecycle owner for translation. It mediates between mail
 *  views, settings, commands, the service, and the cache; nothing below it
 *  imports a view or plugin class. */
export class TranslationManager {
	private config: TranslationConfig;
	private service: ITranslationServiceV1;
	private cache: TranslationCache;
	private mailTranslations = new Map<string, MailTranslationResult>();
	private inFlight = new Map<string, Promise<MailTranslationResult | null>>();
	private eventUnsubscribers: Array<() => void> = [];

	constructor(private readonly deps: TranslationManagerDeps) {
		this.config = normalizeTranslationConfig(deps.settings.get());
		this.cache = new TranslationCache(deps.cacheStore ?? null, this.config.cacheMaxEntries);
		this.service = deps.service ?? new MTranServerTranslationService(() => this.config, deps.transport ?? { async request() { throw new Error("No translation transport was configured."); } });
	}

	/** Load normalized config and the optional persistent cache. */
	async initialize(): Promise<void> {
		this.config = normalizeTranslationConfig(this.deps.settings.get());
		this.cache.configure(this.config);
		await this.cache.load();
	}

	getConfig(): TranslationConfig {
		return { ...this.config };
	}

	getServiceVersion(): TranslationServiceVersion {
		return this.service.version;
	}

	/** Save a normalized config patch and invalidate mail-sized results whose
	 *  language direction may have changed. Text-level cache keys remain safe. */
	async updateConfig(patch: Partial<TranslationConfig>): Promise<void> {
		this.config = normalizeTranslationConfig({ ...this.config, ...patch });
		await this.deps.settings.save({ ...this.config });
		this.cache.configure(this.config);
		this.mailTranslations.clear();
	}

	/** Subscribe to translation results. Returns an unsubscribe function. */
	onTranslationUpdated(handler: TranslationEventHandler<"translation:updated">): () => void {
		return this.bus().on("translation:updated", handler);
	}

	/** Subscribe to background errors for notices or diagnostics. */
	onTranslationError(handler: TranslationEventHandler<"translation:error">): () => void {
		return this.bus().on("translation:error", handler);
	}

	/** Host notification after a message has been parsed. This never mutates
	 *  the original message object. */
	notifyMailReceived(event: TranslationMailEvent): void {
		this.bus().emit("mail:received", event);
		void this.translateMail(event.message, { silent: true });
	}

	/** Host notification when a mail body is available. */
	notifyMailSelected(event: TranslationMailEvent): void {
		const cached = this.mailTranslations.get(event.key);
		if (cached) this.bus().emit("translation:updated", { key: event.key, result: cached });
		this.bus().emit("mail:selected", event);
		if (this.config.enabled && this.config.autoTranslate) void this.translateMail(event.message, { silent: true });
	}

	/** Translate subject and/or body and retain a mail-sized result. Returns
	 *  null on a silent failure; manual callers may let the error surface. */
	async translateMail(mail: IMailMessage, options: TranslateMailOptions = {}): Promise<MailTranslationResult | null> {
		const { silent = true } = options;
		if (!mail.id) return null;
		if (!this.config.enabled) throw new Error("Translation is disabled. Enable it in Settings -> Translation.");
		if (!this.config.endpoint.trim()) throw new Error("MTranServer endpoint is not configured.");
		const inFlightKey = `${mail.id}\u0000${this.config.sourceLanguage}\u0000${this.config.targetLanguage}`;
		const pending = this.inFlight.get(inFlightKey);
		if (pending) return pending;

		const task = this.translateMailNow(mail, silent)
			.finally(() => this.inFlight.delete(inFlightKey));
		this.inFlight.set(inFlightKey, task);
		return task;
	}

	/** Translate a short plain-text selection without requiring a mail object.
	 *  This is intentionally basic-typed so sketch notes and future editor
	 *  surfaces can use the module without importing mail interfaces. */
	async translatePlainText(text: string): Promise<string> {
		if (!text.trim()) return text;
		if (!this.config.enabled) throw new Error("Translation is disabled. Enable it in Settings -> Translation.");
		if (!this.config.endpoint.trim()) throw new Error("MTranServer endpoint is not configured.");
		const result = await this.translateCached(text, false, this.config.sourceLanguage, this.config.targetLanguage);
		return result.value;
	}

	/** Cached mail-sized result, if one is already known this session. */
	getCachedMail(key: string): MailTranslationResult | null {
		return this.mailTranslations.get(key) ?? null;
	}

	async clearCache(): Promise<void> {
		this.mailTranslations.clear();
		await this.cache.clear();
	}

	async healthCheck(): Promise<boolean> {
		return this.service.healthCheck();
	}

	/** Register host commands. The controller factory lets commands act on the
	 *  currently focused mail view without the module importing ItemView. */
	registerCommands(registrar: TranslationCommandRegistrar, controllerFactory: () => TranslationMailController | null): void {
		const run = (kind: "current" | "selected") => {
			const controller = controllerFactory();
			if (!controller) return;
			void (kind === "current" ? controller.translateCurrent() : controller.translateSelected());
		};
		const commands: TranslationCommand[] = [
			{ id: "translate-current-mail", name: "Translate current mail", icon: "languages", callback: () => run("current") },
			{ id: "translate-selected-mail", name: "Translate selected mail", icon: "languages", callback: () => run("selected") },
		];
		for (const command of commands) registrar.addCommand(command);
	}

	dispose(): void {
		for (const unsubscribe of this.eventUnsubscribers.splice(0)) unsubscribe();
		this.inFlight.clear();
		this.mailTranslations.clear();
		this.cache.dispose();
		if (this.ownedBus) this.ownedBus.clear();
	}

	private ownedBus: SimpleTranslationEventBus | null = null;

	private bus(): TranslationEventBus {
		if (this.deps.events) return this.deps.events;
		if (!this.ownedBus) this.ownedBus = new SimpleTranslationEventBus();
		return this.ownedBus;
	}

	private async translateMailNow(mail: IMailMessage, silent: boolean): Promise<MailTranslationResult | null> {
		try {
			const from = this.config.sourceLanguage;
			const to = this.config.targetLanguage;
			// Markup is stripped before the request, so `<br>` and other tags are
			// never shown to the model. Block tags and `<br>` become newlines.
			const bodySource = mail.isHtml ? htmlToPlainText(mail.body) : mail.body;
			const [subject, body, subjectTranslated, bodyTranslated] = await Promise.all([
				this.config.translateSubject ? this.translatePart(mail.subject, false, from, to) : Promise.resolve({ value: mail.subject, fromCache: true, isHtml: false }),
				this.config.translateBody ? this.translatePart(bodySource, false, from, to) : Promise.resolve({ value: bodySource, fromCache: true, isHtml: false }),
				this.config.translateSubject,
				this.config.translateBody,
			]);
			const result: MailTranslationResult = {
				key: mail.id,
				translatedSubject: subjectTranslated ? subject.value : mail.subject,
				translatedBody: bodyTranslated ? body.value : bodySource,
				isHtml: false,
				targetLanguage: to,
				createdAt: Date.now(),
				fromCache: subject.fromCache && body.fromCache,
			};
			this.rememberMailResult(result);
			this.bus().emit("translation:updated", { key: result.key, result });
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.deps.logger?.warn(`NyaHome translation: could not translate mail ${mail.id}.`, error);
			if (silent) {
				this.bus().emit("translation:error", { key: mail.id, message });
				return null;
			}
			throw error;
		}
	}

	private async translatePart(
		text: string,
		html: boolean,
		from: string,
		to: string
	): Promise<{ value: string; fromCache: boolean; isHtml: boolean }> {
		if (!text.trim() || from === to) return { value: text, fromCache: true, isHtml: html };
		// Do not let a provider silently truncate a long body. Chunk before the
		// first request so the result is complete even when the server answers 200.
		if (text.length > TRANSLATION_CHUNK_CHARS) return await this.translateChunked(text, html, from, to);
		try {
			return await this.translateCached(text, html, from, to);
		} catch (error) {
			// Some mail bodies make a model server reject the whole request. The
			// first fallback removes markup; the second breaks very long text into
			// sentence-sized requests. Neither changes the original mail object.
			if (html) {
				const plain = htmlToPlainText(text);
				if (plain.trim()) return await this.translateChunked(plain, false, from, to);
			}
			if (text.length > TRANSLATION_CHUNK_CHARS) return await this.translateChunked(text, html, from, to);
			throw error;
		}
	}

	private async translateCached(
		text: string,
		html: boolean,
		from: string,
		to: string
	): Promise<{ value: string; fromCache: boolean; isHtml: boolean }> {
		const key = translationCacheKey(text, html, from, to);
		if (this.config.cacheEnabled) {
			const cached = this.cache.get(key);
			if (cached !== null) return { value: cached, fromCache: true, isHtml: html };
		}
		const result = await this.service.translateText(text, html, from, to);
		// A plain-text request may still echo markup learned from the mail.
		// Normalize only when markup is present, so normal angle brackets stay.
		const value = !html && /<\s*\/?\s*(?:br|p|div|span|li|h[1-6])\b/i.test(result.translatedText)
			? htmlToPlainText(result.translatedText)
			: result.translatedText;
		if (this.config.cacheEnabled) this.cache.set(key, value, html, from, to);
		return { value, fromCache: false, isHtml: html };
	}

	private async translateChunked(
		text: string,
		html: boolean,
		from: string,
		to: string
	): Promise<{ value: string; fromCache: boolean; isHtml: boolean }> {
		const chunks = splitTranslationChunks(text);
		if (chunks.length <= 1) return await this.translateCached(text, html, from, to);
		const values: string[] = [];
		let fromCache = true;
		for (const chunk of chunks) {
			const part = await this.translateCached(chunk.text, html, from, to);
			values.push(part.value);
			fromCache = fromCache && part.fromCache;
		}
		// Split boundaries are kept out of the model request and restored after
		// translation, so a paragraph split across two requests still displays
		// on separate lines.
		const value = values
			.map((part, index) => (index < chunks.length - 1 ? part + chunks[index].separator : part))
			.join("");
		return { value, fromCache, isHtml: html };
	}

	private rememberMailResult(result: MailTranslationResult): void {
		this.mailTranslations.delete(result.key);
		this.mailTranslations.set(result.key, result);
		while (this.mailTranslations.size > MAIL_CACHE_LIMIT) {
			const oldest = this.mailTranslations.keys().next().value;
			if (oldest === undefined) break;
			this.mailTranslations.delete(oldest);
		}
	}
}
