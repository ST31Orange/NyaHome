// Copies the built plugin into every Obsidian vault on this machine.
// Vaults are discovered from Obsidian's own registry file, so this works
// unchanged on Windows, macOS, and Linux. Run via: npm run deploy
//
// Refuses to write over a vault that already holds a NEWER version than the one
// being deployed. Two sessions building the same plugin at once is enough for
// the second to overwrite the first's work with an older build, and a copy that
// silently wins gives no sign it happened: the vault simply loses a feature
// that was, by every other measure, finished and shipped. Pass --force to
// deploy anyway, which is what a deliberate rollback wants.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import process from "process";
import { isDowngrade, versionFromManifest } from "./deploy-guard.mjs";

/** The version a vault currently holds, or null when nothing is installed. */
function installedVersion(manifestPath) {
	if (!existsSync(manifestPath)) return null;
	try {
		return versionFromManifest(readFileSync(manifestPath, "utf8"));
	} catch {
		return null;
	}
}

const force = process.argv.includes("--force");

const candidates = [
	process.env.APPDATA ? join(process.env.APPDATA, "obsidian", "obsidian.json") : null,
	join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json"),
	join(homedir(), ".config", "obsidian", "obsidian.json"),
].filter(Boolean);

const registry = candidates.find((p) => existsSync(p));
if (!registry) {
	console.error("No Obsidian vault registry found (is Obsidian installed and has it been opened once?)");
	process.exit(1);
}

const vaults = Object.values(JSON.parse(readFileSync(registry, "utf8")).vaults ?? {}).map((v) => v.path);
if (!vaults.length) {
	console.error("Obsidian registry has no vaults.");
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pluginId = manifest.id || "nyahome";
const version = manifest.version;
const files = ["manifest.json", "main.js", "styles.css", "README.md"];
let deployed = 0;
let blocked = 0;
for (const vault of vaults) {
	if (!existsSync(join(vault, ".obsidian"))) {
		console.log("skip (no .obsidian):", vault);
		continue;
	}
	const dest = join(vault, ".obsidian", "plugins", pluginId);
	const installed = installedVersion(join(dest, "manifest.json"));
	const back = isDowngrade(installed, version);
	if (back && !force) {
		console.error(`BLOCKED: ${dest}`);
		console.error(`         already has ${installed}, newer than the ${version} being deployed.`);
		console.error("         Another session likely built something this one does not have.");
		console.error("         Rebuild from the newer source, or pass --force to overwrite it deliberately.");
		blocked++;
		continue;
	}
	if (back) console.log(`forced back over ${installed} ->`, dest);
	mkdirSync(dest, { recursive: true });
	for (const f of files) copyFileSync(f, join(dest, f));
	// one-time rename migration: carry the prior install's settings, caches and
	// IMAP shards into NyaHome so the new plugin id does not lose local data
	const legacy = join(vault, ".obsidian", "plugins", "ambernyadesk");
	const newData = join(dest, "data.json");
	if (!existsSync(newData) && existsSync(join(legacy, "data.json"))) {
		copyFileSync(join(legacy, "data.json"), newData);
		console.log("migrated settings from ambernyadesk ->", newData);
	}
	const newCache = join(dest, "cache.json");
	if (!existsSync(newCache) && existsSync(join(legacy, "cache.json"))) {
		copyFileSync(join(legacy, "cache.json"), newCache);
		console.log("migrated fetch cache from ambernyadesk ->", newCache);
	}
	const legacyImapCache = join(legacy, "imap-cache");
	const newImapCache = join(dest, "imap-cache");
	if (!existsSync(newImapCache) && existsSync(legacyImapCache)) {
		cpSync(legacyImapCache, newImapCache, { recursive: true });
		console.log("migrated IMAP cache from ambernyadesk ->", newImapCache);
	}
	console.log("deployed ->", dest);
	deployed++;
}
console.log(deployed ? `Done. Reload Obsidian (Ctrl+R), then enable "NyaHome". The old ambernyadesk plugin can be disabled after you verify NyaHome.` : "Nothing deployed.");
// a blocked vault has to fail the command: the point is that it stops being
// something you have to notice in the scrollback
if (blocked) process.exit(1);
