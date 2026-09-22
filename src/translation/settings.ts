import { App, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionRender } from "obsidian";
import { TranslationManager } from "./manager";

type TranslationSettingRow = {
	name: string;
	desc?: string;
	aliases?: string[];
	build: (setting: Setting) => unknown;
};

/** Independent Obsidian settings tab. It depends on the manager, not on the
 *  plugin class, so translation configuration cannot reach into mail data. */
export class TranslationSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly manager: TranslationManager,
		private readonly host: { manifest: { id: string } }
	) {
		super(app, host as unknown as Plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Translation" });
		for (const row of this.rows()) {
			const setting = new Setting(containerEl).setName(row.name);
			if (row.desc) setting.setDesc(row.desc);
			row.build(setting);
		}
	}

	/** Obsidian 1.13 renders tabs declaratively and does not call display().
	 *  Exposing the same rows through definitions keeps both render paths equal. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "Translation",
				items: this.rows().map(
					(row): SettingDefinitionRender => ({
						name: row.name,
						desc: row.desc,
						aliases: row.aliases,
						render: (setting) => {
							row.build(setting);
						},
					})
				),
			},
		];
	}

	/** Host tabs can embed the same rows without creating a second, ambiguously
	 *  named sidebar entry. The build callback is normalized to return void. */
	buildRows(): { name: string; desc?: string; aliases?: string[]; build: (setting: Setting) => void }[] {
		return this.rows().map((row) => ({
			name: row.name,
			desc: row.desc,
			aliases: row.aliases,
			build: (setting: Setting) => {
				row.build(setting);
			},
		}));
	}

	private rows(): TranslationSettingRow[] {
		const config = this.manager.getConfig();
		return [
			{
				name: "Enable translation",
				desc: "Adds mail translation and enables the local MTranServer back end. Disabling it leaves mail behavior untouched.",
				aliases: ["translation", "mtran", "translate"],
				build: (setting) => setting.addToggle((toggle) => toggle.setValue(config.enabled).onChange(async (value) => this.save({ enabled: value }))),
			},
			{
				name: "MTranServer address",
				desc: "Base URL, for example http://127.0.0.1:8989. /translate is added automatically.",
				aliases: ["endpoint", "server", "url"],
				build: (setting) =>
					setting.addText((text) =>
						text.setPlaceholder("http://127.0.0.1:8989").setValue(config.endpoint).onChange(async (value) => this.save({ endpoint: value.trim() }))
					),
			},
			{
				name: "API token",
				desc: "Optional bearer token. Leave empty if your local server does not require one.",
				aliases: ["token", "password", "auth"],
				build: (setting) =>
					setting.addText((text) => {
						text.inputEl.type = "password";
						text.setValue(config.token).onChange(async (value) => this.save({ token: value.trim() }));
					}),
			},
			{
				name: "Source language",
				aliases: ["from", "language"],
				build: (setting) =>
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions({ en: "English", auto: "Auto (if supported)" })
							.setValue(config.sourceLanguage)
							.onChange(async (value) => this.save({ sourceLanguage: value }))
					),
			},
			{
				name: "Target language",
				aliases: ["to", "language"],
				build: (setting) =>
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions({ "zh-Hans": "简体中文", "zh-Hant": "繁體中文", en: "English", ja: "日本語" })
							.setValue(config.targetLanguage)
							.onChange(async (value) => this.save({ targetLanguage: value }))
					),
			},
			{
				name: "Translate subject",
				aliases: ["subject", "title"],
				build: (setting) => setting.addToggle((toggle) => toggle.setValue(config.translateSubject).onChange(async (value) => this.save({ translateSubject: value }))),
			},
			{
				name: "Translate body",
				desc: "HTML bodies are sent with html: true so markup can be preserved where the server supports it.",
				aliases: ["body", "html"],
				build: (setting) => setting.addToggle((toggle) => toggle.setValue(config.translateBody).onChange(async (value) => this.save({ translateBody: value }))),
			},
			{
				name: "Automatically translate opened mail",
				desc: "Runs in the background after a message is selected and parsed. It never changes the original message.",
				aliases: ["automatic", "auto translate"],
				build: (setting) => setting.addToggle((toggle) => toggle.setValue(config.autoTranslate).onChange(async (value) => this.save({ autoTranslate: value }))),
			},
			{
				name: "Cache translations",
				desc: "Avoids repeated requests for the same subject or body.",
				aliases: ["cache"],
				build: (setting) => setting.addToggle((toggle) => toggle.setValue(config.cacheEnabled).onChange(async (value) => this.save({ cacheEnabled: value }))),
			},
			{
				name: "Persist translation cache",
				desc: "Keeps translated text in a plugin cache file, separate from data.json.",
				aliases: ["persist", "cache file"],
				build: (setting) => setting.addToggle((toggle) => toggle.setValue(config.persistentCache).onChange(async (value) => this.save({ persistentCache: value }))),
			},
			{
				name: "Request timeout",
				desc: `${config.timeoutMs} ms`,
				aliases: ["timeout"],
				build: (setting) =>
					setting.addSlider((slider) =>
						slider
							.setLimits(1000, 60000, 1000)
							.setValue(config.timeoutMs)
							.setDynamicTooltip()
							.onChange(async (value) => this.save({ timeoutMs: value }))
					),
			},
			{
				name: "Test server",
				desc: "Sends a short request to verify the endpoint and token.",
				aliases: ["test", "health check"],
				build: (setting) =>
					setting.addButton((button) =>
						button.setButtonText("Test").setCta().onClick(async () => {
							button.setDisabled(true);
							button.setButtonText("Testing...");
							const ok = await this.manager.healthCheck();
							button.setDisabled(false);
							button.setButtonText("Test");
							new Notice(ok ? "NyaHome: MTranServer is available." : "NyaHome: MTranServer is unavailable.", 8000);
						})
					),
			},
			{
				name: "Clear translation cache",
				desc: "Removes in-memory and persisted translations. Original mail is not changed.",
				aliases: ["clear cache"],
				build: (setting) =>
					setting.addButton((button) =>
						button.setButtonText("Clear").setWarning().onClick(async () => {
							await this.manager.clearCache();
							new Notice("NyaHome: translation cache cleared.");
						})
					),
			},
		];
	}

	private async save(patch: Parameters<TranslationManager["updateConfig"]>[0]): Promise<void> {
		await this.manager.updateConfig(patch);
	}
}
