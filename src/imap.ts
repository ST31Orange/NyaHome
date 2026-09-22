/* IMAP + SMTP adapter for standard mailbox providers (QQ, 163, school mail),
 * on top of the ImapFlow / Nodemailer stack. The libraries are imported
 * lazily so mobile — where Node APIs do not exist — never touches them.
 * V1: connect, list folders, read a folder's recent messages, mark read,
 * search subjects, and send/reply over SMTP. */

import { decryptSecret } from "./secret";

export interface ImapAccount {
	id: string;
	label: string;
	imapHost: string;
	imapPort: number;
	secure: boolean;
	user: string;
	password: string;
	smtpHost: string;
	smtpPort: number;
}

export interface ImapFolderInfo {
	path: string;
	name: string;
	specialUse: string;
}

export interface ImapMessage {
	uid: number;
	subject: string;
	from: string;
	to: string;
	cc: string;
	date: string;
	unread: boolean;
	flagged: boolean;
	hasAttachment: boolean;
	messageId: string;
	replyTo: string;
	snippet?: string;
	bodyLoaded?: boolean;
	size?: number;
}

async function libs(): Promise<{ ImapFlow: any; nodemailer: any; simpleParser: any }> {
	const [{ ImapFlow }, nodemailer, { simpleParser }] = await Promise.all([
		import("imapflow"),
		import("nodemailer"),
		import("mailparser"),
	]);
	return { ImapFlow, nodemailer, simpleParser };
}

async function connect(a: ImapAccount): Promise<any> {
	const { ImapFlow } = await libs();
	const client = new ImapFlow({
		host: a.imapHost,
		port: a.imapPort,
		secure: a.secure,
		auth: { user: a.user, pass: decryptSecret(a.password) },
		logger: false,
	});
	await client.connect();
	return client;
}

function sender(env: any): string {
	return env?.from?.[0]?.name ? `${env.from[0].name} <${env.from[0].address ?? ""}>` : String(env?.from?.[0]?.address ?? "");
}

function recipientList(value: any): string {
	if (!value) return "";
	const rows = Array.isArray(value) ? value : [value];
	return rows.map((x: any) => (x?.text ? String(x.text) : x?.address ? String(x.address) : "")).filter(Boolean).join(", ");
}

export function parseMessage(m: any): ImapMessage {
	const env = m.envelope ?? {};
	return {
		uid: Number(m.uid),
		subject: String(env.subject ?? "(no subject)"),
		from: sender(env),
		to: recipientList(env.to),
		cc: recipientList(env.cc),
		date: env.date ? new Date(env.date).toISOString() : "",
		unread: !m.flags?.has("\\Seen"),
		flagged: !!m.flags?.has("\\Flagged"),
		hasAttachment: bodyHasAttachment(m.bodyStructure),
		messageId: String(env.messageId ?? ""),
		replyTo: recipientList(env.replyTo),
		snippet: typeof m.snippet === "string" ? m.snippet : undefined,
		bodyLoaded: false,
		size: Number(m.size ?? 0) || undefined,
	};
}

/** A provider often wants the bare address for LOGIN even when the user
 *  typed a label; the address itself is what we store. */
export function imapLabel(a: ImapAccount): string {
	return a.label.trim() || a.user;
}

export async function testImapAccount(a: ImapAccount): Promise<{ ok: boolean; folders: string[]; error?: string }> {
	let client: any = null;
	try {
		client = await connect(a);
		const list = await client.list();
		return { ok: true, folders: list.map((f: any) => String(f.path)) };
	} catch (e) {
		return { ok: false, folders: [], error: e instanceof Error ? e.message : String(e) };
	} finally {
		if (client) client.logout().catch(() => {});
	}
}

export async function listImapFolders(a: ImapAccount): Promise<string[]> {
	let client: any = null;
	try {
		client = await connect(a);
		const list = await client.list();
		return list.map((f: any) => String(f.path));
	} finally {
		if (client) client.logout().catch(() => {});
	}
}

/** Folder paths plus IMAP SPECIAL-USE metadata, used to find the trash and
 *  to sort the standard folders to the top of the account tree. */
export async function listImapFolderInfos(a: ImapAccount): Promise<ImapFolderInfo[]> {
	let client: any = null;
	try {
		client = await connect(a);
		const list = await client.list();
		return list.map((f: any) => {
			const path = String(f.path);
			return { path, name: path.split("/").pop() ?? path, specialUse: String(f.specialUse ?? "") };
		});
	} finally {
		if (client) client.logout().catch(() => {});
	}
}

/** The mailbox that should receive deleted messages. SPECIAL-USE wins; the
 *  common localized names are the fallback for providers without the flag. */
export function trashFolderFor(folders: ImapFolderInfo[]): string {
	const direct = folders.find((f) => f.specialUse.toLowerCase().includes("trash"));
	if (direct) return direct.path;
	const named = folders.find((f) => /^(trash|deleted|deleted messages|已删除|回收站)$/i.test(f.name));
	return named?.path ?? "";
}

/** The newest messages of one folder, newest first. */
export async function fetchImapMessages(a: ImapAccount, folder: string, limit = 50): Promise<ImapMessage[]> {
	const client = await connect(a);
	try {
		const lock = await client.getMailboxLock(folder);
		try {
			const mailbox = client.mailbox;
			const total = Number(mailbox?.exists ?? 0);
			if (!total) return [];
			const out: ImapMessage[] = [];
			const from = Math.max(1, total - limit + 1);
			for await (const msg of client.fetch(`${from}:${total}`, { envelope: true, flags: true, bodyStructure: true, uid: true }, { uid: false }))
				out.push(parseMessage(msg));
			return out.reverse();
		} finally {
			lock.release();
		}
	} finally {
		client.logout().catch(() => {});
	}
}

export function bodyHasAttachment(struct: any): boolean {
	if (!struct) return false;
	if (Array.isArray(struct)) return struct.some(bodyHasAttachment);
	if (struct.childNodes) return bodyHasAttachment(struct.childNodes);
	const disp = String(struct.disposition ?? "").toLowerCase();
	if (disp === "attachment") return true;
	if (struct.childNodes) return bodyHasAttachment(struct.childNodes);
	return false;
}

/** One message's parsed body: text for the list, html when the sender sent it. */
export async function fetchImapBody(a: ImapAccount, folder: string, uid: number): Promise<ImapBody> {
	const { simpleParser } = await libs();
	const client = await connect(a);
	try {
		const lock = await client.getMailboxLock(folder);
		try {
			const raw = client.fetchOne ? await client.fetchOne(uid, { source: true }, { uid: true }) : await client.fetch(String(uid), { source: true }, { uid: true });
			const parsed = await simpleParser(raw?.source ?? Buffer.alloc(0));
			return {
				text: parsed.text ?? "",
				html: parsed.html ?? undefined,
				to: (parsed.to?.text ?? "") as string,
				cc: (parsed.cc?.text ?? "") as string,
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
	} finally {
		client.logout().catch(() => {});
	}
}

export async function markImapRead(a: ImapAccount, folder: string, uid: number, read: boolean): Promise<void> {
	const client = await connect(a);
	try {
		const lock = await client.getMailboxLock(folder);
		try {
			await (read ? client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }) : client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true }));
		} finally {
			lock.release();
		}
	} finally {
		client.logout().catch(() => {});
	}
}

export async function searchImapSubjects(a: ImapAccount, folder: string, query: string): Promise<ImapMessage[]> {
	const client = await connect(a);
	try {
		const lock = await client.getMailboxLock(folder);
		try {
			const uids = await client.search({ header: { subject: query } }, { uid: true });
			const recent = (uids ?? []).slice(-30);
			const out: ImapMessage[] = [];
			for await (const msg of client.fetch(recent.map(String).join(","), { envelope: true, flags: true }, { uid: true }))
				out.push({ ...parseMessage(msg), hasAttachment: false });
			return out.reverse();
		} finally {
			lock.release();
		}
	} finally {
		client.logout().catch(() => {});
	}
}

/** Send through the account's SMTP server. QQ/163/school mail all want the
 *  authorization code as the password, which is what the settings store. */
export async function sendImapMail(a: ImapAccount, mail: SmtpMail): Promise<void> {
	const { nodemailer } = await libs();
	const transport = nodemailer.createTransport({
		host: a.smtpHost,
		port: a.smtpPort,
		secure: a.smtpPort === 465,
		auth: { user: a.user, pass: decryptSecret(a.password) },
	});
	try {
		await transport.sendMail({
			from: a.user,
			to: mail.to,
			cc: mail.cc,
			bcc: mail.bcc,
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
			inReplyTo: mail.inReplyTo,
			references: mail.inReplyTo ? [mail.inReplyTo] : undefined,
			attachments: mail.attachments,
		});
	} finally {
		transport.close();
	}
}

export interface SmtpMail {
	to: string;
	cc?: string;
	bcc?: string;
	subject: string;
	text: string;
	html?: string;
	inReplyTo?: string;
	attachments?: SmtpAttachment[];
}

export interface SmtpAttachment {
	filename: string;
	contentType?: string;
	content: Buffer;
}

export interface ImapAttachment {
	filename: string;
	contentType: string;
	size: number;
	/** MIME part id, kept so a cached message can still fetch one file later. */
	partId?: string;
	contentId?: string;
	/** Present only on a freshly parsed message. The disk cache strips it. */
	base64?: string;
}

/** Move one or more UIDs. Callers resolve the trash; this adapter only
 *  performs the move so the decision stays visible at the UI layer. */
export async function moveImapMessages(a: ImapAccount, folder: string, destination: string, uids: number[]): Promise<void> {
	if (!uids.length || !destination) return;
	const client = await connect(a);
	try {
		const lock = await client.getMailboxLock(folder);
		try {
			const ok = await client.messageMove(uids.join(","), destination, { uid: true });
			if (ok === false) throw new Error("the server refused the move");
		} finally {
			lock.release();
		}
	} finally {
		client.logout().catch(() => {});
	}
}

/** The server-side delete. This is deliberately separate from moving to
 *  trash, so a folder already in the trash can offer true deletion without
 *  accidentally deleting messages outside it. */
export async function permanentlyDeleteImapMessages(a: ImapAccount, folder: string, uids: number[]): Promise<void> {
	if (!uids.length) return;
	const client = await connect(a);
	try {
		const lock = await client.getMailboxLock(folder);
		try {
			const ok = await client.messageDelete(uids.join(","), { uid: true });
			if (ok === false) throw new Error("the server refused the delete");
		} finally {
			lock.release();
		}
	} finally {
		client.logout().catch(() => {});
	}
}

export async function setImapFlagged(a: ImapAccount, folder: string, uid: number, flagged: boolean): Promise<void> {
	const client = await connect(a);
	try {
		const lock = await client.getMailboxLock(folder);
		try {
			await (flagged ? client.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true }) : client.messageFlagsRemove(String(uid), ["\\Flagged"], { uid: true }));
		} finally {
			lock.release();
		}
	} finally {
		client.logout().catch(() => {});
	}
}

/** Search subject, sender and full text in one server round-trip. Some
 *  providers do not index every body word, so this is a practical search,
 *  not a guarantee that every attachment's hidden text is reachable. */
export async function searchImapMessages(a: ImapAccount, folder: string, query: string, limit = 100): Promise<ImapMessage[]> {
	const q = query.trim();
	const client = await connect(a);
	try {
		const lock = await client.getMailboxLock(folder);
		try {
			const uids = (await client.search({ or: [{ subject: q }, { from: q }, { text: q }] }, { uid: true })) ?? [];
			const recent = uids.slice(-limit);
			if (!recent.length) return [];
			const out: ImapMessage[] = [];
			for await (const m of client.fetch(recent.map(String).join(","), { envelope: true, flags: true, bodyStructure: true, uid: true }, { uid: true }))
				out.push(parseMessage(m));
			return out.reverse();
		} finally {
			lock.release();
		}
	} finally {
		client.logout().catch(() => {});
	}
}

export interface ImapBody {
	text: string;
	html?: string;
	to: string;
	cc: string;
	from: string;
	subject: string;
	date: string;
	messageId: string;
	attachments?: ImapAttachment[];
}
