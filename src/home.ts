import { App, debounce, ItemView, Modal, Notice, TFile, TFolder, normalizePath, setIcon } from "obsidian";
import catIcon from "./assets/cat.jpg";
import calendarIcon from "./assets/calendar.jpg";
import mailIcon from "./assets/mail.jpg";

/** The plugin methods the home page needs. Declared structurally so the
 *  module can sit beside main.ts without creating an import cycle. */
export interface HomePlugin {
	app: App;
	settings: {
		language: "zh" | "en";
		shortcuts: Shortcut[];
		homeCards: HomeCard[];
		homeBackgroundPath: string;
		homeBackgroundOpacity: number;
		homeBackgroundBlur: number;
	};
	listeners: Set<() => void>;
	queueSave(): void;
	persistNow(): Promise<void>;
	notify(): void;
	openCalendarView(): Promise<unknown>;
	openMailView(): Promise<unknown>;
	openOwnSettings(): void;
	openShortcuts(): void;
	manifest: { id: string };
}

interface Shortcut {
	id: string;
	group: string;
	label: string;
	kind: "folder" | "search" | "note" | "url";
	target: string;
}

/** One editable grid card. It starts as a named folder card; notes dragged
 *  onto it become its entries without copying them out of the vault. */
export interface HomeCard {
	id: string;
	title: string;
	notes: string[];
	/** Per-note grid spans inside the card body, keyed by vault path. */
	noteLayouts?: Record<string, { w?: number; h?: number }>;
	/** Explicit 12×12 grid placement. Older cards are migrated on first render. */
	x?: number;
	y?: number;
	w?: number;
	h?: number;
}

const CAT_ICON = catIcon;
const CALENDAR_ICON = calendarIcon;
const MAIL_ICON = mailIcon;

const HOME_GRID_COLS = 12;
const HOME_GRID_ROWS = 24;
const HOME_CARD_COLS = 4;
const HOME_CARD_ROWS = 2;

const SEARCH_FILTERS: Array<{ id: string; icon: string; labelZh: string; labelEn: string; extensions: string[] }> = [
	{ id: "folders", icon: "folder", labelZh: "文件夹", labelEn: "Folders", extensions: [] },
	{ id: "markdown", icon: "file-text", labelZh: "笔记", labelEn: "Notes", extensions: ["md", "markdown"] },
	{ id: "excalidraw", icon: "pen-tool", labelZh: "Excalidraw", labelEn: "Excalidraw", extensions: ["excalidraw"] },
	{ id: "canvas", icon: "layout-dashboard", labelZh: "画布", labelEn: "Canvas", extensions: ["canvas"] },
	{ id: "bases", icon: "database", labelZh: "Bases", labelEn: "Bases", extensions: ["base"] },
	{ id: "images", icon: "image", labelZh: "图片", labelEn: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"] },
	{ id: "videos", icon: "film", labelZh: "视频", labelEn: "Videos", extensions: ["mp4", "mkv", "webm", "mov", "avi", "ogv", "m4v"] },
	{ id: "audio", icon: "music", labelZh: "音频", labelEn: "Audio", extensions: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "3gp"] },
	{ id: "pdf", icon: "file-type", labelZh: "PDF", labelEn: "PDF", extensions: ["pdf"] },
	{ id: "documents", icon: "file-text", labelZh: "文档", labelEn: "Documents", extensions: ["doc", "docx", "odt", "rtf", "txt", "pages"] },
	{ id: "spreadsheets", icon: "file-spreadsheet", labelZh: "表格", labelEn: "Sheets", extensions: ["xls", "xlsx", "ods", "csv", "tsv", "numbers", "usheet"] },
	{ id: "presentations", icon: "presentation", labelZh: "演示", labelEn: "Slides", extensions: ["ppt", "pptx", "odp", "key"] },
	{ id: "3d", icon: "box", labelZh: "3D", labelEn: "3D", extensions: ["step", "stp", "stl", "obj", "fbx", "gltf", "glb", "3mf", "ply", "blend", "dae"] },
	{ id: "other", icon: "file", labelZh: "其他", labelEn: "Other", extensions: [] },
];

const ZH = {
	title: "NyaHome",
	search: "搜索笔记、附件或命令",
	newNote: "新建笔记",
	calendar: "日历",
	mail: "邮箱",
	quick: "快捷入口",
	openShortcuts: "管理快捷方式",
	folders: "文件夹区域",
	addFolder: "新建文件夹卡片",
	addNote: "添加笔记",
	emptyGrid: "点击这里建立第一个文件夹卡片",
	emptyCard: "把笔记拖到这里",
	dropHere: "松开鼠标添加",
	delete: "删除",
	removeNote: "移除",
	openSettings: "设置",
	notes: "笔记",
	commands: "命令",
	noResult: "没有匹配结果",
	cardName: "卡片名称",
	notePath: "笔记路径",
	layout: "整理布局",
	layoutDone: "完成整理",
	dragCard: "拖动移动卡片",
	resizeCard: "拖动调整大小",
	gridFull: "12×24 网格已经放不下新的文件夹卡片",
	add: "添加",
	cancel: "取消",
	rename: "重命名",
};

const EN = {
	title: "NyaHome",
	search: "Search notes, attachments, and commands",
	newNote: "New note",
	calendar: "Calendar",
	mail: "Mail",
	quick: "Quick access",
	openShortcuts: "Manage shortcuts",
	folders: "Folders",
	addFolder: "New folder card",
	addNote: "Add note",
	emptyGrid: "Click here to make your first folder card",
	emptyCard: "Drop notes here",
	dropHere: "Release to add",
	delete: "Delete",
	removeNote: "Remove",
	openSettings: "Settings",
	notes: "Notes",
	commands: "Commands",
	noResult: "No matches",
	cardName: "Card name",
	notePath: "Note path",
	layout: "Arrange layout",
	layoutDone: "Done arranging",
	dragCard: "Drag to move this card",
	resizeCard: "Drag to resize this card",
	gridFull: "The 12×24 grid has no room for another folder card",
	add: "Add",
	cancel: "Cancel",
	rename: "Rename",
};

const T = (lang: "zh" | "en") => (lang === "zh" ? ZH : EN);

export class NyaHomeView extends ItemView {
	private clock: HTMLElement | null = null;
	private clockGreeting: HTMLElement | null = null;
	private clockDate: HTMLElement | null = null;
	private clockTimer: number | null = null;
	private searchFilter: string | null = null;
	private layoutEditing = false;
	private renderSignature = "";
	private listener: () => void;

	constructor(leaf: import("obsidian").WorkspaceLeaf, private readonly plugin: HomePlugin) {
		super(leaf);
		this.listener = () => {
			const next = this.homeSignature();
			if (next !== this.renderSignature) this.render();
		};
	}

	getViewType(): string {
		return "nyahome-home";
	}

	getDisplayText(): string {
		return "NyaHome";
	}

	getIcon(): string {
		return "home";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("nyahome");
		this.plugin.listeners.add(this.listener);
		this.render();
	}

	async onClose(): Promise<void> {
		this.plugin.listeners.delete(this.listener);
		if (this.clockTimer != null) window.clearInterval(this.clockTimer);
		this.clockTimer = null;
		this.contentEl.removeClass("nyahome");
		this.contentEl.empty();
	}

	private render(): void {
		const t = T(this.plugin.settings.language);
		this.contentEl.empty();

		const background = this.contentEl.createDiv("nyahome-background");
		const page = this.contentEl.createDiv("nyahome-scroll");
		this.applyHomeBackground(background);

		const header = page.createDiv("nyahome-header");
		const cat = header.createDiv("nyahome-cat");
		cat.createEl("button", { cls: "nyahome-cat-trigger", attr: { "aria-label": t.openSettings, title: t.openSettings } }, (el) => {
			el.createEl("img", { attr: { src: CAT_ICON, alt: "" } });
			el.addEventListener("click", () => this.plugin.openOwnSettings());
		});
		cat.createEl("h1", { text: t.title });

		const searchWrap = page.createDiv("nyahome-search-wrap");
		const searchCol = searchWrap.createDiv("nyahome-search-col");
		const search = searchCol.createDiv("nyahome-search");
		const searchIcon = search.createDiv("nyahome-search-icon");
		setIcon(searchIcon, "search");
		const input = search.createEl("input", { type: "text", cls: "nyahome-search-input", attr: { placeholder: t.search, spellcheck: "false" } });
		const results = searchCol.createDiv("nyahome-search-results");
		results.hide();

		searchWrap.createDiv("nyahome-newnote", (el) => {
			const icon = el.createDiv("nyahome-newnote-icon");
			setIcon(icon, "plus");
			el.createSpan({ cls: "nyahome-newnote-label", text: t.newNote });
			el.addEventListener("click", () => void this.createNewNote());
		});
		let selected = 0;
		let hits: SearchResult[] = [];

		const paintHits = () => {
			results.empty();
			if (!hits.length) {
				results.createDiv({ text: t.noResult });
				return;
			}
			hits.forEach((hit, i) => {
				const row = results.createDiv(`nyahome-hit${i === selected ? " is-active" : ""}`);
				row.createDiv({ cls: "nyahome-hit-kind", text: hit.kind === "folder" ? t.folders : hit.kind === "note" ? t.notes : t.commands });
				row.createDiv({ cls: "nyahome-hit-label", text: hit.label });
				row.createDiv({ cls: "nyahome-hit-path", text: hit.detail });
				row.addEventListener("click", () => this.openSearchHit(hit));
			});
		};

		const runSearch = () => {
			const q = input.value.trim().toLowerCase();
			hits = this.searchHits(q, 40);
			selected = Math.min(selected, Math.max(0, hits.length - 1));
			if (q || this.searchFilter || hits.length) {
				results.show();
				paintHits();
			} else results.hide();
		};
		const scheduleSearch = debounce(runSearch, 120, true);

		input.addEventListener("input", scheduleSearch);
		input.addEventListener("focus", () => {
			if (input.value.trim()) runSearch();
		});
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				selected = Math.min(selected + 1, hits.length - 1);
				paintHits();
				e.preventDefault();
			} else if (e.key === "ArrowUp") {
				selected = Math.max(selected - 1, 0);
				paintHits();
				e.preventDefault();
			} else if (e.key === "Enter" && hits[selected]) {
				this.openSearchHit(hits[selected]);
				e.preventDefault();
			} else if (e.key === "Escape") {
				results.hide();
				input.blur();
			}
		});

		// Hearth's header row is not a list of recent files; it is a live file-type
		// filter row. Each chip is a one-shot search filter, and the active chip
		// decides whether search shows folders or only files of that type.
		const filterRow = searchCol.createDiv("nyahome-filters");
		filterRow.style.setProperty("--n", String(this.searchFilters().length));
		for (const group of this.searchFilters()) {
			const tile = filterRow.createDiv("nyahome-filter");
			tile.toggleClass("is-active", this.searchFilter === group.id);
			tile.setAttribute("aria-label", this.plugin.settings.language === "zh" ? group.labelZh : group.labelEn);
			tile.setAttribute("role", "button");
			tile.setAttribute("tabindex", "0");
			tile.setAttribute("aria-pressed", String(this.searchFilter === group.id));
			const icon = tile.createDiv("nyahome-filter-icon");
			setIcon(icon, group.icon);
			const toggle = () => {
				const active = this.searchFilter !== group.id;
				this.searchFilter = active ? group.id : null;
				for (const el of Array.from(filterRow.children)) {
					el.removeClass("is-active");
					el.setAttribute("aria-pressed", "false");
				}
				tile.toggleClass("is-active", active);
				tile.setAttribute("aria-pressed", String(active));
				scheduleSearch();
				input.focus();
			};
			tile.addEventListener("click", toggle);
			tile.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					toggle();
				}
			});
		}

		const actions = page.createDiv("nyahome-features");
		actions.createDiv("nyahome-feature-gap is-left");
		actions.createDiv("nyahome-button is-calendar", (el) => {
			el.createEl("img", { cls: "nyahome-button-icon", attr: { src: CALENDAR_ICON, alt: "" } });
			el.createDiv({ cls: "nyahome-button-label", text: t.calendar });
			el.addEventListener("click", () => void this.plugin.openCalendarView());
		});
		const clockCard = actions.createDiv("nyahome-clock");
		this.clockGreeting = clockCard.createDiv("nyahome-clock-greeting");
		this.clock = clockCard.createDiv("nyahome-clock-time");
		this.clockDate = clockCard.createDiv("nyahome-clock-date");
		if (this.clockTimer != null) window.clearInterval(this.clockTimer);
		this.clockTimer = window.setInterval(() => this.tickClock(), 1000);
		this.tickClock();

		actions.createDiv("nyahome-button is-mail", (el) => {
			el.createEl("img", { cls: "nyahome-button-icon", attr: { src: MAIL_ICON, alt: "" } });
			el.createDiv({ cls: "nyahome-button-label", text: t.mail });
			el.addEventListener("click", () => void this.plugin.openMailView());
		});
		actions.createDiv("nyahome-feature-gap is-right");

		this.ensureHomeLayouts();
		const grid = page.createDiv("nyahome-grid-wrap");
		const sectionHead = grid.createDiv("nyahome-section-head");
		sectionHead.createDiv({ cls: "nyahome-section-title", text: t.folders });
		const sectionActions = sectionHead.createDiv("nyahome-section-actions");
		sectionActions.createDiv("nyahome-section-button", (el) => {
			const icon = el.createDiv("nyahome-section-icon");
			setIcon(icon, "plus");
			el.createSpan({ text: t.addFolder });
			el.addEventListener("click", () => this.addHomeCard(t));
		});
		sectionActions.createDiv("nyahome-section-button is-layout", (el) => {
			const icon = el.createDiv("nyahome-section-icon");
			setIcon(icon, this.layoutEditing ? "check" : "layout-grid");
			el.createSpan({ text: this.layoutEditing ? t.layoutDone : t.layout });
			el.toggleClass("is-active", this.layoutEditing);
			el.setAttribute("aria-pressed", String(this.layoutEditing));
			el.addEventListener("click", () => {
				this.layoutEditing = !this.layoutEditing;
				this.render();
			});
		});
		const cards = grid.createDiv("nyahome-grid");
		cards.toggleClass("is-layout-editing", this.layoutEditing);
		const cardList = this.plugin.settings.homeCards;
		if (!cardList.length) {
			cards.createDiv("nyahome-card is-empty", (el) => {
				el.createDiv({ text: t.emptyGrid });
				el.addEventListener("click", () => new HomeTextModal(this.app, t.addFolder, t.cardName, "", (title) => {
					this.addNamedHomeCard(title, t);
				}).open());
			});
		} else {
			for (const card of cardList) this.renderHomeCard(cards, card, t);
		}

		const foot = page.createDiv("nyahome-footer");
		foot.createEl("button", { text: t.openSettings }).addEventListener("click", () => this.plugin.openOwnSettings());
		this.renderSignature = this.homeSignature();
	}

	private homeSignature(): string {
		const s = this.plugin.settings;
		return JSON.stringify({
			language: s.language,
			cards: s.homeCards,
			backgroundPath: s.homeBackgroundPath,
			backgroundOpacity: s.homeBackgroundOpacity,
			backgroundBlur: s.homeBackgroundBlur,
		});
	}

	private applyHomeBackground(el: HTMLElement): void {
		const s = this.plugin.settings;
		const path = s.homeBackgroundPath.trim();
		const file = path ? this.app.vault.getAbstractFileByPath(normalizePath(path)) : null;
		el.style.backgroundImage = file instanceof TFile ? `url("${this.app.vault.getResourcePath(file)}")` : "";
		el.style.opacity = String(clampInteger(s.homeBackgroundOpacity, 0, 100, 65) / 100);
		const blur = clampInteger(s.homeBackgroundBlur, 0, 24, 0);
		el.style.filter = blur ? `blur(${blur}px)` : "";
		el.toggleClass("is-empty", !(file instanceof TFile));
	}

	private recentFiles(count: number): string[] {
		const workspace = this.app.workspace as unknown as { getLastOpenFiles?: () => string[] };
		const paths = typeof workspace.getLastOpenFiles === "function" ? workspace.getLastOpenFiles() : [];
		const out: string[] = [];
		for (const raw of paths) {
			const file = this.app.vault.getAbstractFileByPath(raw);
			if (file instanceof TFile && !out.includes(file.path)) out.push(file.path);
			if (out.length >= count) break;
		}
		return out;
	}

	private fileTypeIcon(file: TFile): string {
		const ext = file.extension.toLowerCase();
		const groups: Array<[string[], string]> = [
			[["md", "markdown"], "file-text"],
			[["excalidraw"], "pen-tool"],
			[["canvas"], "layout-dashboard"],
			[["base"], "database"],
			[["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"], "image"],
			[["mp4", "mkv", "webm", "mov", "avi", "ogv", "m4v"], "film"],
			[["mp3", "wav", "flac", "ogg", "m4a", "aac", "3gp"], "music"],
			[["pdf"], "file-type"],
			[["doc", "docx", "odt", "rtf", "txt", "pages"], "file-text"],
			[["xls", "xlsx", "ods", "csv", "tsv", "numbers", "usheet"], "file-spreadsheet"],
			[["ppt", "pptx", "odp", "key"], "presentation"],
			[["step", "stp", "stl", "obj", "fbx", "gltf", "glb", "3mf", "ply", "blend", "dae"], "box"],
		];
		for (const [exts, icon] of groups) if (exts.includes(ext)) return icon;
		return "file";
	}

	private async createNewNote(): Promise<void> {
		try {
			const fileManager = this.app.fileManager as unknown as { getNewFileParent?: (sourcePath: string, newFilePath?: string) => unknown };
			const parent = fileManager.getNewFileParent?.("") ?? this.app.vault.getRoot();
			const folder = (parent as { path?: string }).path && (parent as { path?: string }).path !== "/" ? `${(parent as { path?: string }).path}/` : "";
			const path = this.freeNotePath(folder, "Untitled");
			const file = await this.app.vault.create(path, "");
			await this.app.workspace.openLinkText(file.path, "", true);
		} catch (error) {
			console.error("NyaHome: could not create a note", error);
		}
	}

	private freeNotePath(folder: string, base: string): string {
		for (let n = 0; n < 100; n++) {
			const path = normalizePath(`${folder}${base}${n ? ` ${n}` : ""}.md`);
			if (!this.app.vault.getAbstractFileByPath(path)) return path;
		}
		return normalizePath(`${folder}${base} ${Date.now()}.md`);
	}

	private renderHomeCard(parent: HTMLElement, card: HomeCard, t: ReturnType<typeof T>): void {
		const el = parent.createDiv("nyahome-card is-folder");
		const layout = this.cardLayout(card);
		el.style.gridColumn = `${layout.x + 1} / span ${layout.w}`;
		el.style.gridRow = `${layout.y + 1} / span ${layout.h}`;
		el.addEventListener("dragover", (e) => {
			el.addClass("is-droptarget");
			e.dataTransfer!.dropEffect = "copy";
			e.preventDefault();
		});
		el.addEventListener("dragleave", () => el.removeClass("is-droptarget"));
		el.addEventListener("drop", (e) => {
			el.removeClass("is-droptarget");
			e.preventDefault();
			const paths = this.draggedPaths(e.dataTransfer);
			let changed = false;
			for (const path of paths) {
				if (!card.notes.includes(path)) {
					card.notes.push(path);
					changed = true;
				}
			}
			if (changed) {
				this.plugin.queueSave();
				this.render();
			}
		});

		const head = el.createDiv("nyahome-card-head");
		head.setAttribute("title", t.dragCard);
		head.createDiv({ cls: "nyahome-card-label", text: card.title });
		const controls = head.createDiv("nyahome-card-controls");
		controls.createEl("button", { attr: { "aria-label": t.addNote }, text: "+" }).addEventListener("click", () =>
			new HomeTextModal(this.app, t.addNote, t.notePath, "", (path) => {
				const clean = normalizePath(path.trim());
				if (this.app.vault.getAbstractFileByPath(clean) && !card.notes.includes(clean)) {
					card.notes.push(clean);
					this.plugin.queueSave();
					this.render();
				}
			}).open()
		);
		controls.createEl("button", { attr: { "aria-label": t.rename }, text: "✎" }).addEventListener("click", () =>
			new HomeTextModal(this.app, t.rename, t.cardName, card.title, (title) => {
				card.title = title;
				this.plugin.queueSave();
				this.render();
			}).open()
		);
		controls.createEl("button", { attr: { "aria-label": t.delete }, text: "×" }).addEventListener("click", () => {
			this.plugin.settings.homeCards = this.plugin.settings.homeCards.filter((c) => c.id !== card.id);
			this.plugin.queueSave();
			this.render();
		});

		if (this.layoutEditing) {
			el.addClass("is-layout-card");
			const resize = el.createDiv("nyahome-card-resize");
			resize.setAttribute("title", t.resizeCard);
			this.bindHomeCardMove(head, el, card, parent);
			this.bindHomeCardResize(resize, el, card, parent);
		}

		const body = el.createDiv("nyahome-card-body");
		if (!card.notes.length) body.createDiv({ cls: "nyahome-card-empty", text: t.emptyCard });
		else {
			for (const path of card.notes) {
				body.createDiv("nyahome-note", (noteEl) => {
					this.applyHomeNoteLayout(noteEl, this.noteLayout(card, path));
					noteEl.createDiv({ cls: "nyahome-note-label", text: path.split("/").pop() || path });
					noteEl.createDiv({ cls: "nyahome-note-path", text: path });
					noteEl.addEventListener("click", () => void this.app.workspace.openLinkText(path, "", true));
					noteEl.createEl("button", { cls: "nyahome-note-remove", attr: { "aria-label": t.removeNote }, text: "×" }).addEventListener("click", (e) => {
						e.stopPropagation();
						card.notes = card.notes.filter((x) => x !== path);
						if (card.noteLayouts) delete card.noteLayouts[path];
						this.plugin.queueSave();
						this.render();
					});
					if (this.layoutEditing) {
						const resize = noteEl.createDiv("nyahome-note-resize");
						resize.setAttribute("title", t.resizeCard);
						resize.addEventListener("click", (e) => e.stopPropagation());
						this.bindHomeNoteResize(resize, noteEl, card, path, body);
					}
				});
			}
		}
	}

	private addHomeCard(t: ReturnType<typeof T>): void {
		new HomeTextModal(this.app, t.addFolder, t.cardName, "", (title) => this.addNamedHomeCard(title, t)).open();
	}

	private addNamedHomeCard(title: string, t: ReturnType<typeof T>): void {
		const cardList = this.plugin.settings.homeCards;
		const layout = this.firstFreeLayout(cardList, 4, 2);
		if (!layout) {
			new Notice(t.gridFull);
			return;
		}
		cardList.push({ id: crypto.randomUUID(), title, notes: [], ...layout });
		this.plugin.queueSave();
		this.render();
	}

	private ensureHomeLayouts(): void {
		const cardList = this.plugin.settings.homeCards;
		let changed = false;
		const placed: HomeCard[] = [];
		for (const card of cardList) {
			const current = this.cardLayout(card);
			let layout = current;
			if (card.x == null || card.y == null || card.w == null || card.h == null || !this.layoutFits(current)) {
				layout = this.firstFreeLayout(placed, current.w, current.h) ?? { x: 0, y: 0, w: 1, h: 1 };
				changed = true;
			}
			card.x = layout.x;
			card.y = layout.y;
			card.w = layout.w;
			card.h = layout.h;
			placed.push(card);
		}
		if (changed) this.plugin.queueSave();
	}

	private cardLayout(card: HomeCard): { x: number; y: number; w: number; h: number } {
		return {
			x: clampInteger(card.x, 0, HOME_GRID_COLS - 1, 0),
			y: clampInteger(card.y, 0, HOME_GRID_ROWS - 1, 0),
			w: clampInteger(card.w, 1, HOME_GRID_COLS, HOME_CARD_COLS),
			h: clampInteger(card.h, 1, HOME_GRID_ROWS, HOME_CARD_ROWS),
		};
	}

	private layoutFits(layout: { x: number; y: number; w: number; h: number }): boolean {
		return layout.x >= 0 && layout.y >= 0 && layout.w >= 1 && layout.h >= 1 &&
			layout.x + layout.w <= HOME_GRID_COLS && layout.y + layout.h <= HOME_GRID_ROWS;
	}

	private layoutIsFree(layout: { x: number; y: number; w: number; h: number }, placed: HomeCard[], exclude?: HomeCard): boolean {
		return placed.every((other) => {
			if (other === exclude || other.id === exclude?.id) return true;
			const next = this.cardLayout(other);
			return layout.x + layout.w <= next.x || next.x + next.w <= layout.x ||
				layout.y + layout.h <= next.y || next.y + next.h <= layout.y;
		});
	}

	private firstFreeLayout(placed: HomeCard[], w: number, h: number): { x: number; y: number; w: number; h: number } | null {
		const width = clampInteger(w, 1, HOME_GRID_COLS, HOME_CARD_COLS);
		const height = clampInteger(h, 1, HOME_GRID_ROWS, HOME_CARD_ROWS);
		for (let y = 0; y <= HOME_GRID_ROWS - height; y++) {
			for (let x = 0; x <= HOME_GRID_COLS - width; x++) {
				const layout = { x, y, w: width, h: height };
				if (this.layoutIsFree(layout, placed)) return layout;
			}
		}
		return null;
	}

	private bindHomeCardMove(handle: HTMLElement, el: HTMLElement, card: HomeCard, grid: HTMLElement): void {
		const origin = this.cardLayout(card);
		const start = { x: 0, y: 0 };
		let active = false;

		handle.addEventListener("pointerdown", (e: PointerEvent) => {
			if (!this.layoutEditing || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
			Object.assign(origin, this.cardLayout(card));
			start.x = e.clientX;
			start.y = e.clientY;
			active = true;
			el.addClass("is-layout-dragging");
			handle.setPointerCapture(e.pointerId);
			e.preventDefault();
		});
		handle.addEventListener("pointermove", (e: PointerEvent) => {
			if (!active) return;
			const geometry = this.gridGeometry(grid);
			const width = clampInteger(card.w, 1, HOME_GRID_COLS, HOME_CARD_COLS);
			const height = clampInteger(card.h, 1, HOME_GRID_ROWS, HOME_CARD_ROWS);
			const x = clampInteger(origin.x + Math.round((e.clientX - start.x) / geometry.stepX), 0, HOME_GRID_COLS - width, origin.x);
			const y = clampInteger(origin.y + Math.round((e.clientY - start.y) / geometry.stepY), 0, HOME_GRID_ROWS - height, origin.y);
			const layout = { x, y, w: width, h: height };
			card.x = x;
			card.y = y;
			this.applyHomeCardLayout(el, layout);
		});
		const finish = () => {
			if (!active) return;
			active = false;
			el.removeClass("is-layout-dragging is-layout-invalid");
			void this.plugin.persistNow();
		};
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
		handle.addEventListener("lostpointercapture", finish);
	}

	private bindHomeCardResize(handle: HTMLElement, el: HTMLElement, card: HomeCard, grid: HTMLElement): void {
		const origin = this.cardLayout(card);
		const start = { x: 0, y: 0 };
		let active = false;

		handle.addEventListener("pointerdown", (e: PointerEvent) => {
			if (!this.layoutEditing || e.button !== 0) return;
			Object.assign(origin, this.cardLayout(card));
			start.x = e.clientX;
			start.y = e.clientY;
			active = true;
			el.addClass("is-layout-resizing");
			handle.setPointerCapture(e.pointerId);
			e.preventDefault();
		});
		handle.addEventListener("pointermove", (e: PointerEvent) => {
			if (!active) return;
			const geometry = this.gridGeometry(grid);
			const w = clampInteger(origin.w + Math.round((e.clientX - start.x) / geometry.stepX), 1, HOME_GRID_COLS - origin.x, origin.w);
			const h = clampInteger(origin.h + Math.round((e.clientY - start.y) / geometry.stepY), 1, HOME_GRID_ROWS - origin.y, origin.h);
			const layout = { x: origin.x, y: origin.y, w, h };
			card.w = w;
			card.h = h;
			this.applyHomeCardLayout(el, layout);
		});
		const finish = () => {
			if (!active) return;
			active = false;
			el.removeClass("is-layout-resizing is-layout-invalid");
			void this.plugin.persistNow();
		};
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
		handle.addEventListener("lostpointercapture", finish);
	}

	private noteLayout(card: HomeCard, path: string): { w: number; h: number } {
		const saved = card.noteLayouts?.[path];
		return {
			w: clampInteger(saved?.w, 1, 4, 1),
			h: clampInteger(saved?.h, 1, 4, 1),
		};
	}

	private applyHomeNoteLayout(el: HTMLElement, layout: { w: number; h: number }): void {
		el.style.gridColumn = `span ${layout.w}`;
		el.style.gridRow = `span ${layout.h}`;
	}

	private bindHomeNoteResize(handle: HTMLElement, el: HTMLElement, card: HomeCard, path: string, body: HTMLElement): void {
		const origin = this.noteLayout(card, path);
		const start = { x: 0, y: 0 };
		let active = false;

		handle.addEventListener("pointerdown", (e: PointerEvent) => {
			if (!this.layoutEditing || e.button !== 0) return;
			Object.assign(origin, this.noteLayout(card, path));
			start.x = e.clientX;
			start.y = e.clientY;
			active = true;
			el.addClass("is-layout-resizing");
			handle.setPointerCapture(e.pointerId);
			e.preventDefault();
			e.stopPropagation();
		});
		handle.addEventListener("pointermove", (e: PointerEvent) => {
			if (!active) return;
			const geometry = this.noteGridGeometry(body);
			const layout = {
				w: clampInteger(origin.w + Math.round((e.clientX - start.x) / geometry.stepX), 1, Math.min(4, geometry.columns), origin.w),
				h: clampInteger(origin.h + Math.round((e.clientY - start.y) / geometry.stepY), 1, 4, origin.h),
			};
			card.noteLayouts = { ...(card.noteLayouts ?? {}), [path]: layout };
			this.applyHomeNoteLayout(el, layout);
			e.preventDefault();
		});
		const finish = () => {
			if (!active) return;
			active = false;
			el.removeClass("is-layout-resizing");
			void this.plugin.persistNow();
		};
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
		handle.addEventListener("lostpointercapture", finish);
	}

	private noteGridGeometry(body: HTMLElement): { stepX: number; stepY: number; gap: number; columns: number } {
		const rect = body.getBoundingClientRect();
		const styles = window.getComputedStyle(body);
		const gap = Number.parseFloat(styles.columnGap) || 0;
		const columnWidth = Number.parseFloat(styles.gridTemplateColumns.split(" ")[0] ?? "") || 88;
		const rowHeight = Number.parseFloat(styles.gridAutoRows.split(" ")[0] ?? "") || 54;
		const columns = Math.max(1, Math.floor((rect.width + gap) / (columnWidth + gap)));
		return {
			gap,
			stepX: columnWidth + gap,
			stepY: rowHeight + gap + 1,
			columns,
		};
	}

	private gridGeometry(grid: HTMLElement): { rect: DOMRect; stepX: number; stepY: number; gap: number } {
		const rect = grid.getBoundingClientRect();
		const styles = window.getComputedStyle(grid);
		const gap = Number.parseFloat(styles.columnGap) || 0;
		const cellWidth = (rect.width - gap * (HOME_GRID_COLS - 1)) / HOME_GRID_COLS;
		const cellHeight = (rect.height - gap * (HOME_GRID_ROWS - 1)) / HOME_GRID_ROWS;
		return {
			rect,
			gap,
			stepX: cellWidth + gap,
			stepY: cellHeight + gap,
		};
	}

	private applyHomeCardLayout(el: HTMLElement, layout: { x: number; y: number; w: number; h: number }): void {
		el.style.gridColumn = `${layout.x + 1} / span ${layout.w}`;
		el.style.gridRow = `${layout.y + 1} / span ${layout.h}`;
	}

	private runShortcut(s: Shortcut): void {
		if (s.kind === "note") void this.app.workspace.openLinkText(s.target, "", true);
		else if (s.kind === "url") window.open(s.target, "_blank");
		else this.plugin.openShortcuts();
	}

	private searchHits(q: string, limit: number): SearchResult[] {
		const commandRegistry = this.app as unknown as { commands: { listCommands(): Array<{ id: string; name?: string }>; executeCommandById(id: string): void } };
		if (q.startsWith(">")) {
			const needle = q.slice(1).trim();
			const out: SearchResult[] = [];
			for (const command of commandRegistry.commands.listCommands()) {
				const name = String(command.name ?? "").toLowerCase();
				if (!needle || name.includes(needle)) {
					out.push({
						kind: "command",
						label: String(command.name ?? command.id),
						detail: command.id,
						open: () => commandRegistry.commands.executeCommandById(command.id),
						score: needle ? (name === needle ? 100 : name.startsWith(needle) ? 80 : 60) : 0,
					});
					if (out.length >= limit) break;
				}
			}
			return out;
		}

		if (!q && !this.searchFilter) {
			return this.searchHistory().map((path): SearchResult => {
				const file = this.app.vault.getAbstractFileByPath(path);
				const kind: SearchResult["kind"] = file instanceof TFolder ? "folder" : "note";
				return {
					kind,
					label: path.split("/").pop() || path,
					detail: path,
					open: () => {
						void this.app.workspace.openLinkText(path, "", true);
						this.pushSearchHistory(path);
					},
					score: 0,
				};
			}).slice(0, limit);
		}

		const hits: SearchResult[] = [];
		for (const file of this.app.vault.getFiles()) {
			if (this.searchFilter && this.searchFilter !== "folders" && this.fileTypeGroup(file) !== this.searchFilter) continue;
			const name = file.basename.toLowerCase();
			const path = file.path.toLowerCase();
			let score = 0;
			if (name === q) score = 100;
			else if (name.startsWith(q)) score = 80;
			else if (name.includes(q)) score = 60;
			else if (path.includes(q)) score = 35;
			if (!score) continue;
			hits.push({
				kind: "note",
				label: file.basename,
				detail: file.path,
				open: () => {
					void this.app.workspace.openLinkText(file.path, "", true);
					this.pushSearchHistory(file.path);
				},
				score,
			});
		}
		hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
		return hits.slice(0, limit);
	}

	private searchFilters() {
		const files = this.app.vault.getFiles();
		const present = new Set(files.map((f) => this.fileTypeGroup(f)));
		const hasFolders = this.app.vault.getAllLoadedFiles().some((f) => f instanceof TFolder && f.path !== "/");
		return SEARCH_FILTERS.filter((g) => (g.id === "folders" ? hasFolders : present.has(g.id)));
	}

	private fileTypeGroup(file: TFile): string {
		const ext = file.extension.toLowerCase();
		for (const group of SEARCH_FILTERS) {
			if (group.extensions.includes(ext)) return group.id;
		}
		return "other";
	}

	private searchHistory(): string[] {
		const raw = this.app.loadLocalStorage("hearth-search-history");
		return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
	}

	private pushSearchHistory(path: string): void {
		const next = [path, ...this.searchHistory().filter((x) => x !== path)].slice(0, 6);
		this.app.saveLocalStorage("hearth-search-history", next);
	}

	private openSearchHit(hit: SearchResult): void {
		hit.open();
	}

	private draggedPaths(dt: DataTransfer | null): string[] {
		if (!dt) return [];
		const out: string[] = [];
		for (const type of ["application/x-obsidian-file", "text/uri-list", "text/plain"]) {
			const raw = dt.getData(type);
			if (!raw) continue;
			for (const line of raw.split(/\r?\n/)) {
				const path = line.trim().replace(/^obsidian:\/\/open\?path=/, "").replace(/^file:\/\/\//, "");
				if (!path) continue;
				const decoded = decodeURIComponent(path);
				const hit = this.resolvePath(decoded);
				if (hit) out.push(hit);
			}
		}
		return [...new Set(out)];
	}

	private resolvePath(raw: string): string | null {
		const path = normalizePath(raw.trim());
		const exact = this.app.vault.getAbstractFileByPath(path);
		if (exact instanceof TFile) return path;
		const base = path.split("/").pop() ?? "";
		const hit = this.app.vault.getFiles().find((f) => f.basename === base || f.path === path);
		return hit?.path ?? null;
	}

	private tickClock(): void {
		if (!this.clock || !this.clockGreeting || !this.clockDate) return;
		const now = new Date();
		const locale = this.plugin.settings.language === "zh" ? "zh-CN" : "en-US";
		const hour = now.getHours();
		const greeting = this.plugin.settings.language === "zh"
			? (hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好")
			: (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
		this.clockGreeting.setText(greeting);
		this.clock.setText(now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: this.plugin.settings.language !== "zh" }));
		this.clockDate.setText(now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }));
	}
}

function clampInteger(value: number | null | undefined, min: number, max: number, fallback: number): number {
	const source = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
	return Math.min(max, Math.max(min, source));
}

interface SearchResult {
	kind: "note" | "folder" | "command";
	label: string;
	detail: string;
	open: () => void;
	score: number;
}

class HomeTextModal extends Modal {
	constructor(app: App, title: string, placeholder: string, value: string, private readonly submit: (value: string) => void) {
		super(app);
		this.titleEl.setText(title);
		this.contentEl.addClass("nyahome-modal");
		const input = this.contentEl.createEl("input", { type: "text", attr: { placeholder, spellcheck: "false" } });
		input.value = value;
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && input.value.trim()) {
				submit(input.value.trim());
				this.close();
			}
		});
		const buttons = this.contentEl.createDiv("modal-button-container");
		buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		buttons.createEl("button", { cls: "mod-cta", text: "OK" }).addEventListener("click", () => {
			if (input.value.trim()) submit(input.value.trim());
			this.close();
		});
	}

	onOpen(): void {
		const input = this.contentEl.querySelector("input");
		if (input) input.focus();
	}
}
