/* Tasks board: long-term task management as a kanban, rendered in the
 * calendar view's Tasks mode. Storage is one Markdown file per board in the
 * obsidian-kanban shape (frontmatter `kanban-plugin: board`, `## Column`
 * headings, `- [ ]` cards, indented body lines), so the files stay open to
 * the rest of the vault. Cards carry fancy-kanban-style fields: a due date
 * marker (📅), tags, and a description body; right-click opens a context
 * menu in the shape of obsidian-kanban's card menu. */

import { Menu, Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";

export interface KanbanCard {
	text: string;
	checked: boolean;
	/** Indented continuation lines under the card item. */
	body?: string;
}

export interface KanbanColumn {
	name: string;
	cards: KanbanCard[];
}

export interface KanbanBoard {
	columns: KanbanColumn[];
}

const FRONTMATTER = ["---", "kanban-plugin: board", "---", ""];
const DATE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;

/** The card's title with the date marker stripped, for display and edit. */
export function cardTitle(card: KanbanCard): string {
	return card.text.replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "").trim();
}

export function cardDate(card: KanbanCard): string | null {
	return card.text.match(DATE_RE)?.[1] ?? null;
}

/** Parse obsidian-kanban Markdown. Columns are `## ` headings; their cards
 *  are `- [ ]` / `- [x]` list items, and indented lines under a card are
 *  that card's body. */
export function parseKanbanBoard(text: string): KanbanBoard {
	const columns: KanbanColumn[] = [];
	let current: KanbanColumn | null = null;
	let last: KanbanCard | null = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (line.startsWith("## ")) {
			current = { name: line.slice(3).trim(), cards: [] };
			columns.push(current);
			last = null;
			continue;
		}
		if (!current) continue;
		const card = line.match(/^- \[([ xX])\] (.*)$/);
		if (card) {
			last = { checked: card[1].toLowerCase() === "x", text: card[2].trim() };
			current.cards.push(last);
			continue;
		}
		if (line.trim() === "") {
			last = null;
			continue;
		}
		// an indented line under a card belongs to that card's body
		if (last && /^\s/.test(raw)) {
			const bodyLine = raw.trim();
			last.body = last.body ? `${last.body}\n${bodyLine}` : bodyLine;
		}
	}
	if (!columns.length) columns.push({ name: "Todo", cards: [] });
	return { columns };
}

export function serializeKanbanBoard(board: KanbanBoard): string {
	const parts = [...FRONTMATTER];
	for (const col of board.columns) {
		parts.push(`## ${col.name}`, "");
		for (const card of col.cards) {
			parts.push(`- [${card.checked ? "x" : " "}] ${card.text}`);
			if (card.body) for (const line of card.body.split("\n")) parts.push(`  ${line}`);
		}
		parts.push("");
	}
	return parts.join("\n");
}

/** Editing surface passed in by the calendar view, so this file never needs
 *  the whole plugin type. */
export interface KanbanHost {
	readBoard(path: string): Promise<string>;
	writeBoard(path: string, text: string): Promise<void>;
	listBoards(folder: string): Promise<string[]>;
	createBoard(folder: string, name: string): Promise<string>;
	renameBoard(path: string, name: string): Promise<string>;
	deleteBoard(path: string): Promise<void>;
	activeBoard: string | null;
	/** Hand a card's text to the calendar (opens the event editor prefilled). */
	linkToCalendar(text: string): void;
}

export class TasksBoard {
	private folder: string;
	private board: KanbanBoard | null = null;
	private path: string | null = null;
	private dragCard: KanbanCard | null = null;

	constructor(
		private app: App,
		private host: KanbanHost,
		private container: HTMLElement,
		folder: string
	) {
		this.folder = folder;
	}

	async render() {
		const c = this.container;
		c.empty();
		c.addClass("pcal-tasks");
		const names = await this.host.listBoards(this.folder);
		if (!this.path) this.path = this.host.activeBoard && names.includes(this.host.activeBoard) ? this.host.activeBoard : names[0] ?? null;
		const header = c.createDiv("pcal-tasks-head");
		const switcher = header.createDiv("pcal-tasks-switch");
		if (names.length) {
			const sel = switcher.createEl("select", { cls: "dropdown" });
			for (const n of names) sel.createEl("option", { value: n, text: (n.split("/").pop() ?? n).replace(/\.md$/i, "") });
			if (this.path) sel.value = this.path;
			sel.addEventListener("change", () => {
				this.path = sel.value;
				this.host.activeBoard = sel.value;
				void this.reload();
			});
			switcher.createEl("button", { text: "New board", cls: "mod-cta" }).addEventListener("click", () => this.askName("New board", "Create", null, (name) => this.create(name)));
			switcher.createEl("button", { text: "Rename" }).addEventListener("click", () => this.path && this.askName("Rename board", "Rename", (this.path.split("/").pop() ?? this.path).replace(/\.md$/i, ""), (name) => this.rename(name)));
			// no delete button: a whole board is too much to lose to a click
		} else {
			switcher.createSpan({ cls: "pcal-tasks-empty", text: "No boards yet." });
			switcher.createEl("button", { text: "New board", cls: "mod-cta" }).addEventListener("click", () => this.askName("New board", "Create", null, (name) => this.create(name)));
		}

		const body = c.createDiv("fk-board__columns pcal-tasks-columns");
		if (!this.path) return;
		try {
			this.board = parseKanbanBoard(await this.host.readBoard(this.path));
		} catch (e) {
			body.createDiv({ cls: "pcal-tasks-error", text: `Could not read the board (${e instanceof Error ? e.message : String(e)}).` });
			return;
		}
		this.renderColumns(body);
	}

	private renderColumns(body: HTMLElement) {
		body.empty();
		const board = this.board!;
		board.columns.forEach((col, ci) => {
			const colEl = body.createDiv("fk-col pcal-tasks-col");
			colEl.addEventListener("dragover", (e) => {
				e.preventDefault();
				colEl.addClass("is-droptarget");
			});
			colEl.addEventListener("dragleave", () => colEl.removeClass("is-droptarget"));
			colEl.addEventListener("drop", (e) => {
				e.preventDefault();
				colEl.removeClass("is-droptarget");
				const dragged = this.dragCard;
				this.dragCard = null;
				if (!dragged) return;
				for (const c of board.columns) c.cards = c.cards.filter((card) => card !== dragged);
				board.columns[ci].cards.push(dragged);
				void this.persist();
			});
			const head = colEl.createDiv("fk-col-header pcal-tasks-colhead");
			head.createSpan({ cls: "pcal-tasks-colname", text: col.name }).addEventListener("click", () => this.askName("Rename column", "Rename", col.name, (name) => { col.name = name; void this.persist(); }));
			head.createSpan({ cls: "pcal-tasks-count", text: String(col.cards.length) });
			head.createEl("button", { cls: "pcal-tasks-coladd", text: "+" }).addEventListener("click", () => this.addCard(col));
			const menuBtn = head.createEl("button", { cls: "pcal-tasks-colmenu", text: "⋯" });
			menuBtn.addEventListener("click", (e) => {
				const menu = new Menu();
				menu.addItem((i) => i.setTitle("Rename column").onClick(() => this.askName("Rename column", "Rename", col.name, (name) => { col.name = name; void this.persist(); })));
				menu.addItem((i) => i.setTitle("Delete column").onClick(() => {
					if (col.cards.length) new Notice("Move or clear the cards in this column first.");
					else {
						board.columns = board.columns.filter((_, i) => i !== ci);
						void this.persist();
					}
				}));
				menu.showAtMouseEvent(e);
			});
			const list = colEl.createDiv("pcal-tasks-cards");
			for (const card of col.cards) this.renderCard(list, card);
			const addBtn = colEl.createEl("button", { text: "+ Add card", cls: "pcal-tasks-addcard" });
			addBtn.addEventListener("click", () => this.addCard(col));
		});
		const addCol = body.createDiv("pcal-tasks-addcol");
		addCol.createEl("button", { text: "+ Add column" }).addEventListener("click", () => this.askName("Add column", "Add", null, (name) => {
			board.columns.push({ name, cards: [] });
			void this.persist();
		}));
	}

	private renderCard(list: HTMLElement, card: KanbanCard) {
		const row = list.createDiv("fk-card pcal-tasks-card");
		row.draggable = true;
		row.addEventListener("dragstart", () => (this.dragCard = card));
		row.addEventListener("dragend", () => (this.dragCard = null));
		row.addEventListener("contextmenu", (e) => this.cardMenu(e, card));
		const check = row.createEl("input", { type: "checkbox" });
		check.checked = card.checked;
		check.addEventListener("change", () => {
			card.checked = check.checked;
			void this.persist();
		});
		// fancy-kanban-style markers: an obsidian-kanban date (📅 2026-09-21)
		// renders as a chip, #tags render as colored chips; the raw text is
		// what is stored, so the files stay plain Markdown
		const main = row.createDiv("pcal-tasks-cardmain");
		const textEl = main.createSpan({ cls: "pcal-tasks-cardtext" + (card.checked ? " is-done" : "") });
		textEl.addEventListener("click", () => this.editCard(card));
		textEl.setText(cardTitle(card) || "(no title)");
		const date = cardDate(card);
		if (date) {
			const chip = row.createSpan({ cls: "pcal-tasks-date", text: date.slice(5) });
			chip.toggleClass("is-overdue", date < new Date().toISOString().slice(0, 10));
		}
		for (const m of card.text.matchAll(/#([\p{L}\p{N}_/-]+)/gu)) {
			row.createSpan({ cls: "pcal-tasks-tag", text: "#" + m[1] });
		}
		if (card.body) main.createDiv({ cls: "pcal-tasks-carddesc", text: card.body.split("\n")[0] });
	}

	/** The card's context menu, in the shape of obsidian-kanban's. */
	private cardMenu(e: MouseEvent, card: KanbanCard) {
		e.preventDefault();
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Edit").setIcon("pencil").onClick(() => this.editCard(card)));
		menu.addItem((i) =>
			i
				.setTitle(card.checked ? "Mark as not done" : "Mark as done")
				.setIcon(card.checked ? "square" : "check")
				.onClick(() => {
					card.checked = !card.checked;
					void this.persist();
				})
		);
		if (cardDate(card)) menu.addItem((i) => i.setTitle("Remove due date").setIcon("calendar-off").onClick(() => this.setDue(card, null)));
		else menu.addItem((i) => i.setTitle("Set due date").setIcon("calendar-plus").onClick(() => this.askDate(card)));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Link to calendar").setIcon("calendar-days").onClick(() => this.host.linkToCalendar(card.text)));
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Delete card")
				.setIcon("trash-2")
				.onClick(() => {
					for (const col of this.board!.columns) col.cards = col.cards.filter((c) => c !== card);
					void this.persist();
				})
		);
		menu.showAtMouseEvent(e);
	}

	private askDate(card: KanbanCard) {
		new DateModal(this.app, cardDate(card) ?? "", (date) => this.setDue(card, date));
	}

	private setDue(card: KanbanCard, date: string | null) {
		const tags = (card.text.match(/#([\p{L}\p{N}_/-]+)/gu) ?? []).join(" ");
		const title = cardTitle(card);
		if (date) card.text = `${title} 📅 ${date}` + (tags ? ` ${tags}` : "");
		else card.text = title + (tags ? ` ${tags}` : "");
		void this.persist();
	}

	private addCard(col: KanbanColumn) {
		new TaskCardModal(this.app, "New task", "Add", null, (title, date, body) => {
			if (!title.trim()) return;
			col.cards.push({ text: `${title.trim()}${date ? ` 📅 ${date}` : ""}`, checked: false, body: body || undefined });
			void this.persist();
		}).open();
	}

	private editCard(card: KanbanCard) {
		new TaskCardModal(this.app, "Edit task", "Save", card, (title, date, body, remove) => {
			const tags = (card.text.match(/#([\p{L}\p{N}_/-]+)/gu) ?? []).join(" ");
			if (remove) {
				for (const col of this.board!.columns) col.cards = col.cards.filter((c) => c !== card);
			} else {
				card.text = `${title.trim()}${date ? ` 📅 ${date}` : ""}` + (tags ? ` ${tags}` : "");
				card.body = body || undefined;
			}
			void this.persist();
		}).open();
	}

	private askName(title: string, verb: string, initial: string | null, onOk: (name: string) => void) {
		new TextInputModal(this.app, title, verb, initial ?? "", onOk).open();
	}

	private async create(name: string) {
		this.path = await this.host.createBoard(this.folder, name);
		this.host.activeBoard = this.path;
		this.board = { columns: [{ name: "Todo", cards: [] }, { name: "Doing", cards: [] }, { name: "Done", cards: [] }] };
		await this.host.writeBoard(this.path, serializeKanbanBoard(this.board));
		await this.reload();
	}

	private async rename(name: string) {
		if (!this.path) return;
		this.path = await this.host.renameBoard(this.path, name);
		this.host.activeBoard = this.path;
		await this.reload();
	}

	private async persist() {
		if (this.path && this.board) await this.host.writeBoard(this.path, serializeKanbanBoard(this.board));
		await this.reload();
	}

	private async reload() {
		await this.render();
	}
}

class TextInputModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private verb: string,
		private initial: string,
		private onOk: (value: string) => void
	) {
		super(app);
		this.initial = initial;
	}

	onOpen() {
		this.titleEl.setText(this.title);
		const input = this.contentEl.createEl("input", { type: "text", cls: "pcal-tasks-input" });
		input.value = this.initial;
		const btns = this.contentEl.createDiv({ cls: "pcal-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { text: this.verb, cls: "mod-cta" }).addEventListener("click", () => {
			this.onOk(input.value);
			this.close();
		});
		window.setTimeout(() => input.focus(), 20);
	}
}

/** The card editor, fancy-kanban's shape: a title field, a date field, and a
 *  real description area. */
class TaskCardModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private verb: string,
		private card: KanbanCard | null,
		private onOk: (title: string, date: string | null, body: string, remove: boolean) => void
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(this.title);
		const c = this.contentEl;
		let title = this.card ? cardTitle(this.card) : "";
		let date = this.card ? cardDate(this.card) : null;
		let body = this.card?.body ?? "";
		let remove = false;
		const titleRow = new Setting(c).setName("Title").addText((t) => t.setValue(title).onChange((v) => (title = v)));
		new Setting(c)
			.setName("Due date")
			.setDesc("YYYY-MM-DD, optional.")
			.addText((t) => t.setPlaceholder("2026-09-21").setValue(date ?? "").onChange((v) => (date = /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null)));
		c.createDiv({ cls: "setting-item-name pcal-event-desc-label", text: "Description" });
		const desc = c.createEl("textarea", { cls: "pcal-tasks-cardeditor" });
		desc.value = body;
		desc.addEventListener("input", () => (body = desc.value));
		const btns = c.createDiv({ cls: "pcal-modal-btns" });
		if (this.card) btns.createEl("button", { text: "Delete card" }).addEventListener("click", () => {
			remove = true;
			this.onOk(title, date, body, remove);
			this.close();
		});
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { text: this.verb, cls: "mod-cta" }).addEventListener("click", () => {
			this.onOk(title, date, body, remove);
			this.close();
		});
	window.setTimeout(() => titleRow.controlEl.querySelector("input")?.focus(), 20);
	}
}

/** Just the date picker, for the context menu's "Set due date". */
class DateModal extends Modal {
	constructor(
		app: App,
		private initial: string,
		private onOk: (date: string | null) => void
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("Set due date");
		const c = this.contentEl;
		const input = c.createEl("input", { type: "date" });
		input.value = this.initial;
		const btns = c.createDiv({ cls: "pcal-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => {
			this.onOk(/^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : null);
			this.close();
		});
	}
}
