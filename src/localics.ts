/* Local calendar: build and edit an iCalendar file in the vault. This is the
 * write side of the ICS format — parseIcsEvents() in ics.ts handles reading,
 * this module creates VEVENTs, writes occurrence overrides (RECURRENCE-ID),
 * and serializes the calendar back to text. Pure: no Obsidian imports. */

import ICAL from "ical.js";

export interface LocalEventRecord {
	uid: string;
	title: string;
	startMs: number;
	endMs: number;
	allDay: boolean;
	location?: string;
	description?: string;
	/** Raw RRULE value ("FREQ=DAILY"), written on create only. */
	repeat?: string;
}

const CRLF = "\r\n";
const RRULE_DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** A fresh VCALENDAR wrapper, for a brand-new file. */
export function emptyIcs(): string {
	return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AmberNyaDesk//Local Calendar//EN", "CALSCALE:GREGORIAN", "END:VCALENDAR"].join(CRLF) + CRLF;
}

/** Local wall-clock to an ICS date(-time) value. Timed events are floating
 *  local times (no Z): the same wall clock follows the file to another
 *  machine, which is what a personal local calendar wants. */
function icsTime(ms: number, allDay: boolean): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
	return allDay ? date : `${date}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** The ISO form ical.js's own parsers accept ("2026-09-19T09:30:00"). */
function isoLocal(ms: number, allDay: boolean): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	return allDay ? date : `${date}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseComponent(text: string): ICAL.Component {
	try {
		// ICAL.parse("") succeeds with an empty jCal, and a nameless parent
		// leaves property types unresolved: every later write dies with
		// "reading 'length'". Anything that is not a real VCALENDAR is treated
		// as a fresh calendar instead.
		const comp = new ICAL.Component(ICAL.parse(text));
		return comp.name === "vcalendar" ? comp : new ICAL.Component(ICAL.parse(emptyIcs()));
	} catch {
		return new ICAL.Component(ICAL.parse(emptyIcs()));
	}
}

function findVevent(comp: ICAL.Component, uid: string, recurrenceIdMs?: number, allDay = false): ICAL.Component | null {
	for (const ev of comp.getAllSubcomponents("vevent")) {
		const u = ev.getFirstPropertyValue("uid");
		if (typeof u !== "string" || u !== uid) continue;
		if (recurrenceIdMs == null) {
			if (ev.getFirstProperty("recurrence-id")) continue; // an override, not the master
			return ev;
		}
		const rid = ev.getFirstProperty("recurrence-id");
		if (!rid) continue;
		const raw = rid.getFirstValue();
		if (!(raw instanceof ICAL.Time)) continue;
		// A RECURRENCE-ID can be written as Z, floating, or with TZID; compare
		// the absolute instant instead of the literal serialized form. Date
		// values compare by wall-clock day because they carry no time zone.
		if (allDay) {
			const expected = new Date(recurrenceIdMs);
			if (raw.isDate && raw.year === expected.getFullYear() && raw.month === expected.getMonth() + 1 && raw.day === expected.getDate()) return ev;
		} else if (!raw.isDate && raw.toJSDate().getTime() === recurrenceIdMs) {
			return ev;
		}
	}
	return null;
}

/** The shared field writer. Keeps UIDs stable, refreshes DTSTAMP, and never
 *  touches RRULE: a series' rule survives every occurrence edit. */
function fillVevent(ev: ICAL.Component, rec: LocalEventRecord): void {
	const setProp = (name: string, value: string | null) => {
		const existing = ev.getFirstProperty(name);
		if (value == null) {
			if (existing) ev.removeProperty(existing);
			return;
		}
		if (!existing) {
			const prop = new ICAL.Property(name, ev);
			ev.addProperty(prop);
			prop.setValue(value);
		} else {
			existing.setValue(value);
		}
	};
	setProp("uid", rec.uid);
	setProp("summary", rec.title || "(no title)");
	setTime("dtstart", rec.startMs, rec.allDay);
	setTime("dtend", rec.endMs, rec.allDay);
	const duration = ev.getFirstProperty("duration");
	if (duration) ev.removeProperty(duration);
	setProp("location", rec.location || null);
	setProp("description", rec.description || null);
	setUtc("dtstamp");
	setUtc("last-modified");
	if (rec.repeat) {
		try {
			let prop = ev.getFirstProperty("rrule");
			if (!prop) {
				prop = new ICAL.Property("rrule", ev);
				ev.addProperty(prop);
			}
			prop.setValue(ICAL.Recur.fromString(rec.repeat));
		} catch {
			/* an unreadable rule is skipped rather than failing the write */
		}
	}

	function setTime(name: string, ms: number, allDay: boolean) {
		let prop = ev.getFirstProperty(name);
		if (!prop) {
			prop = new ICAL.Property(name, ev);
			ev.addProperty(prop);
		}
		if (allDay) {
			prop.setParameter("value", "date");
			prop.setValue(ICAL.Time.fromDateString(isoLocal(ms, true)));
		} else {
			prop.removeParameter("value");
			prop.setValue(ICAL.Time.fromDateTimeString(isoLocal(ms, false)));
		}
	}

	function setUtc(name: string) {
		let prop = ev.getFirstProperty(name);
		if (!prop) {
			prop = new ICAL.Property(name, ev);
			ev.addProperty(prop);
		}
		prop.setValue(ICAL.Time.fromJSDate(new Date(), true));
	}
}

/** Add or update one VEVENT. When the record carries a repeat rule a new
 *  VEVENT becomes a series master; an existing one keeps its own rule. */
export function upsertIcsEvent(existing: string, rec: LocalEventRecord): string {
	const comp = parseComponent(existing);
	let target = findVevent(comp, rec.uid);
	if (!target) {
		target = new ICAL.Component("vevent");
		comp.addSubcomponent(target);
	}
	fillVevent(target, rec);
	return comp.toString();
}

/** Write one occurrence override (RECURRENCE-ID) for a recurring series.
 *  The override repeats the master's UID; readers pair them up. */
export function upsertIcsOverride(existing: string, uid: string, recurrenceIdMs: number, rec: LocalEventRecord, recurrenceIdAllDay = rec.allDay): string {
	const comp = parseComponent(existing);
	let target = findVevent(comp, uid, recurrenceIdMs, recurrenceIdAllDay);
	if (!target) {
		target = new ICAL.Component("vevent");
		comp.addSubcomponent(target);
		target.addPropertyWithValue("uid", uid);
		const rid = new ICAL.Property("recurrence-id", target);
		if (rec.allDay) {
			rid.setParameter("value", "date");
			rid.setValue(ICAL.Time.fromDateString(isoLocal(recurrenceIdMs, true)));
		} else {
			rid.setValue(ICAL.Time.fromDateTimeString(isoLocal(recurrenceIdMs, false)));
		}
		target.addProperty(rid);
	}
	fillVevent(target, { ...rec, uid });
	return comp.toString();
}

/** Remove the whole series: the master and every override sharing the UID. */
export function removeIcsEvent(existing: string, uid: string): string | null {
	const comp = parseComponent(existing);
	const before = comp.getAllSubcomponents("vevent").length;
	const kept = comp.getAllSubcomponents("vevent").filter((ev) => {
		const u = ev.getFirstPropertyValue("uid");
		return !(typeof u === "string" && u === uid);
	});
	if (kept.length === before) return null;
	comp.removeAllSubcomponents("vevent");
	for (const ev of kept) comp.addSubcomponent(ev);
	return comp.toString();
}

/** Remove just one occurrence override. Null when there was none. */
export function removeIcsOccurrence(existing: string, uid: string, recurrenceIdMs: number, allDay: boolean): string | null {
	const comp = parseComponent(existing);
	const target = findVevent(comp, uid, recurrenceIdMs, allDay);
	if (!target) return null;
	comp.removeSubcomponent(target);
	return comp.toString();
}

/** RRULE value for the editor's repeat menu, anchored on the start date. */
export function rruleOf(kind: string, startMs: number): string | null {
	if (kind === "daily") return "FREQ=DAILY";
	if (kind === "weekdays") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
	if (kind === "weekly") return `FREQ=WEEKLY;BYDAY=${RRULE_DOW[new Date(startMs).getDay()]}`;
	if (kind === "monthly") return "FREQ=MONTHLY";
	if (kind === "yearly") return "FREQ=YEARLY";
	return null;
}

/** A fresh UID: random hex in UUID shape, so id splitting stays safe. */
export function newIcsUid(): string {
	const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}@ambernyadesk`;
}
