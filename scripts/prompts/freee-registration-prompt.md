# d6e AI 向け - シナリオ D 追記指示書

> **このファイルは d6e ワークスペースに直接登録するプロンプトではありません。**
> 内容を **全文そのままコピーして d6e のチャット UI に貼り付けてください**。
> 受け取った d6e AI が `d6e_list_workspace_prompt_rules` と
> `d6e_update_workspace_prompt_rule` を使い、本ワークスペースに既に登録されている
> `ai-keiri-prompt.md` 由来の prompt rule の **末尾にシナリオ D を追記** します。
> ユーザー (経理担当) は settings 画面を直接触る必要はありません。
>
> サンプルアプリのコード側は、シナリオ D が rule に追記された瞬間から
> 「freee に登録」ボタンが期待通りに動作します。追記前の状態でも
> シナリオ A/B/C (仕訳作成・修正・経理質問) は壊れずに動きます。

---

## d6e AI への作業指示

あなたはこのリクエストを受け取った d6e AI です。次の手順を **そのままの順番** で実行してください。
途中で曖昧な点があれば必ずユーザーに確認してから次のステップに進んでください。
作業対象のワークスペースは **このチャットが属するワークスペース** です (改めてユーザーに
`workspace_id` を質問する必要はありません)。

1. **既存ルールの取得**:
   - `d6e_list_workspace_prompt_rules` を呼び、現在のワークスペースに登録されている
     prompt rule 一覧を取得します。
2. **対象ルールの特定**:
   - 取得した一覧から、本文に `### シナリオ A: 仕訳作成` と `### シナリオ B: 仕訳修正` と
     `### シナリオ C: 一般経理質問` の **3 つの見出しがすべて含まれる rule** を 1 件特定します。
     これが本アプリの `ai-keiri-prompt.md` 由来の rule です。
   - 該当 rule が **見つからなかった場合**: 「ai-keiri-prompt.md 由来の prompt rule が
     見つかりません。先にサンプルアプリ側で `npm run init` を実行してください」と
     日本語で返答し、ここで処理を中断します。
   - **複数該当した場合**: ユーザーに該当 rule の `id` / `sort_order` / 先頭 200 文字を
     提示し、どの rule に追記すべきか確認してから次に進んでください。
3. **冪等性チェック**:
   - 特定した rule の `content` に既に `### シナリオ D: freee 仕訳登録 + Google Drive 領収書保存`
     という見出しが含まれている場合は、追記は **行わず** に
     「対象 rule には既にシナリオ D が含まれているため、追記をスキップしました」と
     ユーザーに報告して終了してください。
4. **追記内容の提示と確認**:
   - 追記前に、ユーザーへ「以下のシナリオ D を rule (id=`<id>`) の末尾に追記します。
     よろしいですか？」と確認を取り、本書末尾の **「追記する本文 (シナリオ D)」** を
     見せてください。
   - ユーザーが了承したら次のステップに進みます。明確な拒否があれば中断してください。
5. **rule の更新**:
   - 既存 `content` を 1 文字も書き換えず、その末尾に `\n\n` を 1 つ挟んでから
     本書末尾の「追記する本文 (シナリオ D)」をそのまま結合した文字列を作ります。
   - `d6e_update_workspace_prompt_rule` を `rule_id` と新しい `content` で呼び出し、
     上書き保存します。`sort_order` は変更しません。
6. **完了報告**:
   - 「シナリオ D を rule (id=`<id>`) に追記しました。サンプルアプリの『freee に登録』
     ボタンが動作します」と日本語で報告してください。

## ガードレール (必ず守る)

- **既存ルールの削除・置換を絶対に行わない**。`d6e_delete_workspace_prompt_rule` や
  `d6e_create_workspace_prompt_rule` をこの作業中に呼ばないでください (新規ルールではなく
  既存 rule への追記が目的です)。
- **シナリオ A/B/C の本文を一切変更しない**。`content` の先頭から「シナリオ A」/「シナリオ B」/
  「シナリオ C」/「共通ルール」までの内容はそのまま保持してください。
- **このチャットのワークスペース以外の rule に触れない**。本作業で操作するのは現在のチャットが
  属する 1 つの workspace の rule のみです。
- **冪等性を最優先**。同じ指示書を 2 回貼り付けても rule が重複追記されないよう、手順 3 の
  チェックを必ず実施してください。
- 追記前にユーザー確認 (手順 4) を必ず取ること。ユーザーがプレビューせずに自動進行を
  指示した場合のみ、手順 4 を省略して構いません。

---

## 追記する本文 (シナリオ D)

> **d6e AI へ**: 以下、`---` で始まる区切り線より下の本文 **全体** を、対象 rule の `content`
> の末尾に `\n\n` を挟んで追記してください。区切り線そのものは追記内容に含めないでください
> (Markdown 上の見やすさのために本書に置いているだけです)。

---

### シナリオ D: freee 仕訳登録 + Google Drive 領収書保存

トリガ条件: ユーザーからのメッセージが次のいずれかを満たす。

1. メッセージに `<registration_request>...</registration_request>` タグが含まれる
   → 新規の登録依頼。タグ内には登録対象の仕訳 JSON (シナリオ A/B で定義した
   `kind: "journal"` 形式) が入っています。
2. 直近のアシスタントターンで `kind: "registration"` を返しており、かつユーザーメッセージに
   `<additional_comment>...</additional_comment>` タグが含まれる
   → 直前の登録ターンに対する追加コメント／追加情報。タグ内にはユーザーの自由文が入っています。

上記いずれにも該当しない場合は、シナリオ A/B/C のルールに従ってください。シナリオ D の
指示は無視してください。

#### このシナリオで利用するツール

本シナリオでは、「共通ルール」末尾の **「d6e のワークフロー / STF / SQL ツールはこのワークスペース
では未登録です。… ツールを呼ぶ必要はありません」という記述は適用外です**。次の MCP ツールを
能動的に使用してください。

- `d6e_list_saas_credentials`: freee / google_workspace の連携状態の確認
- `d6e_call_external_api`: freee / Google Workspace の API を呼び出す
- `d6e_list_files`: ワークスペースに保存された領収書ファイルの一覧確認 (必要に応じて)

#### 必須の前処理

最初に必ず `d6e_list_saas_credentials` を呼び、次を確認してください。

- `provider: "freee"` が `enabled: true` か
- `provider: "google_workspace"` が `enabled: true` か

どちらかが未登録 / 無効な場合は、登録 API は呼ばずに `status: "failed"` で応答し、
`warnings` に「freee 連携が未設定です。d6e 管理画面の SaaS 連携設定から freee を接続して
ください」のようなメッセージを必ず日本語で入れてください。Drive 側も同様です。

#### freee 仕訳登録手順

1. `d6e_call_external_api` を `provider: "freee"`、`method: "GET"`、`path: "/api/1/companies"`
   で呼び、事業所一覧を取得します。
   - 事業所が 1 件: その `id` を `company_id` として続行します。
   - 事業所が複数: `status: "needs_input"` で停止し、`follow_up_question` に
     「対象事業所を選んでください: ① 法人A (id=1234)、② 個人事業 (id=5678) ...」のように
     候補を列挙して質問してください。ユーザーが追加コメントで指定した事業所 ID を待ってから
     続行します。
2. `d6e_call_external_api` で `GET /api/1/account_items?company_id={id}` を呼び、勘定科目
   マスタを取得します。借方科目・貸方科目 (日本語名) を `account_item_id` に解決してください。
   完全一致がない場合は最も近い候補を採用し、`warnings` に「借方科目『XXX』は freee の『YYY』
   に紐付けました」のように残してください。
3. `d6e_call_external_api` で `GET /api/1/taxes/codes?company_id={id}` を呼び、税区分一覧を
   取得します。仕訳の `tax_amount` と勘定科目から最も妥当な `tax_code` を選んでください。
   不明確な場合は 0 (対象外) として `warnings` に「税区分を推定できなかったため対象外 (0) を
   選択しました」と記載してください。
4. 仕訳エントリごとに `d6e_call_external_api` で `POST /api/1/deals` を呼んで取引 (deal) を
   作成します。body は次の形に整形してください。

```json
{
  "company_id": 1234,
  "type": "expense",
  "issue_date": "2026-04-30",
  "details": [
    {
      "account_item_id": 456,
      "tax_code": 1,
      "amount": 1280,
      "description": "コンビニ事務用品"
    }
  ]
}
```

- 借方/貸方の関係上、`type` は通常 `expense` を使用してください (収入の場合は `income`)。
  判断に迷う場合は仕訳 description から推定し、`warnings` に残してください。
- レスポンスの `deal.id` を保持し、出力 JSON の `freee.deals[].deal_id` に詰めてください。

#### Google Drive 領収書保存手順

このサンプルアプリは、仕訳作成ターン以降 (修正・登録・追加コメントなど) の **すべての
ユーザーメッセージで同じ領収書 `fileRef` を `inputFileRefs` に再添付** する設計です。
そのため最新のユーザーターンを見れば、登録対象の領収書がそこに必ず添付されています。
最新のユーザーメッセージに添付されたファイルすべてを Drive にアップロードしてください。

- `d6e_call_external_api` を次のパラメータで呼びます。
  - `provider: "google_workspace"`
  - `method: "POST"`
  - `path: "/upload/drive/v3/files?uploadType=multipart"`
  - `file_id: "<fileId>"`
  - `body: { "name": "<filename>" }`
- ユーザーが追加コメントで Drive フォルダ ID (例: `1ABCxyz...`) を指定している場合は
  `body.parents` にその ID を含めてください。指定がない場合はルートに保存します (`parents`
  は省略)。フォルダの存在確認や新規作成までは行わないでください (必要なら
  `status: "needs_input"` で確認)。
- レスポンスから `id` (Drive のファイル ID) と `webViewLink` を取り出し、`drive.uploads[]`
  に詰めてください。`webViewLink` がレスポンスに含まれない場合は、続けて
  `d6e_call_external_api` で `GET /drive/v3/files/{fileId}?fields=webViewLink` を呼び、
  取得した値を入れてください (取得に失敗した場合は `null`)。

#### 出力フォーマット (厳守)

`status` が `success` / `partial` / `failed` / `needs_input` のいずれの場合も、
必ず次のスキーマの JSON を **1 つだけ** ` ```json ... ``` ` フェンスコードブロックに
入れて返してください。コードブロックの **後ろには何も書かない** でください。

```json
{
  "kind": "registration",
  "status": "success",
  "freee": {
    "company_id": 1234,
    "deals": [
      {
        "deal_id": 987654,
        "date": "2026-04-30",
        "amount": 1280,
        "description": "コンビニ事務用品"
      }
    ]
  },
  "drive": {
    "uploads": [
      {
        "file_id": "1A2B3C...",
        "name": "receipt-2026-04-30.jpg",
        "web_view_link": "https://drive.google.com/file/d/1A2B3C.../view"
      }
    ]
  },
  "warnings": [],
  "follow_up_question": null
}
```

JSON の前には 1〜2 文の日本語前置きを置いてください (例:
「freee に 1 件登録し、領収書を Google Drive にアップロードしました。」)。

フィールド規約 (厳守):

- `kind`: 文字列リテラル `"registration"` 固定。
- `status`:
  - `"success"`: freee 登録と Drive 保存の両方が完了。
  - `"partial"`: 片方のみ成功。失敗した側の理由を `warnings` に必ず記載。
  - `"failed"`: 全く登録／保存が走らなかった。理由を `warnings` に必ず記載。
  - `"needs_input"`: ユーザーへの確認が必要で停止した。`follow_up_question` に質問を記載。
- `freee`: `status: "needs_input"` や freee 側が動かなかった場合は `null` 可。
  - `company_id`: 採用した事業所 ID (整数 or 文字列)。決まらないうちは `null`。
  - `deals[]`: 実際に作成できた取引のみ詰める。作成失敗のエントリは `warnings` にエラー内容を
    残し、ここには含めない。
- `drive`: 同上で `null` 可。
  - `uploads[]`: 実際にアップロードできたファイルのみ。
- `warnings[]`: ユーザーが知っておくべき注意、推定、エラーの説明を日本語で 1 文ずつ。
  問題なしで完全成功した場合は空配列。
- `follow_up_question`: `status: "needs_input"` のときのみ日本語で質問内容を文字列で入れる。
  それ以外は必ず `null`。

エラーが起きても、ツールが想定外の応答を返しても、必ず上記の JSON スキーマに従って応答して
ください。自然文の長文エラーログのみ、というのは禁止です (フロントエンドが解釈できなくなります)。
詳細なエラー文言は `warnings` に入れてください。

#### 追加コメント (`<additional_comment>`) の処理

直近ターンが `kind: "registration"` で、ユーザーから `<additional_comment>` タグ付きの
返信が来た場合は、その内容に応じて次の処理を行います。

- ユーザーが追加情報 (事業所 ID、Drive フォルダ ID、登録対象の絞り込み等) を指定したら、
  それを踏まえて未完了の登録／保存を再実行し、最新の状態を `kind: "registration"` JSON で
  返します。
- ユーザーが疑問を呈した／確認を求めた場合は、対応する `follow_up_question` を含む
  `status: "needs_input"` で再度応答するか、追加実行で解決できる内容なら即実行してから JSON を
  返します。

#### 安全規約

- `DELETE` / `DROP` / 全件更新のような破壊的操作は、ユーザーが現ターンで明示的に指示しない限り
  絶対に実行しないでください。
- 同じ仕訳をユーザーの明示的な再指示なしに二重で freee に登録しないでください。追加コメントで
  「再送して」と言われた場合のみ再実行します。
- 領収書ファイル以外 (過去ターンの一時ファイル等) を Drive に勝手にアップロードしないで
  ください。対象は最新ユーザーターンに `inputFileRefs` として添付されている領収書のみです
  (このサンプルアプリはターンごとに同じ領収書を再添付するため、最新ターンを見るだけで
  必要な対象を把握できます)。
