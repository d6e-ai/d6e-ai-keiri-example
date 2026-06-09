# d6e 概要紹介ドキュメント作成プラン

## 成果物

`docs/d6e-overview-ja.md`(日本語、Discord に GitHub リンクで共有する前提、Mermaid 図入り、A4 数枚相当)。

## 想定読者

既存 d6e インスタンスに `.env` 相当の認証情報で接続し、特化フロントエンドを開発する外部開発者。

## ドキュメント章構成

1. **冒頭注記**:Discord 本文では Mermaid 図がレンダリングされないため、GitHub の md リンクを貼って読んでもらう運用であることを明記する。
2. **d6e とは**:1〜2 段落で「自然言語でデータ操作・ワークフロー実行ができる AI ネイティブな業務プラットフォーム」「STF(JS/Docker)、Policy、Workflow、Workspace 分離」までを短く。出典は [d6e/README.md](https://github.com/d6e-ai/d6e/blob/main/README.md) と [d6e/CLAUDE.md](https://github.com/d6e-ai/d6e/blob/main/CLAUDE.md)。
3. **システム全体像**:Mermaid `flowchart` で構成図。各ボックスの役割を 1 行ずつ。出典は [d6e/compose.withdb.yml](https://github.com/d6e-ai/d6e/blob/main/compose.withdb.yml) と [d6e/packages/api/src/](https://github.com/d6e-ai/d6e/tree/main/packages/api/src)。
4. **接続方式(既存インスタンスへ `.env` 接続)**:OAuth2 二段階トークン交換のシーケンス図 + 必要環境変数。`D6E_BASE_URL` / `D6E_WORKSPACE_ID` / `D6E_AUTH_URL` / `D6E_AUTH_CLIENT_ID` / `D6E_AUTH_CLIENT_SECRET` / `D6E_AUTH_REDIRECT_URI` / `D6E_INIT_REFRESH_TOKEN` を [`.env.example`](../.env.example) を典拠に列挙。
5. **開発に使える主要エンドポイント**:箇条書きで以下を載せる。
   - Rust API (`/api/v1/*`、Bearer + `X-Workspace-ID`):workspaces / files / sql / stf / workflow / effect / policy / embedding / table_row_embedding 等([d6e/packages/api/src/routes/v1/](https://github.com/d6e-ai/d6e/tree/main/packages/api/src/routes/v1))
   - SvelteKit Frontend API (`/api/workflows/execute-by-intent`, `/api/chat-sessions`, `/api/workspace-prompt-rules`):このアプリが使っている 3 本を再掲。
   - Rust MCP Server (`/mcp`):AI クライアントから接続する想定。
   - WebSocket (`/ws`)([d6e/packages/api/src/routes/ws.rs](https://github.com/d6e-ai/d6e/blob/main/packages/api/src/routes/ws.rs))。
6. **ローカル Docker 起動(シークレットがあれば)**:「外部 DB を使う `compose.yml`」と「DB を含めて全部立てる `compose.withdb.yml`」の 2 モードを紹介。必要シークレット(`POSTGRES_PASSWORD`、`D6E_CONTAINER_TOKEN_SECRET`、`D6E_AUTH_CLIENT_ID/SECRET`、`AI_GATEWAY_API_KEY` 等)を [d6e/.env.example](https://github.com/d6e-ai/d6e/blob/main/.env.example) を典拠に列挙。
7. **参考実装**:「実際の特化フロントエンドの一例として d6e-ai-keiri-example がある」と紹介し、[`docs/architecture.md`](architecture.md)、[`docs/d6e-api-integration.md`](d6e-api-integration.md)、[`docs/workspace-setup.md`](workspace-setup.md) へのリンク。
8. **追加要望メモ(現状は未対応)**:末尾に箇条書きで簡潔に記載。
   - `skill2api`:`.claude/skills/*` を OpenAPI 化して `${D6E_BASE_URL}/{workspace}/api/v1/<skill-name>` で叩けるようにする構想。
   - `deploy-harness`:`npx d6e-deploy workspace=xxxx` で agent api server をワークスペース環境にデプロイする構想。現状の [d6e-deploy](https://github.com/d6e-ai/d6e-deploy) は SSH ベースのインスタンス更新スクリプトで別物。
   - ローカルテスト環境ツール(DB / ストレージ)。Layer X 風のイベントフック起動エージェントのアーキテクチャ参照([https://getaiworkforce.com/](https://getaiworkforce.com/))。

## 運用ルール

1. ブランチ `docs/d6e-overview-ja` を切る(済)。
2. 本プランを `.plans/d6e-overview-discord-doc.plan.md` として push。
3. `docs/d6e-overview-ja.md` を作成 → コミット → push。
4. PR を作成。Issue 起票はユーザー指示により省略するため `Closes #N` は不要。コミットメッセージ・PR タイトルは英語(ユーザールール準拠)、Cursor 署名は付けない。

## 守るべき制約

- 言語は日本語。コードコメント部のみ英語可。
- Mermaid は GitHub 上でレンダリングされる前提(過去 PR #16 / #17 で HTML エンティティ問題を修正済み。`;` ではなく `,` を使う)。
- 既存 docs と内容が重複する箇所は要約してリンクで誘導する。
- Discord 本文では Mermaid 図はレンダリングされないため、GitHub リンクを貼ってもらう運用を冒頭で明記する。
