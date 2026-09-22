import { ITranslationCacheStore, TranslationConfig } from "./types";

interface StoredTranslationEntry {
	translatedText: string;
	html: boolean;
	sourceLanguage: string;
	targetLanguage: string;
	createdAt: number;
}

interface StoredTranslationFile {
	version: 1;
	entries: Record<string, StoredTranslationEntry>;
}

const STORAGE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic, dependency-free content hash for cache keys. */
export function translationHash(value: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < value.length; i++) {
		const ch = value.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function translationCacheKey(text: string, html: boolean, sourceLanguage: string, targetLanguage: string): string {
	return translationHash(`${STORAGE_VERSION}\u0000${sourceLanguage}\u0000${targetLanguage}\u0000${html ? "1" : "0"}\u0000${text}`);
}

/** Two-level cache: memory for instant redraws and optional JSON storage for
 *  restarts. It stores translations only, never credentials or raw mail. */
export class TranslationCache {
	private entries = new Map<string, StoredTranslationEntry>();
	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	constructor(
		private injectedStore: ITranslationCacheStore | null,
		private maxEntries = 500,
		private ttlMs = 30 * DAY_MS
	) {
		this.store = injectedStore;
	}

	private store: ITranslationCacheStore | null;

	configure(config: TranslationConfig): void {
		this.maxEntries = config.cacheMaxEntries;
		this.store = config.persistentCache ? this.injectedStore : null;
	}

	async load(): Promise<void> {
		if (!this.store) return;
		try {
			const raw = await this.store.read();
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<StoredTranslationFile>;
			if (parsed.version !== STORAGE_VERSION || !parsed.entries) return;
			this.entries = new Map(Object.entries(parsed.entries).filter(([, entry]) => this.isFresh(entry)));
		} catch (error) {
			console.warn("NyaHome translation: cached translations were unreadable.", error);
		}
	}

	get(key: string): string | null {
		const entry = this.entries.get(key);
		if (!entry) return null;
		if (!this.isFresh(entry)) {
			this.entries.delete(key);
			return null;
		}
		// Map insertion order is the LRU order.
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.translatedText;
	}

	set(key: string, translatedText: string, html: boolean, sourceLanguage: string, targetLanguage: string): void {
		if (!translatedText) return;
		this.entries.delete(key);
		this.entries.set(key, { translatedText, html, sourceLanguage, targetLanguage, createdAt: Date.now() });
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		this.schedulePersist();
	}

	get size(): number {
		return this.entries.size;
	}

	async clear(): Promise<void> {
		this.entries.clear();
		if (this.persistTimer !== null) clearTimeout(this.persistTimer);
		this.persistTimer = null;
		if (this.store) await this.store.clear().catch((error) => console.warn("NyaHome translation: could not clear persistent cache.", error));
	}

	dispose(): void {
		this.disposed = true;
		if (this.persistTimer !== null) clearTimeout(this.persistTimer);
		this.persistTimer = null;
	}

	private isFresh(entry: StoredTranslationEntry): boolean {
		return this.ttlMs <= 0 || Date.now() - entry.createdAt < this.ttlMs;
	}

	private schedulePersist(): void {
		if (!this.store || this.disposed) return;
		if (this.persistTimer !== null) clearTimeout(this.persistTimer);
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			void this.persist();
		}, 600);
	}

	private async persist(): Promise<void> {
		if (!this.store) return;
		const file: StoredTranslationFile = { version: STORAGE_VERSION, entries: Object.fromEntries(this.entries) };
		await this.store.write(JSON.stringify(file)).catch((error) => console.warn("NyaHome translation: could not save translations.", error));
	}
}
