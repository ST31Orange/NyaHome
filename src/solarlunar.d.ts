// The library ships declarations, but its package exports do not point at
// them; this keeps TypeScript pointed at the API we actually use.
declare module "solarlunar" {
	export interface SolarLunarResult {
		lYear: number;
		lMonth: number;
		lDay: number;
		dayCn: string;
		isLeap: boolean;
		isTerm: boolean;
		term: string;
	}

	const solarLunar: {
		monthDays(year: number, month: number): number;
		solar2lunar(year?: number, month?: number, day?: number): SolarLunarResult | -1;
	};

	export default solarLunar;
}
