// Mock data for the "pending" task cards shown on the AI Journal page and
// the "completed" task list shown on the /tasks page.
//
// The cards mirror the reference mock at
// https://ai-keiri-design-google-workspace.pages.dev/ - they have no real
// backing data yet. Replace these with d6e DB rows in the full integration
// (C-case) milestone described in docs/migration-to-full-integration.md.

export type TaskStatus = 'drive_unregistered' | 'pending_approval' | 'revising' | 'completed';

export interface JournalTask {
	id: string;
	status: TaskStatus;
	date: string;
	receiptCount: number;
	amountJpy: number;
	title: string;
	description: string;
}

export const pendingTasks: JournalTask[] = [
	{
		id: 'task-drive-001',
		status: 'drive_unregistered',
		date: '2026-04-30',
		receiptCount: 5,
		amountJpy: 19620,
		title: 'Google Drive に未登録の領収書が5枚あります',
		description: 'Drive 上の領収書候補を取り込み、AI 解析して freee 登録情報を確認できます。'
	},
	{
		id: 'task-pending-001',
		status: 'pending_approval',
		date: '2026-04-29',
		receiptCount: 3,
		amountJpy: 19620,
		title: '4月末の領収書確認',
		description: '3枚の領収書を解析済み。勘定科目と摘要を確認して承認できます。'
	},
	{
		id: 'task-revising-001',
		status: 'revising',
		date: '2026-04-26',
		receiptCount: 3,
		amountJpy: 19620,
		title: 'カフェ利用の科目確認',
		description: '接待交際費として扱うか、修正コメントから再生成できます。'
	}
];

export const completedTasks: JournalTask[] = [
	{
		id: 'task-completed-001',
		status: 'completed',
		date: '2026-04-15',
		receiptCount: 4,
		amountJpy: 28430,
		title: '4月前半の交通費・消耗品費',
		description: 'JR 定期更新分と備品購入分を freee に登録済み。'
	},
	{
		id: 'task-completed-002',
		status: 'completed',
		date: '2026-04-08',
		receiptCount: 2,
		amountJpy: 8800,
		title: '会議費の登録',
		description: 'クライアント打合せのカフェ利用 2 件を会議費で登録済み。'
	}
];
