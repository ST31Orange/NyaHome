import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const PREFIX = "enc:v1:";

let loadedKey: Buffer | null = null;

/** The key never lives in the vault: data.json syncs to other machines, and
 *  a synced copy must not carry both the ciphertext and the key that opens
 *  it. It stays in the user's home folder instead. */
function loadKey(): Buffer {
	if (loadedKey) return loadedKey;
	const p = join(homedir(), ".ambernyadesk", "secret.key");
	try {
		if (existsSync(p)) {
			const key = readFileSync(p);
			if (key.length === 32) {
				loadedKey = key;
				return key;
			}
		}
	} catch {
		/* unreadable or empty: fall through and write a fresh key */
	}
	const key = randomBytes(32);
	mkdirSync(join(homedir(), ".ambernyadesk"), { recursive: true });
	writeFileSync(p, key);
	try {
		chmodSync(p, 0o600);
	} catch {
		/* Windows needs no chmod */
	}
	loadedKey = key;
	return key;
}

export function secretIsEncrypted(value: string): boolean {
	return value.startsWith(PREFIX);
}

/** AES-256-GCM with a per-installation random key. Only fails closed if
 *  even the key file cannot be written, in which case the old plaintext
 *  behavior is kept rather than losing the account. */
export function encryptSecret(plain: string): string {
	if (!plain || secretIsEncrypted(plain)) return plain;
	try {
		const key = loadKey();
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
		return PREFIX + Buffer.concat([iv, body]).toString("base64");
	} catch {
		return plain;
	}
}

/** Returns "" when the ciphertext cannot be opened here: a synced vault on
 *  a new machine has no key file yet, and the honest answer is to ask the
 *  user to re-enter the authorization code, not to send garbage upstream. */
export function decryptSecret(stored: string): string {
	if (!stored || !secretIsEncrypted(stored)) return stored;
	try {
		const key = loadKey();
		const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
		const iv = raw.subarray(0, 12);
		const tag = raw.subarray(raw.length - 16);
		const data = raw.subarray(12, raw.length - 16);
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
	} catch {
		console.warn("AmberNyaDesk: could not decrypt a stored credential; re-enter the authorization code in settings.");
		return "";
	}
}
