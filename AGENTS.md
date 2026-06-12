# Agent Rules

## チャットと言語

- ユーザーへの返信は日本語、ソースコード内のコメントは英語が基本。コメントを日本語で書く場合も意図と制約が伝わるよう簡潔に。

## Frontend (SvelteKit + Svelte 5)

- すべて Svelte 5 Runes 構文を使う。`export let` は禁止。
- イベントハンドラは `onclick` 形式 (`on:click` ではない)。
- スタイリングは Tailwind CSS v4 (`src/routes/layout.css` のトークン)。条件付き class は `cn()` から組み立てる。
- アイコンは `@lucide/svelte` を使い、`XxxIcon` という命名で import する。
- フォーム / バリデーション / 構造化データは `zod` で扱う。
- i18n は Paraglide。文言は `messages/ja-JP.json` (base) と `messages/en-US.json` の双方を更新する。

### Design style

各ページコンポーネントは次の骨格を保つ:

```svelte
<div class="space-y-8 p-6 lg:p-10">
  <section class="space-y-2">
    <h1></h1>
    <p></p>
  </section>
  <section class="space-y-4">
    <h2></h2>
    <!-- ... -->
  </section>
</div>
```

## ファイル先頭コメント

- 新規 `.ts` / `.mjs` の先頭には英語コメントで「目的」「主な仕様」「制限事項」を 3〜10 行で書く。
- `.svelte` ファイルは `<script lang="ts">` の **中** に同じ要領で書く (タグの前に書くと描画されてしまう)。

## エラーハンドリング

- 例外時は関数名と関連パラメータをメッセージに含める。サーバー側のログは `[<module>]` プレフィックスを付ける。
- ネットワークやストレージ呼び出しの失敗は `try/catch` で受け、ユーザー向けには日本語の短いメッセージ、ログには英語で詳細を残す。

## d6e API 呼び出し

- ブラウザから直接 d6e API を叩かない。常に本アプリ内の `/api/upload` または `/api/intent` を経由する。
- 共通 fetch ラッパは `src/lib/server/d6e-client.ts`。新しいエンドポイントを増やすときは同ファイルにヘルパを追加する。
- 環境変数は `src/lib/server/env.ts` の `requireEnv` 経由で読む。

## LLM プロンプトの変更

- LLM 出力契約は `scripts/prompts/ai-keiri-prompt.md` が単一情報源。変更後は `npm run init` を再実行する。
- スキーマを変えるときは `src/lib/journal-schema.ts` (Zod) と `docs/llm-output-contract.md` も同じ PR で更新する。

## コミットメッセージ

- 英語のみ。AI 由来の署名や "Made with X" の類は付けない。

## Agent Skills (`skills/`)

- `skills/<skill-name>/SKILL.md` 形式で 3 つの Agent Skill を同梱している (`d6e-auth-integration` / `d6e-workspace-api-client` / `d6e-prompt-driven-ui`)。インストールは `npx skills add https://gitlab.com/d6e-ai/d6e-ai-keiri-example --skill <name>` で行う (リポジトリは GitLab に移行済み。GitHub の `owner/repo` 省略記法は github.com に展開されるため使えない)。
- 各 `SKILL.md` は本リポジトリの実装 (`src/lib/server/**`, `src/routes/auth/**`, `src/routes/api/**`, `scripts/prompts/**` など) を参照リンクで指す。実装側を変えたら該当 `SKILL.md` の説明 / リンクも同 PR で更新する。
- YAML frontmatter (`name` / `description`) は英語必須。`description` には「トリガフレーズ」(when to use) を含め、skills CLI の検索や Cursor の `@skills` ピッカーでヒットしやすい文面にする。
- Skill 本文は英語ベース。トリガ例だけ日本語と英語を併記して多言語チャット利用者をカバーする。
