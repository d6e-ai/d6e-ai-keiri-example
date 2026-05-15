# d6e-ai-keiri-example

An example AI accounting application that demonstrates how to build a thin
frontend on top of the [d6e](https://github.com/d6e-ai/d6e) platform's
`/api/workflows/execute-by-intent` endpoint.

The goal of this repository is to serve as a reference implementation that
covers the full integration story: a SvelteKit UI, a small server-side proxy
for the d6e API, a workspace bootstrap script for the AI prompt, and the
related documentation — all in one place.

## Status

Initial implementation is in progress. The first feature PR adds the
SvelteKit application, the d6e API proxy, the workspace bootstrap script,
and the operator documentation. See the open issues and pull requests for
the latest status.

## Concept

This application is modeled after a mock design (Google Workspace inspired)
where the user uploads receipt images and an AI assistant produces
freee-compatible journal entries:

1. The user uploads one or more receipt images on the AI journal page.
2. The frontend forwards each file to d6e's storage API, then asks d6e to
   produce a structured journal entry by calling
   `POST /api/workflows/execute-by-intent`.
3. The response is parsed as a strict JSON contract enforced through a
   workspace-level prompt rule and rendered as a read-only journal table.
4. To revise an entry, the user submits a natural-language correction; the
   previous JSON is re-sent to d6e together with the correction so the LLM
   regenerates the entry.

The repository deliberately stays within the "thin integration" scope so it
remains small enough for one engineer to read end-to-end. A roadmap for the
full integration (d6e-auth login, multi-workspace support, dedicated STFs,
persistent task storage) is documented under `docs/migration-to-full-integration.md`
once the first PR lands.

## Planned Tech Stack

- [SvelteKit](https://svelte.dev/docs/kit) + [Svelte 5](https://svelte.dev/docs/svelte) (Runes)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn-svelte](https://www.shadcn-svelte.com/)
- [Paraglide](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) for i18n (`ja-JP`, `en-US`)
- [@lucide/svelte](https://lucide.dev/) for icons
- [@sveltejs/adapter-vercel](https://svelte.dev/docs/kit/adapter-vercel)

## Related Links

- Reference mock (Google Workspace inspired): <https://ai-keiri-design-google-workspace.pages.dev/>
- Reference mock (b/E style): <https://ai-keiri-design-front.pages.dev/>
- Upstream d6e platform: <https://github.com/d6e-ai/d6e>
- Sibling reference frontend: <https://github.com/d6e-ai/d6e-construction-frontend>

## License

Proprietary - d6e AI, Inc.
