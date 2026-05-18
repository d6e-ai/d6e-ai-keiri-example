# OAuth と複数ファイルアップロード対応

サーバー固定 `D6E_REFRESH_TOKEN` を捨ててユーザーログイン必須の OAuth2 Authorization Code Flow（d6e-auth）に切り替え、ワークスペース非メンバーを no-access 画面で停止させる。あわせて領収書ファイルのアップロードを複数ファイル対応にし、ユーザーが明示的に「実行」ボタンを押すまで `execute-by-intent` を発火しないようにする。

## ゴール

1. 全 d6e API 呼び出しを「ログインユーザー本人のアクセストークン」で実行する。サーバー固定 `D6E_REFRESH_TOKEN` は廃止。
2. ログイン時に `D6E_WORKSPACE_ID` の所属を `GET /api/v1/workspaces/{id}` で確認し、非メンバーは固定文言の `/auth/no-access` に止める。
3. 領収書アップロードを複数ファイル化。ファイル選択 → d6e に即アップロード（fileId 取得）。`/api/intent` は「実行」ボタン押下時のみ発火。リストからの削除は d6e Storage DELETE も実行。

## 認証フロー

```mermaid
sequenceDiagram
    participant U as User
    participant App as keiri-app (SvelteKit)
    participant Auth as d6e-auth (www.d6e.ai)
    participant API as b-button.d6e.ai

    U->>App: GET / (no cookie)
    App-->>U: 302 /auth/login
    U->>App: GET /auth/login
    App->>App: generate state, set auth-oauth-state cookie
    App-->>U: 302 D6E_AUTH_URL/auth/login?client_id&redirect_uri&state
    U->>Auth: email+password or Google
    Auth->>Auth: insert authorization_code
    Auth-->>U: 302 redirect_uri?code&state
    U->>App: GET /auth/callback?code&state
    App->>App: verify state cookie
    App->>Auth: POST /api/v1/auth/token (authorization_code grant)
    Auth-->>App: access_token + refresh_token
    App->>API: GET /api/v1/workspaces/{D6E_WORKSPACE_ID}
    alt 200 member
        App-->>U: Set-Cookie auth-access, auth-refresh; 302 /
    else 403/404
        App-->>U: 302 /auth/no-access
    end
```

## 主な変更点

### 1. 環境変数

`.env.example` を更新:

- 削除: `D6E_REFRESH_TOKEN`
- 追加:
  - `D6E_AUTH_URL=https://www.d6e.ai`
  - `D6E_AUTH_CLIENT_ID`, `D6E_AUTH_CLIENT_SECRET`（d6e-auth の `registered_client` に事前登録した値）
  - `D6E_AUTH_REDIRECT_URI`（例: `http://localhost:5173/auth/callback` または本番 URL。`registered_client.redirectUris` に登録要）
- `src/lib/server/env.ts`: `getD6eRefreshToken` を削除し `getD6eAuthUrl`, `getD6eAuthClientId`, `getD6eAuthClientSecret`, `getD6eAuthRedirectUri` を追加。

### 2. OAuth サーバー側基盤（新規）

- `src/lib/server/oauth.ts`: Authorize URL 構築、`POST D6E_AUTH_URL/api/v1/auth/token` でのコード交換／リフレッシュ、CSRF state の生成・検証ヘルパ。
- `src/lib/server/session.ts`: HTTP-only cookie（`auth-access`, `auth-refresh`, `auth-oauth-state`）読み書きと、JWT `exp` を見ての自動リフレッシュ（`hooks.server.ts` から呼ぶ）。
- `src/lib/server/d6e-token.ts`: 固定リフレッシュ方式を撤廃。`getAccessToken(event)` が `event.locals.accessToken` を返すだけの薄いゲッタに置き換える。

### 3. 認証ルート（新規）

- `src/routes/auth/login/+server.ts`: state を生成 → cookie へ保存 → `D6E_AUTH_URL/auth/login?client_id&redirect_uri&state` に 302。
- `src/routes/auth/callback/+server.ts`: state 検証 → token 交換 → `GET ${D6E_BASE_URL}/api/v1/workspaces/${D6E_WORKSPACE_ID}` で membership 確認 → 200 なら cookie 保存して `/` へ、403/404 なら `/auth/no-access` へ。
- `src/routes/auth/logout/+server.ts`: cookie をクリアして `/auth/login` へ。
- `src/routes/auth/no-access/+page.svelte`: 固定文言「ワークスペース管理者にお問い合わせください」のみ表示。i18n。

### 4. hooks.server.ts（新規）

- 未ログイン (`auth-access` cookie 無し) で `/auth/*` 以外にアクセス → `/auth/login?returnTo=` に 302。
- cookie の access token が exp 近接なら `auth-refresh` で自動リフレッシュ → 失敗時は cookie クリアして `/auth/login` に。
- `event.locals.user` と `event.locals.accessToken` を注入。`src/app.d.ts` に型追加。

### 5. d6e-client.ts のトークン受け渡し

`src/lib/server/d6e-client.ts` の全関数（`uploadFile`, `deleteFile`, `executeByIntent`, `chatSessionsRequest` 系）を `accessToken: string` 引数化し、内部の `getAccessToken()` 呼び出しを廃止。`invalidateAccessToken()` 経由の 1-shot リトライも撤去（cookie 側でリフレッシュ済みのため）。

呼び出し側の更新:

- `src/routes/api/upload/+server.ts`: `event.locals.accessToken` を渡す。さらに新規 `DELETE /api/upload/[fileId]` を追加し、フロントからの「実行前にファイル削除」要求を d6e Storage DELETE に転送。
- `src/routes/api/intent/+server.ts`: 同様に `event.locals.accessToken` を渡す。
- `src/routes/+page.server.ts`, `src/routes/tasks/+page.server.ts` の `fetchChatSessionsForCaller`: locals 経由に変更。

### 6. 複数ファイル UI

- `src/lib/components/receipt-uploader.svelte`: `<input multiple>` 化、callback を `onfiles: (files: File[]) => void` に変更。
- `src/lib/components/uploaded-file-list.svelte`（新規）: アップロード済みファイルのチップ表示。各行に削除ボタン（クリック時に `DELETE /api/upload/{fileId}` → ローカルリストからも除外）。
- `src/routes/+page.svelte`:
  - 状態を `uploadedRefs: UploadedFileRef[]`, `pendingUploads: Map<localId, progress>`, `isExecuting` の 3 系統に分離。
  - ファイル選択 → 並列で `POST /api/upload` → 完了したものから `uploadedRefs` に追加。
  - 「実行」ボタンは `uploadedRefs.length > 0 && pendingUploads.size === 0 && !isExecuting` で活性化。押下時に全 fileRef を `inputFileRefs[]` に並べて `/api/intent` を 1 回だけ呼ぶ。
  - 修正コメントによる再生成も同じ `uploadedRefs` 全体を再送（仕様確認結果に従う）。

### 7. サイドバー / ナビ

- `src/lib/components/app-sidebar.svelte`: SSR 経由で受け取ったユーザー名を表示。最下部に「ログアウト」リンク（`/auth/logout` への form POST）。仕訳セッション一覧は現状通りワークスペース全員分を表示（既存挙動維持）。

### 8. i18n

`messages/ja-JP.json` と `messages/en-US.json` の両方を更新:

- 新規キー: `auth_login_title`, `auth_login_description`, `auth_login_button`, `auth_no_access_title`, `auth_no_access_body`, `auth_logout`, `auth_user_label`
- 新規キー: `journal_upload_run_button`, `journal_upload_remove`, `journal_upload_uploading`, `journal_upload_run_hint`

### 9. scripts / docs

- `scripts/init-workspace.mjs`: 開発者向けスクリプトなので、引き続き固定トークン方式を許容するが、env 名を `D6E_INIT_REFRESH_TOKEN` にリネームしてエンドユーザーの `auth-refresh` cookie と区別する（README に明記）。
- `README.md`, `docs/d6e-api-integration.md`, `docs/workspace-setup.md`: OAuth フローと redirect_uri 事前登録手順を追記。

## デザイン上の判断

- **State は HTTP-only cookie**: SvelteKit のサーバーアクションのみで cookie を扱うため XSS 経由の窃取耐性が高い。
- **Bearer 認証も Cookie 認証も同じ `auth-access` トークンを使う**: d6e の chat-sessions エンドポイントは `Cookie: auth-token=` を要求する（既存実装の通り）。`d6e-client` 側で必要に応じて両方の形式に変換する既存ロジックを残す。
- **Membership 確認は callback で 1 回だけ**: 毎リクエスト確認は重いので、ログイン時のみ確認して以後は cookie のトークン有効期限内は再確認しない。403 が返った場合は 401 と同様にログアウト相当にする（後段 d6e API 側でも弾かれる）。
- **アクセストークン期限切れ自動リフレッシュ**: `hooks.server.ts` で exp - 60s を切ったら refresh、失敗時はログアウト相当。
- **ファイル即アップロード方式**: 「実行」まで保留すると Service Worker 等で巨大な File をメモリに抱える時間が長くなるため、選択直後に d6e へ送ってフロントは fileId だけ保持する設計とする。

## 制限事項 / 注意

- d6e-auth の `registered_client.redirectUris` への redirect_uri 登録（ローカル開発用 + 本番用）は d6e-auth 管理者作業として PR の docs に記載するのみ。
- 既存の `chat_session` 行は workspace 単位で共有しているため、ログイン後も他メンバーが作った仕訳タスクが見える（要件と整合）。
- d6e-auth のログイン UI は SvelteKit 側からスタイル制御できないため、外観差分は不可避（仕様）。
