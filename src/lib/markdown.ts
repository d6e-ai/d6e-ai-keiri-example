// Markdown rendering utility for assistant messages.
//
// Mirrors the implementation used by the d6e frontend
// (packages/frontend/src/lib/utils/markdown.ts) so the visual output
// of `/ask` and the journal fallback view stays consistent with the
// chat UI on the d6e instance itself.
//
// Security notes:
//   - Inline HTML in the source markdown is escaped instead of being
//     passed through, so an LLM cannot smuggle script tags into the
//     page via its response.
//   - Link hrefs are validated against an allow-list of schemes
//     (http, https, mailto, tel). Unsafe schemes are stripped to the
//     plain link text.
//
// Output is HTML; callers should render it with `{@html ...}` inside
// a container that applies typography styles (e.g. the `prose` class
// from @tailwindcss/typography).

import { marked, Renderer } from 'marked';

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

const SAFE_URL_PATTERN = /^(?:https?|mailto|tel):/i;

const renderer = new Renderer();
renderer.html = function ({ text }: { text: string }): string {
	return escapeHtml(text);
};
renderer.link = function ({ href, title, tokens }): string {
	const text = this.parser.parseInline(tokens);
	if (href && !SAFE_URL_PATTERN.test(href)) {
		return text;
	}
	const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
	return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
};

export function renderMarkdown(content: string): string {
	try {
		return marked.parse(content, {
			async: false,
			breaks: true,
			gfm: true,
			renderer
		}) as string;
	} catch (err) {
		console.error(
			`[markdown] renderMarkdown failed; falling back to escaped text: ${err instanceof Error ? err.message : err}`
		);
		return escapeHtml(content);
	}
}
