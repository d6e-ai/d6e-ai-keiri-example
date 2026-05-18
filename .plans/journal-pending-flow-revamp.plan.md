# 仕訳途中フロー再設計

AI 仕訳画面とタスク一覧画面の体験を整理し、「完了ボタン」「途中タスクの再開」「リロード復元」「タブ分割」の 4 点を満たす。
`feat/oauth-and-multi-upload` (PR #6) のマルチファイル + OAuth 基盤と、`main` の freee 登録 / Drive アップロード機能の両方を前提とする。

## ゴール

1. freee 登録に成功した仕訳 (`registration` の `status === 'success'`) で **完了ボタン**を出し、押下後は AI 仕訳画面を空状態に戻す。
2. 仕訳途中のカードをクリックして、`/?chatSessionId=<uuid>` の URL で AI 仕訳画面を**続きから開ける**ようにする。
3. リロードしても URL クエリから state を復元できるようにし、復元ファイルは UI 上に表示するが追加・差し替えは不可とする。
4. 「仕訳途中」セクションを `/` から削除し、`/tasks` を「仕訳途中」「完了」のタブ UI に統合する (デフォルトは仕訳途中)。

## ベースブランチ前提

- 既に `feat/oauth-and-multi-upload` 上で次の段階が完了している:
  - **段階 0**: `origin/main` のマージで PR #6 (OAuth + multi-file) と `main` (freee 登録) を共存させる。
  - **段階 1**: `parseResult !== null` の間は受領書を読み取り専用化、アップローダ・Generate ボタンを非表示にする。
- 本プラン (段階 2) は `feature/journal-pending-flow-revamp` を `feat/oauth-and-multi-upload` から切って実装する。

## データモデル

`chat_session.messages` の user UIMessage に `inputFileRefs` を埋め込む拡張のみ。既存の `{ id, role, parts: [{type:'text', text}] }` 形状は破壊しない。

```ts
interface ChatSessionUserMessage {
	id: string;
	role: 'user';
	parts: Array<{ type: 'text'; text: string }>;
	// New: optional list of IntentInputFileRef snapshots that were sent
	// alongside this user turn. Used to restore the upload list when
	// re-entering the page via ?chatSessionId=...
	inputFileRefs?: IntentInputFileRef[];
}
```

- 配列はターンごとに**スナップショット**として保持する (revise 時に再送した内容をそのまま記録)。
- 復元時は「**最も新しい inputFileRefs を持つ user メッセージ**」を採用する。これによりマルチファイル化後に増減があっても直近の構成を取り出せる。

## 状態の URL 同期

- ルーティング: `/?chatSessionId=<uuid>` で「このセッションを編集中」を表す。
- 初回フェッチ (SSR): `+page.server.ts` でクエリを読み取り、存在するなら d6e から chat_session を取得して `restoredSession` として返す。
- クライアント: `restoredSession` を初期 state にハイドレートする。
- `handleExecute` 等で新規に `currentChatSessionId` が確定したら `replaceState` で `?chatSessionId=...` を URL に反映 (履歴を増やさない)。
- 完了ボタンで state をリセットしたら `?chatSessionId` を URL から取り除く。

## 完了ボタン仕様

- 表示条件: `parseResult.kind === 'registration'` かつ `parseResult.result.status === 'success'`。
- 押下時:
  1. `PATCH /api/chat-sessions/{id}` でタイトルに `#completed` サフィックスを追加 (既存の `markCompletedTitle`)。
  2. クライアント state をリセット (`parseResult`, `currentChatSessionId`, `pendingUploads`, `uploadedRefs` を空に)。
  3. URL から `?chatSessionId` を削除。
  4. 「完了しました」バナーを一定時間表示。
- 「完了→未完了」の切り替えはこのフローでは扱わない (詳細ダイアログ側 / `/tasks` 側で従来通り行える)。

## タスク一覧の再構成

- `/` から「仕訳途中」セクションを撤去 (h2 + `<TaskCard>` リスト + `pendingTasksPromise` 関連の SSR を削除)。
- `/tasks` をタブ UI に改修:
  - クエリ `?status=pending|completed` でタブを切り替え (`pending` がデフォルト)。
  - SSR で 1 回 `fetchChatSessionsForCaller` を呼び、`toFilteredTasks` を pending / completed 双方に対して計算する。
  - 「仕訳途中」タブのカードクリックは `goto('/?chatSessionId=' + task.id)` で AI 仕訳画面に遷移。
  - 「完了」タブのカードクリックは従来通り `TaskDetailDialog` を開く。
- ナビゲーション (`AppSidebar`) のラベルを「タスク」など中立的なものに改名するかは UI 確認後に決定。

## 実装変更点

### 1. `src/lib/journal-task.ts`

- `extractLatestInputFileRefs(messages: ChatSessionMessage[]): IntentInputFileRef[]` を追加し、メッセージ配列を逆順に走査して `role==='user'` かつ `inputFileRefs` を持つ最初のエントリを返す。
- `JournalTaskSummary` に `uploadedRefs: IntentInputFileRef[]` を追加し、`deriveJournalTaskSummary` でセットする。
- 型定義は `IntentInputFileRef` を `$lib/server/d6e-client` から re-export するか、`upload-types.ts` の `UploadedFileView` と一致させる。

### 2. `src/routes/api/intent/+server.ts`

- `buildUserUiMessage` を `inputFileRefs` を受け取れるように拡張。空配列は省略。
- `persistTurn` の引数に `inputFileRefs` を追加し、既存メッセージへの append とともに最新スナップショットを保存する。
- 既存 chat_session の append (revise) でも常に「今回送った `inputFileRefs`」を保存する。

### 3. `src/lib/server/d6e-client.ts`

- `ChatSessionMessage` 型に `inputFileRefs?: IntentInputFileRef[]` を追加。
- 既存のメッセージ列を読み戻すとき (`getChatSessionById`) は素通しで OK。型のみ拡張。

### 4. `src/routes/+page.server.ts`

- `pendingTasks$` のストリーミングを撤去。
- クエリ `chatSessionId` を読み取り、存在すれば `getChatSessionById(...)` で取得して `restoredSession` (タイトル / 直近 assistant text / 直近 user inputFileRefs) を返す。
- 取得失敗時は `restoredSession = null` を返し、UI 側は新規セッションとして扱う。

### 5. `src/routes/+page.svelte`

- 「仕訳途中」セクションを撤去。
- `restoredSession` を起点に `pendingUploads = []`, `uploadedRefs = restored.inputFileRefs`, `currentChatSessionId = restored.id`, `parseResult = parseJournalMessage(restored.assistantText)` を初期化。
- `handleExecute` / `handleRevise` / `handleRegister` 成功時に `replaceState('/?chatSessionId=' + id)` で URL 同期。
- `handleComplete()` を追加:
  - `PATCH /api/chat-sessions/{id}` でタイトルに `#completed` を付ける。
  - クライアント state を初期化、URL をリセット。
  - 短時間バナー表示。
- 「完了しました」バナー用の i18n キーを追加。

### 6. `src/lib/components/registration-result.svelte`

- 新 props: `onComplete?: () => void | Promise<void>`, `completeDisabled?: boolean`, `completeInFlight?: boolean`。
- `status === 'success'` かつ `onComplete` 指定時のみ「完了にする」ボタンを表示。
- `JournalResult` (registration ブランチ) からプロップを中継する。

### 7. `src/routes/tasks/+page.server.ts` / `+page.svelte`

- SSR で 1 回フェッチした結果から pending / completed を両方 derive。
- クエリ `status=pending|completed` でタブを切り替え。デフォルトは `pending`。
- `pending` タブのカードクリックは `goto('/?chatSessionId=' + task.id)` で遷移。
- `completed` タブのカードクリックは従来の `TaskDetailDialog` を開く。
- タブヘッダー UI は Tailwind のシンプルな pill / underline で実装。

### 8. i18n キー (ja/en 同時)

- 完了ボタン / バナー / タブ用に以下のキーを追加:
  - `journal_complete_button`
  - `journal_complete_banner`
  - `tasks_tab_pending`, `tasks_tab_completed`
  - `tasks_description_pending`, `tasks_description_completed`
- 撤去するキーは無し (既存 `journal_pending_*` は `/tasks` の pending タブで再利用)。

## 実装順序 (チェックリスト)

- [x] 段階 0: `git merge origin/main` でコンフリクト解消 + push (force-push 禁止)。
- [x] 段階 1: `parseResult !== null` 時にアップローダ系をロック。
- [ ] 段階 2 開始: `feature/journal-pending-flow-revamp` を `feat/oauth-and-multi-upload` から切る。
- [ ] GitHub Issue を作成し、本 plan を Issue 本文 / コメントに貼る。
- [ ] `journal-task.ts` に `extractLatestInputFileRefs` + `uploadedRefs` 追加。
- [ ] `/api/intent` で `inputFileRefs` を user UIMessage に埋め込み保存。
- [ ] `/+page.server.ts` で `chatSessionId` クエリ復元 + `pendingTasks$` 撤去。
- [ ] `/+page.svelte` で state 復元 + URL 同期 + 完了ハンドラ + 仕訳途中セクション撤去。
- [ ] `registration-result.svelte` に完了ボタン UI 追加。
- [ ] `/tasks` をタブ UI に改修。
- [ ] i18n キー追加 (ja/en 同時)。
- [ ] `npm run check` をパス。
- [ ] PR を `feat/oauth-and-multi-upload` 宛に作成し、本文に `Closes #<issue>` を含める。

## 注意事項

- ブラウザから直接 d6e API を叩かない。常に SvelteKit の `/api/*` 経由。
- 環境変数は `requireEnv` 経由のみ。
- Svelte 5 Runes (`$state`, `$derived`, `$effect`, `$props`) を使う。`export let` 禁止。
- Tailwind v4 のトークン (`src/routes/layout.css`) と `cn()` を使う。
- すべてのユーザー向け文言は Paraglide 経由。`messages/ja-JP.json` (base) と `messages/en-US.json` を同時に更新。
- コミットメッセージは英語。AI 由来の署名は付けない。
- `force-push` 禁止。通常 push のみ。
