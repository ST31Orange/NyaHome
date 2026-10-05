/**
 * NyaLingo back end for NyaHome translation.
 *
 * Migration target (v5.1.2): NyaHome no longer owns engine configuration.
 * It keeps only UI-level toggles (enabled / auto-translate / languages) and
 * delegates the actual request to the shared NyaLingo plugin through
 * `app.plugins.getPlugin("nyalingo")`. If NyaLingo is not installed we keep
 * the MTranServer fallback so existing users are not left without a service.
 *
 * This module implements the same `ITranslationServiceV1` surface, so the
 * orchestration layer (TranslationManager) is unchanged.
 */
import { ITranslationServiceV1, TranslationTextResult } from "./types";

/** The public API NyaHome relies on from NyaLingo (mirrors nyalingo main.ts). */
export interface NyaLingoApiLike {
	translate(text: string, opts?: { from?: string; to?: string; html?: boolean }): Promise<string>;
	healthCheck(): Promise<boolean>;
}

export interface NyaLingoProviderOptions {
	/** Resolves the NyaLingo plugin instance; null means not installed/enabled. */
	getLingo: () => NyaLingoApiLike | null;
}

export class NyaLingoTranslationService implements ITranslationServiceV1 {
	readonly version = "v1" as const;

	/** NyaLingo owns its endpoint configuration, so NyaHome must not require one. */
	readonly needsEndpoint = false as const;

	constructor(private readonly opts: NyaLingoProviderOptions) {}

	async translateText(text: string, html: boolean, from: string, to: string): Promise<TranslationTextResult> {
		const lingo = this.opts.getLingo();
		if (!lingo || typeof lingo.translate !== "function") {
			throw new Error(
				"NyaLingo is not installed or not enabled. Enable translation in the NyaLingo plugin settings, or set a local MTranServer endpoint."
			);
		}
		const translatedText = await lingo.translate(text, { from, to, html });
		return { translatedText, fromCache: false };
	}

	async healthCheck(): Promise<boolean> {
		const lingo = this.opts.getLingo();
		if (!lingo || typeof lingo.healthCheck !== "function") return false;
		try {
			return await lingo.healthCheck();
		} catch {
			return false;
		}
	}
}
