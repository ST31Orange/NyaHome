/**
 * NyaLingoInstaller：在 NyaHome 里"捎带安装"共享翻译插件 NyaLingo。
 *
 * 与 NyaReader 同一套思路：从 GitHub 下载 NyaLingo 构建产物到
 * .obsidian/plugins/nyalingo/，并登记进 community-plugins.json，重载后自动启用。
 * 网络失败时回退到手动安装提示。
 */
import type { App } from "obsidian";

const NYALINGO_ID = "nyalingo";
const NYALINGO_GH = "ST31Orange/nyalingo";
const NYALINGO_BRANCH = "master";
const NYALINGO_FILES = ["main.js", "manifest.json", "styles.css", "versions.json"];
const NYALINGO_DIR = ".obsidian/plugins/nyalingo";
const COMMUNITY_PLUGINS_FILE = ".obsidian/community-plugins.json";

export type InstallResult =
	| { status: "already-loaded" }
	| { status: "installed-needs-reload" }
	| { status: "enable-needed" }
	| { status: "failed"; reason: string };

export class NyaLingoInstaller {
	constructor(private app: App) {}

	/** 确保 NyaLingo 已安装（未加载时尝试自动下载安装）。 */
	async ensureInstalled(isLoaded: boolean): Promise<InstallResult> {
		if (isLoaded) return { status: "already-loaded" };
		const adapter = this.app.vault.adapter;
		try {
			if (await adapter.exists(`${NYALINGO_DIR}/manifest.json`)) {
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
		await this.mkdirp(NYALINGO_DIR);
		for (const file of NYALINGO_FILES) {
			const url = `https://raw.githubusercontent.com/${NYALINGO_GH}/${NYALINGO_BRANCH}/${file}`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`下载 ${file} 失败（HTTP ${res.status}）`);
			const text = await res.text();
			if (file === "main.js") {
				await adapter.writeBinary(NYALINGO_DIR + "/" + file, new TextEncoder().encode(text).buffer as ArrayBuffer);
			} else {
				await adapter.write(NYALINGO_DIR + "/" + file, text);
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
		if (!list.includes(NYALINGO_ID)) list.push(NYALINGO_ID);
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