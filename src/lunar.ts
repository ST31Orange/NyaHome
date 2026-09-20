import solarLunar from "solarlunar";

/** What a calendar cell shows beside its Gregorian date: the day name for
 *  ordinary dates, a solar term for term days, and the festival name on
 *  top of everything else. */
export interface LunarTag {
	text: string;
	kind: "festival" | "term" | "day";
}

const SOLAR_FESTIVALS: Record<string, string> = {
	"1-1": "元旦",
	"3-8": "妇女节",
	"3-12": "植树节",
	"5-1": "劳动节",
	"5-4": "青年节",
	"6-1": "儿童节",
	"7-1": "建党节",
	"8-1": "建军节",
	"9-10": "教师节",
	"10-1": "国庆节",
};

const LUNAR_FESTIVALS: Record<string, string> = {
	"1-1": "春节",
	"1-15": "元宵",
	"5-5": "端午",
	"7-7": "七夕",
	"8-15": "中秋",
	"9-9": "重阳",
	"12-8": "腊八",
};

const cache = new Map<string, LunarTag | null>();

/** The lunar label for a day key (YYYY-MM-DD): the festival name when the
 *  day carries one, else the solar term, else the lunar day name. Memoized
 *  per session; one conversion per distinct day at most. */
export function lunarTag(key: string): LunarTag | null {
	const hit = cache.get(key);
	if (hit !== undefined) return hit;
	let out: LunarTag | null = null;
	try {
		const y = +key.slice(0, 4);
		const m = +key.slice(5, 7);
		const d = +key.slice(8, 10);
		const solar = solarLunar.solar2lunar(y, m, d);
		if (solar && solar !== -1) {
			// festivals belong to the ordinary month; a leap 腊月's last day
			// is treated as an ordinary day rather than 除夕
			const lunarKey = solar.isLeap ? "" : `${solar.lMonth}-${solar.lDay}`;
			const newYearEve = !solar.isLeap && solar.lMonth === 12 && solar.lDay === solarLunar.monthDays(solar.lYear, 12);
			const festival = SOLAR_FESTIVALS[`${m}-${d}`] ?? LUNAR_FESTIVALS[lunarKey] ?? (newYearEve ? "除夕" : "");
			if (festival) out = { text: festival, kind: "festival" };
			else if (solar.isTerm && solar.term) out = { text: solar.term, kind: "term" };
			else out = { text: solar.dayCn, kind: "day" };
		}
	} catch {
		out = null;
	}
	cache.set(key, out);
	return out;
}
