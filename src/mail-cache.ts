/** Local mail body cache policy. Attachments are intentionally not part of
 *  this cache: only their metadata survives, so a mailbox full of large files
 *  cannot quietly fill the vault. */
export type MailCacheFolderMode = "all" | "exclude" | "selected";
export type MailCacheAttachmentPolicy = "metadata" | "none";

export interface MailCacheFolderRef {
	accountId: string;
	folderId: string;
	name?: string;
}

export interface MailCacheStats {
	accountId: string;
	accountLabel: string;
	folderId: string;
	folderName: string;
	bodyCount: number;
	bodyBytes: number;
}

export interface MailCacheSettings {
	enabled: boolean;
	folderMode: MailCacheFolderMode;
	folders: MailCacheFolderRef[];
	skipSpamAndTrash: boolean;
	attachmentPolicy: MailCacheAttachmentPolicy;
}

export const DEFAULT_MAIL_CACHE_SETTINGS: MailCacheSettings = {
	enabled: true,
	folderMode: "all",
	folders: [],
	skipSpamAndTrash: true,
	attachmentPolicy: "metadata",
};

export function normalizeMailCache(raw: unknown): MailCacheSettings {
	const value = (raw ?? {}) as Partial<MailCacheSettings>;
	const folders = Array.isArray(value.folders)
		? value.folders
				.filter((f): f is MailCacheFolderRef => !!f && typeof f === "object" && typeof f.accountId === "string" && typeof f.folderId === "string")
				.map((f) => ({ accountId: f.accountId, folderId: f.folderId, name: typeof f.name === "string" ? f.name : undefined }))
		: [];
	return {
		enabled: value.enabled !== false,
		folderMode: value.folderMode === "exclude" || value.folderMode === "selected" ? value.folderMode : "all",
		folders,
		skipSpamAndTrash: value.skipSpamAndTrash !== false,
		attachmentPolicy: value.attachmentPolicy === "none" ? "none" : "metadata",
	};
}

export function sameCacheFolder(left: MailCacheFolderRef, right: MailCacheFolderRef): boolean {
	return left.accountId === right.accountId && left.folderId === right.folderId;
}

export function isJunkOrTrashFolder(path: string, specialUse = ""): boolean {
	const use = specialUse.toLowerCase();
	const name = path.split("/").pop() ?? path;
	if (use.includes("junk") || use.includes("trash")) return true;
	return /^(junk|junk email|junk e-mail|junk mail|spam|垃圾邮件|trash|deleted|deleted messages|deleted items|已删除|回收站)$/i.test(name);
}

export function shouldCacheMailFolder(
	folderId: string,
	accountId: string,
	specialUse: string,
	settings: MailCacheSettings | undefined
): boolean {
	if (!settings?.enabled) return false;
	if (settings.skipSpamAndTrash && isJunkOrTrashFolder(folderId, specialUse)) return false;
	const ref = { accountId, folderId };
	const chosen = settings.folders.some((f) => sameCacheFolder(f, ref));
	return settings.folderMode === "exclude" ? !chosen : settings.folderMode === "selected" ? chosen : true;
}
