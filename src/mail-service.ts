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
	SmtpMail,
} from "./imap";
import { decryptSecret } from "./secret";

interface ImapHost {
	app: App;
	settings: { imapAccounts: ImapAccount[]; mailDebugLog: boolean };
	manifest: { id: string };
}

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
				id: `ambernyadesk:${a.id}`,
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
				let serverUids: number[] = [];
				if (exists) serverUids = ((await client.search({ all: true }, { uid: true })) ?? []).map(Number);
				else cache.messages = [];
				const wanted = cache.messages.length
					? serverUids.filter((uid) => !have.has(uid) && uid >= cache.lastUid + 1)
					: serverUids.slice(-1000);
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
			await this.writeCache(this.bodyPath(a, folder, uid), out);
			const cache = await this.getFolderCache(a, folder);
			const m = cache.messages.find((x) => x.uid === uid);
			if (m) {
				this.patchMessageBody(m, out);
				await this.saveFolderCache(cache);
			}
			return out;
		});
	}

	private bodyPath(a: ImapAccount, folder: string, uid: number): string {
		return `${this.baseDir()}/${this.safe(a.id)}/bodies/${this.safe(folder)}/${uid}.json`;
	}

	private patchMessageBody(m: ImapMessage, out: ImapBody) {
		m.bodyLoaded = true;
		m.snippet = out.text.slice(0, 160);
		if (!out.attachments?.length) m.hasAttachment = false;
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
				attachments: (parsed.attachments ?? []).map((att: any) => ({
					filename: String(att.filename ?? "attachment"),
					contentType: String(att.contentType ?? "application/octet-stream"),
					size: Number(att.size ?? 0),
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
		await this.writeCache(this.bodyPath(a, folder, uid), out);
		const cache = await this.getFolderCache(a, folder);
		const m = cache.messages.find((x) => x.uid === uid);
		if (m) this.patchMessageBody(m, out);
	}

	/** Cache every message body of every folder of every account. Lists were
	 *  already cached; this is what makes opening a mail instant and offline. */
	async cacheAllMail(onProgress?: (label: string, done: number, total: number) => void): Promise<{ accounts: number; folders: number; bodies: number }> {
		let folderCount = 0;
		let bodies = 0;
		for (const a of this.host.settings.imapAccounts) {
			try {
				const infos = await this.refreshFolderInfos(a);
				for (const f of infos) {
					const msgs = await this.syncFolder(a, f.path);
					folderCount++;
					const todo = msgs.filter((m) => !m.bodyLoaded);
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
				if (client.capabilities?.has?.("MOVE")) {
					const ok = await client.messageMove(uids.join(","), destination, { uid: true });
					if (ok === false) throw new Error("the server refused the move");
				} else {
					const ok = await client.messageCopy(uids.join(","), destination, { uid: true });
					if (ok === false) throw new Error("the server refused the copy");
					await client.messageFlagsAdd(uids.join(","), ["\\Deleted"], { uid: true });
					await client.messageDelete(uids.join(","), { uid: true });
				}
				await this.removeMessages(a, folder, uids);
				// Keep the destination honest without making the click wait.
				if (destination !== folder) void this.syncFolder(a, destination).catch(() => {});
			} finally {
				lock.release();
			}
		});
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
				await this.removeMessages(a, folder, uids);
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
