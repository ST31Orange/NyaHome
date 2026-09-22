import { TranslationEventBus, TranslationEventMap, TranslationEventHandler, TranslationEventName } from "./types";

/** Tiny typed event bus. It has no platform dependency, so either the host or
 *  a test can inject it and translation never needs to know about views. */
export class SimpleTranslationEventBus implements TranslationEventBus {
	private handlers = new Map<TranslationEventName, Set<TranslationEventHandler<TranslationEventName>>>();

	on<Event extends TranslationEventName>(event: Event, handler: TranslationEventHandler<Event>): () => void {
		const set = this.handlers.get(event) ?? new Set();
		set.add(handler as TranslationEventHandler<TranslationEventName>);
		this.handlers.set(event, set);
		return () => set.delete(handler as TranslationEventHandler<TranslationEventName>);
	}

	emit<Event extends TranslationEventName>(event: Event, payload: TranslationEventMap[Event]): void {
		for (const handler of Array.from(this.handlers.get(event) ?? [])) {
			try {
				void handler(payload);
			} catch (error) {
				// Event listeners must never break mail rendering or translation.
				console.warn(`NyaHome translation: an event listener failed for ${event}.`, error);
			}
		}
	}

	clear(): void {
		this.handlers.clear();
	}
}
