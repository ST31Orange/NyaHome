import { isWorkday } from "chinese-workday";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const restDayCache = new Map<string, boolean>();

function weekendFallback(dateKey: string): boolean {
	const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
	return weekday === 0 || weekday === 6;
}

/** Statutory holidays and ordinary weekends are rest days; weekend makeup
 *  workdays are not. Unsupported dates fall back to the weekend rule. */
export function isRestDay(dateKey: string): boolean {
	if (!DATE_KEY.test(dateKey)) return false;

	const cached = restDayCache.get(dateKey);
	if (cached !== undefined) return cached;

	let rest = false;
	try {
		rest = !isWorkday(dateKey);
	} catch {
		rest = weekendFallback(dateKey);
	}
	restDayCache.set(dateKey, rest);
	return rest;
}
