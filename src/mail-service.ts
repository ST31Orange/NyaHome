import { App } from "obsidian";
import {
	ImapAccount,
	ImapAttachment,
	ImapBody,
	ImapFolderInfo,
	ImapMessage,
	bodyHasAttachment,
	imapLabel,
	parseMessage,
	sendImapMail,
	SmtpAttachment,
	SmtpMail,
} from "./imap";
import {
	MailCacheFolderRef,
	MailCacheSettings,
	MailCacheStats,
	shouldCacheMailFolder,
} from "./mail-cache";
import { decryptSecret } from "./secret";
import { invoiceReasons, parseRawHeaders, plainTextForSpam, scoreSpam, SPAM_THRESHOLD } from "./spam";

interface ImapHost {
	app: App;
	settings: { imapAccounts: ImapAccount[]; mailDebugLog: boolean; imapSpamBlacklist?: string[]; imapSpamKeywords?: string[]; mailHistoryDays?: number; mailCache?: MailCacheSettings };
	manifest: { id: string };
}

export interface SpamHit {
	message: ImapMessage;
	score: number;
	reasons: string[];
}

export interface TicketHit {
	message: ImapMessage;
	reasons: string[];
}

export interface FolderScan {
	spam: SpamHit[];
	invoices: TicketHit[];
}

const INVOICE_FOLDER_NAME = "电子发票";
const SPAM_BODY_SAMPLE_BYTES = 64 * 1024;

interface ImapFolderCache {
	accountId: string;
	folder: string;
	uidValidity: number;
	uidNext: number;
	lastUid: number;
	fetchedAt: number;
	messages: ImapMessage[];
}

interface ImapFolderListCache {
	accountId: string;
	fetchedAt: number;
	folders: ImapFolderInfo[];
}

/** A shared IMAP client and sharded metadata cache. The views call this for
 *  both the instant local list and the incremental server refresh; a connection
 *  deliberately survives a leaf closing and is dropped only on plugin unload. */
export class ImapMailService {
	private clients = new Map<string, any>();
	private connecting = new Map<string, Promise<any>>();
	private folders = new Map<string, ImapFolderCache>();
	private folderLists = new Map<string, ImapFolderListCache>();
	private folderListPending = new Map<string, Promise<ImapFolderInfo[]>>();

	constructor(private host: ImapHost) {}

	/** Reusable connections are opened eagerly at plugin load, but errors are
	 *  silent there: the view has its own explicit sync and can surface one. */
	async warmup() {
		for (const a of this.host.settings.imapAccounts) {
			try {
				await this.client(a);
				await this.refreshFolderInfos(a);
			} catch (e) {
				console.warn(`AmberNyaDesk: IMAP warmup failed for ${imapLabel(a)}.`, e);
			}
		}
	}

	private baseDir(): string {
		return `${this.host.app.vault.configDir}/plugins/${this.host.manifest.id}/imap-cache`;
	}

	private safe(value: string): string {
		return encodeURIComponent(value).replace(/[.\/\\:*?"<>|]/g, "-");
	}

	private cachePath(a: ImapAccount, folder: string): string {
		return `${this.baseDir()}/${this.safe(a.id)}/${this.safe(folder)}.json`;
	}

	private folderListPath(a: ImapAccount): string {
		return `${this.baseDir()}/${this.safe(a.id)}.folders.json`;
	}

	private async ensureDir(path: string) {
		try {
			await this.host.app.vault.adapter.mkdir(path);
		} catch {
			/* already there, or the leaf write below will report a real problem */
		}
	}

	private async client(a: ImapAccount): Promise<any> {
		const old = this.clients.get(a.id);
		if (old) return old;
		const pending = this.connecting.get(a.id);
		if (pending) return pending;
		const task = (async () => {
			const started = performance.now();
			const { ImapFlow } = await import("imapflow");
			const client = new ImapFlow({
				host: a.imapHost,
				port: a.imapPort,
				secure: a.secure,
				auth: { user: a.user, pass: decryptSecret(a.password) },
				logger: false,
				id: `nyahome:${a.id}`,
			});
			client.on?.("close", () => {
				if (this.clients.get(a.id) === client) this.clients.delete(a.id);
			});
			client.on?.("error", (err: unknown) => {
				console.warn(`AmberNyaDesk: IMAP connection error (${imapLabel(a)}).`, err);
				if (this.clients.get(a.id) === client) this.clients.delete(a.id);
			});
			await client.connect();
			if (this.host.settings.mailDebugLog) console.debug(`AmberNyaDesk IMAP: connect/login ${imapLabel(a)} took ${(performance.now() - started).toFixed(1)} ms.`);
			this.clients.set(a.id, client);
			return client;
		})();
		this.connecting.set(a.id, task);
		try {
			return await task;
		} finally {
			this.connecting.delete(a.id);
		}
	}

	private async time<T>(label: string, task: () => Promise<T>): Promise<T> {
		const started = performance.now();
		try {
			return await task();
		} finally {
			if (this.host.settings.mailDebugLog) console.debug(`AmberNyaDesk IMAP: ${label} took ${(performance.now() - started).toFixed(1)} ms.`);
		}
	}

	private async readCache<T>(path: string): Promise<T | null> {
		try {
			return JSON.parse(await this.host.app.vault.adapter.read(path)) as T;
		} catch {
			return null;
		}
	}

	private async writeCache(path: string, value: unknown) {
		const dir = path.split("/").slice(0, -1).join("/");
		await this.ensureDir(dir);
		await this.host.app.vault.adapter.write(path, JSON.stringify(value));
	}

	private async getFolderCache(a: ImapAccount, folder: string): Promise<ImapFolderCache> {
		const key = `${a.id}:${folder}`;
		const known = this.folders.get(key);
		if (known) return known;
		const loaded = (await this.readCache<ImapFolderCache>(this.cachePath(a, folder))) ?? {
			accountId: a.id,
			folder,
			uidValidity: 0,
			uidNext: 1,
			lastUid: 0,
			fetchedAt: 0,
			messages: [],
		};
		loaded.accountId = a.id;
		loaded.folder = folder;
		this.folders.set(key, loaded);
		return loaded;
	}

	private async saveFolderCache(cache: ImapFolderCache) {
		const a = this.account(cache.accountId);
		if (!a) return;
		await this.writeCache(this.cachePath(a, cache.folder), cache);
	}

	private account(id: string): ImapAccount | null {
		return this.host.settings.imapAccounts.find((a) => a.id === id) ?? null;
	}

	/** A synchronous snapshot when one has already been loaded this session. */
	cachedFolderInfos(accountId: string): ImapFolderInfo[] {
		return this.folderLists.get(accountId)?.folders ?? [];
	}

	private loadCachedFolderInfos(a: ImapAccount): ImapFolderInfo[] {
		return this.folderLists.get(a.id)?.folders ?? [];
	}

	async refreshFolderInfos(a: ImapAccount): Promise<ImapFolderInfo[]> {
		return this.time(`list folders ${imapLabel(a)}`, async () => {
			const client = await this.client(a);
			const list = await client.list();
			const folders: ImapFolderInfo[] = list.map((f: any) => {
				const path = String(f.path);
				return { path, name: String(f.name ?? path.split("/").pop() ?? path), specialUse: String(f.specialUse ?? "") };
			});
			const cache: ImapFolderListCache = { accountId: a.id, fetchedAt: Date.now(), folders };
			this.folderLists.set(a.id, cache);
			await this.writeCache(this.folderListPath(a), cache);
			return folders;
		});
	}

	async folderInfos(a: ImapAccount): Promise<ImapFolderInfo[]> {
		return this.loadCachedFolderInfos(a);
	}

	async syncFolder(a: ImapAccount, folder: string): Promise<ImapMessage[]> {
		return this.time(`sync ${imapLabel(a)} ${folder}`, async () => {
			const client = await this.client(a);
			const lock = await client.getMailboxLock(folder);
			try {
				const mailbox = client.mailbox;
				const uidValidity = Number(mailbox?.uidValidity ?? 0);
				const uidNext = Number(mailbox?.uidNext ?? 1);
				const exists = Number(mailbox?.exists ?? 0);
				const cache = await this.getFolderCache(a, folder);
				if (!cache.messages.length || cache.uidValidity !== uidValidity) {
					cache.messages = [];
					cache.lastUid = 0;
				}
				const have = new Set(cache.messages.map((m) => m.uid));
				let historyUids: number[] | null = null;
				const historyDays = Math.min(7300, Math.max(7, this.host.settings.mailHistoryDays || 45));
				try {
					const since = new Date(Date.now() - historyDays * 86400000);
					const found = await client.search({ since }, { uid: true });
					if (Array.isArray(found)) historyUids = found.map(Number);
				} catch {
					// A provider that refuses the date search still gets the
					// ordinary all-mail pass below.
				}
				let serverUids: number[] = [];
				if (exists) serverUids = ((await client.search({ all: true }, { uid: true })) ?? []).map(Number);
				else cache.messages = [];
				const history = historyUids ?? serverUids.slice(-1000);
				const wanted = cache.messages.length
					? [...new Set([...history.filter((uid) => !have.has(uid)), ...serverUids.filter((uid) => !have.has(uid) && uid >= cache.lastUid + 1)])]
					: history;
				const fetched: ImapMessage[] = [];
				if (wanted.length) {
					const chunks: number[][] = [];
					for (let i = 0; i < wanted.length; i += 200) chunks.push(wanted.slice(i, i + 200));
					for (const chunk of chunks)
						for await (const m of client.fetch(chunk.map(String).join(","), { envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true, uid: true }, { uid: true }))
							fetched.push(parseMessage(m));
				}
				const byUid = new Map(cache.messages.map((m) => [m.uid, m]));
				for (const m of fetched) byUid.set(m.uid, { ...byUid.get(m.uid), ...m });
				const onServer = new Set(serverUids);
				cache.messages = serverUids.length
					? [...byUid.values()].filter((m) => onServer.has(m.uid)).sort((x, y) => y.uid - x.uid)
					: [...byUid.values()].sort((x, y) => y.uid - x.uid);
				cache.uidValidity = uidValidity;
				cache.uidNext = uidNext;
				cache.lastUid = cache.messages[0]?.uid ?? uidNext - 1;
				cache.fetchedAt = Date.now();
				await this.saveFolderCache(cache);
				return cache.messages;
			} finally {
				lock.release();
			}
		});
	}

	messages(a: ImapAccount, folder: string): Promise<ImapMessage[]> {
		return this.getFolderCache(a, folder).then((c) => c.messages);
	}

	async unreadCount(a: ImapAccount, folder: string): Promise<number> {
		const c = await this.getFolderCache(a, folder);
		return c.messages.filter((m) => m.unread).length;
	}

	async body(a: ImapAccount, folder: string, uid: number): Promise<ImapBody> {
		return this.time(`body ${imapLabel(a)} ${folder} ${uid}`, async () => {
			const cached = await this.readCache<ImapBody>(this.bodyPath(a, folder, uid));
			if (cached) return cached;
			const out = await this.fetchBody(a, folder, uid);
			if (this.shouldCacheBody(a, folder)) {
				await this.writeCache(this.bodyPath(a, folder, uid), this.cacheableBody(out));
				const cache = await this.getFolderCache(a, folder);
				const m = cache.messages.find((x) => x.uid === uid);
				if (m) {
					this.patchMessageBody(m, out);
					await this.saveFolderCache(cache);
				}
			}
			return out;
		});
	}

	private bodyPath(a: ImapAccount, folder: string, uid: number): string {
		return `${this.baseDir()}/${this.safe(a.id)}/bodies/${this.safe(folder)}/${uid}.json`;
	}

	private bodyDir(a: ImapAccount, folder: string): string {
		return `${this.baseDir()}/${this.safe(a.id)}/bodies/${this.safe(folder)}`;
	}

	private cacheableBody(body: ImapBody): ImapBody {
		if (this.host.settings.mailCache?.attachmentPolicy === "none") return { ...body, attachments: undefined };
		if (!body.attachments?.some((a) => a.base64 !== undefined)) return body;
		return {
			...body,
			attachments: body.attachments.map(({ base64: _base64, ...meta }) => meta),
		};
	}

	private shouldCacheBody(a: ImapAccount, folder: string, info?: ImapFolderInfo): boolean {
		const known = info ?? this.folderLists.get(a.id)?.folders.find((f) => f.path === folder);
		return shouldCacheMailFolder(folder, a.id, known?.specialUse ?? "", this.host.settings.mailCache);
	}

	private patchMessageBody(m: ImapMessage, out: ImapBody) {
		m.bodyLoaded = true;
		m.snippet = out.text.slice(0, 160);
		if (out.attachments && !out.attachments.length) m.hasAttachment = false;
	}

	private async fetchBody(a: ImapAccount, folder: string, uid: number): Promise<ImapBody> {
		const { simpleParser } = await import("mailparser");
		const client = await this.client(a);
		const lock = await client.getMailboxLock(folder);
		try {
			const raw = await client.fetchOne(String(uid), { source: true }, { uid: true });
			const parsed = await simpleParser(raw?.source ?? Buffer.alloc(0));
			return {
				text: parsed.text ?? "",
				html: (parsed.html ?? undefined) as string | undefined,
				to: ((parsed.to as any)?.text ?? "") as string,
				cc: ((parsed.cc as any)?.text ?? "") as string,
				from: (parsed.from?.text ?? "") as string,
				subject: String(parsed.subject ?? ""),
				date: parsed.date ? new Date(parsed.date).toISOString() : "",
				messageId: String(parsed.messageId ?? ""),
				attachments: this.host.settings.mailCache?.attachmentPolicy === "none"
					? undefined
					: (parsed.attachments ?? []).map((att: any) => ({
							filename: String(att.filename ?? "attachment"),
							contentType: String(att.contentType ?? "application/octet-stream"),
							size: Number(att.size ?? 0),
							partId: att.partId ? String(att.partId) : undefined,
							contentId: att.contentId ? String(att.contentId) : undefined,
							base64: Buffer.from(att.content ?? Buffer.alloc(0)).toString("base64"),
						})),
			};
		} finally {
			lock.release();
		}
	}

	/** Bulk variant for the global cache pass: persists the body file and
	 *  patches in-memory metadata, so the folder JSON is written once per
	 *  folder instead of once per mail. */
	private async cacheBodyBulk(a: ImapAccount, folder: string, uid: number): Promise<void> {
		const cached = await this.readCache<ImapBody>(this.bodyPath(a, folder, uid));
		if (cached) return;
		const out = await this.fetchBody(a, folder, uid);
		if (!this.shouldCacheBody(a, folder)) return;
		await this.writeCache(this.bodyPath(a, folder, uid), this.cacheableBody(out));
		const cache = await this.getFolderCache(a, folder);
		const m = cache.messages.find((x) => x.uid === uid);
		if (m) this.patchMessageBody(m, out);
	}

	/** Cache every permitted message body of every folder of every account.
	 *  Lists are already cached; this makes opening mail instant and offline,
	 *  while spam and trash stay metadata-only by default. */
	async cacheAllMail(onProgress?: (label: string, done: number, total: number) => void): Promise<{ accounts: number; folders: number; bodies: number }> {
		let folderCount = 0;
		let bodies = 0;
		for (const a of this.host.settings.imapAccounts) {
			try {
				const infos = await this.refreshFolderInfos(a);
				for (const f of infos) {
					const msgs = await this.syncFolder(a, f.path);
					folderCount++;
					const todo = this.shouldCacheBody(a, f.path, f) ? msgs.filter((m) => !m.bodyLoaded) : [];
					let done = 0;
					for (const m of todo) {
						try {
							await this.cacheBodyBulk(a, f.path, m.uid);
							bodies++;
						} catch (e) {
							console.warn(`AmberNyaDesk: could not cache the body of ${f.path} uid ${m.uid} (${imapLabel(a)}).`, e);
						}
						done++;
						onProgress?.(`${imapLabel(a)} · ${f.name}`, done, todo.length);
					}
					if (todo.length) await this.saveFolderCache(await this.getFolderCache(a, f.path));
				}
			} catch (e) {
				console.warn(`AmberNyaDesk: global cache failed for ${imapLabel(a)}.`, e);
			}
		}
		return { accounts: this.host.settings.imapAccounts.length, folders: folderCount, bodies };
	}

	async markRead(a: ImapAccount, folder: string, uid: number, read: boolean): Promise<void> {
		return this.time(`flags ${imapLabel(a)}`, async () => {
			const client = await this.client(a);
			const lock = await client.getMailboxLock(folder);
			try {
				await (read ? client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }) : client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true }));
				await this.patchMessage(a, folder, uid, { unread: !read });
			} finally {
				lock.release();
			}
		});
	}

	/** Fetch attachment bytes again for a message whose body is cached without
	 *  payloads. This is the deliberate cost of keeping large files off disk. */
	async fetchAttachments(a: ImapAccount, folder: string, uid: number): Promise<SmtpAttachment[]> {
		const body = await this.fetchBody(a, folder, uid);
		return (body.attachments ?? [])
			.filter((att) => !!att.base64)
			.map((att) => ({ filename: att.filename, contentType: att.contentType, content: Buffer.from(att.base64 ?? "", "base64") }));
	}

	/** Folder metadata for management screens, preferring the local list so
	 *  cache cleanup also works while the mailbox is offline. */
	async folderInfosForManagement(a: ImapAccount): Promise<ImapFolderInfo[]> {
		const memory = this.folderLists.get(a.id)?.folders ?? [];
		if (memory.length) return memory;
		const disk = (await this.readCache<ImapFolderListCache>(this.folderListPath(a)))?.folders ?? [];
		if (disk.length) return disk;
		try {
			return await this.refreshFolderInfos(a);
		} catch {
			return [];
		}
	}

	private matchesCacheRefs(refs: MailCacheFolderRef[] | null, accountId: string, folder: string): boolean {
		return !refs?.length || refs.some((r) => r.accountId === accountId && r.folderId === folder);
	}

	async cacheStats(): Promise<MailCacheStats[]> {
		const out: MailCacheStats[] = [];
		for (const a of this.host.settings.imapAccounts) {
			for (const info of await this.folderInfosForManagement(a)) {
				const dir = this.bodyDir(a, info.path);
				try {
					if (!(await this.host.app.vault.adapter.exists(dir))) continue;
					const listing = await this.host.app.vault.adapter.list(dir);
					const files = listing.files.filter((path: string) => path.endsWith(".json"));
					let bytes = 0;
					for (const file of files) {
						try {
							bytes += (await this.host.app.vault.adapter.stat(file))?.size ?? 0;
						} catch {
							/* a file removed during the scan simply does not count */
						}
					}
					out.push({ accountId: a.id, accountLabel: imapLabel(a), folderId: info.path, folderName: info.name, bodyCount: files.length, bodyBytes: bytes });
				} catch {
					/* unreadable folders are skipped rather than breaking the modal */
				}
			}
		}
		return out;
	}

	async cleanBodies(refs: MailCacheFolderRef[]): Promise<number> {
		let removed = 0;
		for (const a of this.host.settings.imapAccounts) {
			for (const info of await this.folderInfosForManagement(a)) {
				if (!this.matchesCacheRefs(refs, a.id, info.path)) continue;
				const dir = this.bodyDir(a, info.path);
				try {
					if (!(await this.host.app.vault.adapter.exists(dir))) continue;
					await this.host.app.vault.adapter.rmdir(dir, true);
					removed++;
				} catch (e) {
					console.warn(`NyaHome: could not clean mail body cache for ${info.path} (${imapLabel(a)}).`, e);
				}
			}
		}
		return removed;
	}

	/** Keep the words, drop old attachment payloads already written by earlier
	 *  versions. This never touches a message on the server. */
	async stripCachedAttachmentData(refs: MailCacheFolderRef[]): Promise<number> {
		let stripped = 0;
		for (const a of this.host.settings.imapAccounts) {
			for (const info of await this.folderInfosForManagement(a)) {
				if (!this.matchesCacheRefs(refs, a.id, info.path)) continue;
				const dir = this.bodyDir(a, info.path);
				try {
					if (!(await this.host.app.vault.adapter.exists(dir))) continue;
					const listing = await this.host.app.vault.adapter.list(dir);
					for (const file of listing.files.filter((path: string) => path.endsWith(".json"))) {
						const parsed = await this.readCache<any>(file);
						if (!parsed?.attachments?.length || !parsed.attachments.some((att: any) => typeof att.base64 === "string")) continue;
						parsed.attachments = parsed.attachments.map(({ base64: _base64, ...meta }: any) => meta);
						await this.host.app.vault.adapter.write(file, JSON.stringify(parsed));
						stripped++;
					}
				} catch (e) {
					console.warn(`NyaHome: could not strip cached attachment data for ${info.path} (${imapLabel(a)}).`, e);
				}
			}
		}
		return stripped;
	}

	/** Remove body files whose UID no longer appears in that folder's list. */
	async cleanOrphanBodies(refs: MailCacheFolderRef[]): Promise<number> {
		let removed = 0;
		for (const a of this.host.settings.imapAccounts) {
			for (const info of await this.folderInfosForManagement(a)) {
				if (!this.matchesCacheRefs(refs, a.id, info.path)) continue;
				const dir = this.bodyDir(a, info.path);
				try {
					if (!(await this.host.app.vault.adapter.exists(dir))) continue;
					const cache = await this.readCache<ImapFolderCache>(this.cachePath(a, info.path));
					const live = new Set((cache?.messages ?? []).map((m) => `${m.uid}.json`));
					const listing = await this.host.app.vault.adapter.list(dir);
					for (const file of listing.files.filter((path: string) => path.endsWith(".json"))) {
						if (live.has(file.split("/").pop() ?? "")) continue;
						await this.host.app.vault.adapter.remove(file);
						removed++;
					}
				} catch (e) {
					console.warn(`NyaHome: could not clean orphan mail cache for ${info.path} (${imapLabel(a)}).`, e);
				}
			}
		}
		return removed;
	}

	/** Make sure the invoice mailbox exists, creating it on demand. */
	async ensureInvoiceFolder(a: ImapAccount): Promise<string> {
		const folders = await this.refreshFolderInfos(a);
		const found = folders.find((f) => f.name === INVOICE_FOLDER_NAME || f.path === INVOICE_FOLDER_NAME);
		if (found) return found.path;
		const client = await this.client(a);
		const created = await client.mailboxCreate(INVOICE_FOLDER_NAME);
		const path = String(created?.path ?? INVOICE_FOLDER_NAME);
		await this.refreshFolderInfos(a);
		return path;
	}

	/** Bulk header scan for one folder. It never pulls bodies and never acts
	 *  on its own: the view shows the lists and asks the user to confirm. */
	async scanFolder(a: ImapAccount, folder: string): Promise<FolderScan> {
		const cache = await this.getFolderCache(a, folder);
		if (!cache.messages.length) return { spam: [], invoices: [] };
		const client = await this.client(a);
		const lock = await client.getMailboxLock(folder);
		const hits: SpamHit[] = [];
		const invoices: TicketHit[] = [];
		try {
			const wanted = cache.messages.map((m) => m.uid);
			const chunks: number[][] = [];
			for (let i = 0; i < wanted.length; i += 200) chunks.push(wanted.slice(i, i + 200));
			const pending: Array<{ message: ImapMessage; headers: Record<string, string>; hint: string }> = [];
			for (const chunk of chunks) {
				for await (const raw of client.fetch(
					chunk.map(String).join(","),
					{
						uid: true,
						headers: [
							"X-Spam-Flag",
							"X-Spam-Status",
							"X-Spam-Score",
							"X-Spam-Level",
							"X-Spam",
							"X-Original-Spam-Flag",
							"X-Rspamd-Score",
							"Authentication-Results",
							"ARC-Authentication-Results",
							"Received-SPF",
							"List-Unsubscribe",
							"Precedence",
						],
					},
					{ uid: true }
				)) {
					const message = cache.messages.find((m) => m.uid === raw.uid);
					if (!message) continue;
					const headers = parseRawHeaders(raw.headers);
					const hint = message.snippet ?? "";
					const ticketReasons = invoiceReasons({
						subject: message.subject,
						from: message.from,
						snippet: hint,
					});
					if (ticketReasons.length) {
						invoices.push({ message, reasons: ticketReasons });
						continue;
					}
					pending.push({ message, headers, hint });
				}
			}

			// Headers above are cheap; body samples are fetched only after that
			// pass, so a folder scan still avoids attachments and unlimited MIME.
			const { simpleParser } = await import("mailparser");
			const bodyChunks: Array<typeof pending> = [];
			for (let i = 0; i < pending.length; i += 20) bodyChunks.push(pending.slice(i, i + 20));
			for (const bodyChunk of bodyChunks) {
				const samples = new Map<number, string>();
				for await (const raw of client.fetch(
					bodyChunk.map((item) => String(item.message.uid)).join(","),
					{ uid: true, source: { start: 0, maxLength: SPAM_BODY_SAMPLE_BYTES } },
					{ uid: true }
				)) {
					const source = raw.source;
					if (!source) continue;
					let text = "";
					try {
						const parsed = await simpleParser(source);
						text = String(parsed.text ?? "").trim();
						if (!text && parsed.html) text = plainTextForSpam(String(parsed.html));
					} catch {
						text = plainTextForSpam(source.toString("utf8"));
					}
					if (!text) text = plainTextForSpam(source.toString("utf8"));
					if (text) samples.set(Number(raw.uid), text);
				}
				for (const item of bodyChunk) {
					const body = samples.get(item.message.uid) ?? "";
					const ticketReasons = invoiceReasons({
						subject: item.message.subject,
						from: item.message.from,
						snippet: item.hint,
						body,
					});
					if (ticketReasons.length) {
						invoices.push({ message: item.message, reasons: ticketReasons });
						continue;
					}
					const verdict = scoreSpam({
						subject: item.message.subject,
						from: item.message.from,
						snippet: item.hint,
						body,
						headers: item.headers,
						blacklist: this.host.settings.imapSpamBlacklist ?? [],
						keywords: this.host.settings.imapSpamKeywords,
					});
					if (verdict.score >= SPAM_THRESHOLD) {
						hits.push({ message: item.message, score: verdict.score, reasons: verdict.reasons });
					}
				}
			}
		} finally {
			lock.release();
		}
		return {
			spam: hits.sort((x, y) => y.score - x.score || y.message.uid - x.message.uid),
			invoices,
		};
	}

	async setFlagged(a: ImapAccount, folder: string, uid: number, flagged: boolean): Promise<void> {
		return this.time(`flags ${imapLabel(a)}`, async () => {
			const client = await this.client(a);
			const lock = await client.getMailboxLock(folder);
			try {
				await (flagged ? client.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true }) : client.messageFlagsRemove(String(uid), ["\\Flagged"], { uid: true }));
				await this.patchMessage(a, folder, uid, { flagged });
			} finally {
				lock.release();
			}
		});
	}

	private async patchMessage(a: ImapAccount, folder: string, uid: number, patch: Partial<ImapMessage>) {
		const cache = await this.getFolderCache(a, folder);
		const m = cache.messages.find((x) => x.uid === uid);
		if (m) Object.assign(m, patch);
		await this.saveFolderCache(cache);
	}

	async move(a: ImapAccount, folder: string, destination: string, uids: number[]): Promise<void> {
		if (!uids.length || !destination || folder === destination) return;
		return this.time(`move ${imapLabel(a)} ${folder} -> ${destination}`, async () => {
			const client = await this.client(a);
			const lock = await client.getMailboxLock(folder);
			try {
				const moved: number[] = [];
				const missing: number[] = [];
				const failed: number[] = [];
				let verifySource = false;
				if ((await client.messageMove(uids.join(","), destination, { uid: true })) !== false) {
					moved.push(...uids);
				} else if ((await client.messageCopy(uids.join(","), destination, { uid: true })) !== false) {
					verifySource = true;
					await client.messageFlagsAdd(uids.join(","), ["\\Deleted"], { uid: true });
					if ((await client.messageDelete(uids.join(","), { uid: true })) === false) await client.mailboxClose();
					moved.push(...uids);
				} else {
					// A spam scan can be a little stale by the time the user
					// confirms it: one vanished UID used to fail the whole batch.
					// Move what is still live, and let the server say whether a
					// single stubborn mail is actually gone.
					for (const uid of uids) {
						if (!(await this.uidExists(client, uid))) {
							missing.push(uid);
							continue;
						}
						if (await this.moveOne(client, destination, uid)) {
							moved.push(uid);
							verifySource = true;
						}
						else failed.push(uid);
					}
				}
				if (verifySource) {
					const verified = await this.verifySourceGone(client, moved);
					if (verified.length) await this.removeMessages(a, folder, [...verified, ...missing]);
					if (verified.length !== moved.length) throw new Error("the server did not confirm that the source messages were removed");
				} else if (moved.length || missing.length) {
					await this.removeMessages(a, folder, [...moved, ...missing]);
				}
				if (failed.length) throw new Error(`the server refused to move ${failed.length} message${failed.length === 1 ? "" : "s"}`);
				// Keep the destination honest without making the click wait.
				if (destination !== folder) void this.syncFolder(a, destination).catch(() => {});
			} finally {
				lock.release();
			}
		});
	}

	private async uidExists(client: any, uid: number): Promise<boolean> {
		try {
			const found = await client.search({ uid }, { uid: true });
			return Array.isArray(found) ? found.includes(uid) : found !== false;
		} catch {
			// An inconclusive search must not silently treat live mail as gone.
			return true;
		}
	}

	/** Confirm the source UID is gone before touching the local cache. This is
	 *  deliberately used only for compatibility fallbacks; a provider can say
	 *  COPY succeeded while refusing the following EXPUNGE. */
	private async verifySourceGone(client: any, uids: number[]): Promise<number[]> {
		const gone: number[] = [];
		for (const uid of uids) {
			if (!(await this.uidExists(client, uid))) gone.push(uid);
		}
		return gone;
	}

	/** MOVE, then the older COPY + \Deleted + EXPUNGE path for providers that
	 *  reject MOVE on a particular mailbox or mid-sync. */
	private async moveOne(client: any, destination: string, uid: number): Promise<boolean> {
		const range = String(uid);
		if ((await client.messageMove(range, destination, { uid: true })) !== false) return true;
		if ((await client.messageCopy(range, destination, { uid: true })) === false) return false;
		try {
			await client.messageFlagsAdd(range, ["\\Deleted"], { uid: true });
			if ((await client.messageDelete(range, { uid: true })) === false) await client.mailboxClose();
		} catch (e) {
			// The copy already landed, so the move succeeded even if this
			// provider is slow to expunge the source copy.
			console.warn(`NyaHome: copied UID ${uid} but could not expunge it immediately.`, e);
		}
		return true;
	}

	async remove(a: ImapAccount, folder: string, uids: number[]): Promise<void> {
		if (!uids.length) return;
		return this.time(`delete ${imapLabel(a)} ${folder}`, async () => {
			const client = await this.client(a);
			const lock = await client.getMailboxLock(folder);
			try {
				let ok = await client.messageDelete(uids.join(","), { uid: true });
				if (ok === false) {
					// Shared connections occasionally draw a transient NO;
					// one retry clears it before reaching for the fallback.
					ok = await client.messageDelete(uids.join(","), { uid: true });
				}
				if (ok === false) {
					// Some servers only accept the older silent path: flag
					// \Deleted, then mailboxClose, which expunges without
					// the EXPUNGE command the server refuses.
					await client.messageFlagsAdd(uids.join(","), ["\\Deleted"], { uid: true });
					ok = await client.mailboxClose();
				}
				if (ok === false) throw new Error("the server refused the delete");
				const verified = await this.verifySourceGone(client, uids);
				await this.removeMessages(a, folder, verified);
				if (verified.length !== uids.length) throw new Error("the server did not confirm that the messages were removed");
			} finally {
				lock.release();
			}
		});
	}

	private async removeMessages(a: ImapAccount, folder: string, uids: number[]) {
		const cache = await this.getFolderCache(a, folder);
		const gone = new Set(uids);
		cache.messages = cache.messages.filter((m) => !gone.has(m.uid));
		await this.saveFolderCache(cache);
		for (const uid of uids) {
			try {
				const path = this.bodyPath(a, folder, uid);
				if (await this.host.app.vault.adapter.exists(path)) await this.host.app.vault.adapter.remove(path);
			} catch (e) {
				console.warn(`NyaHome: could not remove the cached body of ${folder} uid ${uid} (${imapLabel(a)}).`, e);
			}
		}
	}

	async send(a: ImapAccount, mail: SmtpMail): Promise<void> {
		return this.time(`smtp ${imapLabel(a)}`, () => sendImapMail(a, mail));
	}

	dispose() {
		for (const client of this.clients.values()) {
			client.logout?.().catch(() => client.close?.());
		}
		this.clients.clear();
		this.connecting.clear();
		this.folders.clear();
		this.folderLists.clear();
		this.folderListPending.clear();
	}
}
