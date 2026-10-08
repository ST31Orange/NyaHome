/**
 * NyaReaderInstaller：在 NyaHome 里"捎带安装"电子书阅读插件 NyaReader。
 *
 * 与 NyaLingoInstaller 同一套思路：从 GitHub 下载构建产物到
 * .obsidian/plugins/nyareader/，并登记进 community-plugins.json，重载后自动启用。
 * 网络失败时回退到 BRAT / 手动安装提示。
 */
import type { App } from "obsidian";

const NYAREADER_ID = "nyareader";
const NYAREADER_GH = "ST31Orange/nyareader";
const NYAREADER_BRANCH = "master";
const NYAREADER_FILES = ["main.js", "manifest.json", "styles.css", "versions.json", "pdf.worker.min.mjs"];
const NYAREADER_DIR = ".obsidian/plugins/nyareader";
const COMMUNITY_PLUGINS_FILE = ".obsidian/community-plugins.json";

export type InstallResult =
	| { status: "already-loaded" }
	| { status: "installed-needs-reload" }
	| { status: "enable-needed" }
	| { status: "failed"; reason: string };

export class NyaReaderInstaller {
	constructor(private app: App) {}

	/** 确保 NyaReader 已安装（未加载时尝试自动下载安装）。 */
	async ensureInstalled(isLoaded: boolean): Promise<InstallResult> {
		if (isLoaded) return { status: "already-loaded" };
		const adapter = this.app.vault.adapter;
		try {
			if (await adapter.exists(`${NYAREADER_DIR}/manifest.json`)) {
				return { status: "enable-needed" };
			}
			await this.downloadFiles();
			await this.enableInCommunityPlugins();
			return { status: "installed-needs-reload" };
		} catch (e) {
			return { status: "failed", reason: e instanceof Error ? e.message : String(e) };
		}
	}

	private async downloadFiles(): Promise<void> {
		const adapter = this.app.vault.adapter;
		await this.mkdirp(NYAREADER_DIR);
		for (const file of NYAREADER_FILES) {
			const url = `https://raw.githubusercontent.com/${NYAREADER_GH}/${NYAREADER_BRANCH}/${file}`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`下载 ${file} 失败（HTTP ${res.status}）`);
			const text = await res.text();
			if (file === "main.js" || file === "pdf.worker.min.mjs") {
				await adapter.writeBinary(NYAREADER_DIR + "/" + file, new TextEncoder().encode(text).buffer as ArrayBuffer);
			} else {
				await adapter.write(NYAREADER_DIR + "/" + file, text);
			}
		}
	}

	private async enableInCommunityPlugins(): Promise<void> {
		const adapter = this.app.vault.adapter;
		let list: string[] = [];
		try {
			if (await adapter.exists(COMMUNITY_PLUGINS_FILE)) {
				const parsed = JSON.parse(await adapter.read(COMMUNITY_PLUGINS_FILE));
				if (Array.isArray(parsed)) list = parsed.filter((x) => typeof x === "string");
			}
		} catch {
			list = [];
		}
		if (!list.includes(NYAREADER_ID)) list.push(NYAREADER_ID);
		await adapter.write(COMMUNITY_PLUGINS_FILE, JSON.stringify(list, null, "\t"));
	}

	private async mkdirp(dir: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const parts = dir.split("/").filter(Boolean);
		let cur = "";
		for (const part of parts) {
			cur = cur ? `${cur}/${part}` : part;
			try {
				if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
			} catch {
				/* 忽略已存在等冲突 */
			}
		}
	}
}