import { requestUrl } from "obsidian";
import { HttpTransport } from "./types";

/** Obsidian transport adapter. Keeping it here is the only place translation
 *  touches the platform networking API. */
export function obsidianHttpTransport(): HttpTransport {
	return {
		async request(request) {
			const response = await requestUrl({
				url: request.url,
				method: request.method,
				headers: request.headers,
				body: request.body,
				throw: false,
			});
			return { status: response.status, body: response.text };
		},
	};
}
