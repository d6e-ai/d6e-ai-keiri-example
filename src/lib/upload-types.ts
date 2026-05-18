// Client-shared types for the multi-file receipt upload pipeline.
//
// Purpose:
//   Keep the queue / progress shapes in one place so +page.svelte and
//   uploaded-file-list.svelte agree on the wire format. Exporting them
//   from a .svelte file is brittle; a plain .ts module is safer.
//
// Main specifications:
//   - PendingUploadView: a file that has been picked but is still
//     being POSTed to /api/upload. errorMessage is populated only
//     when status === 'error'.
//   - UploadedFileView: the response shape /api/upload returns,
//     compatible with IntentInputFileRef on the server.

export interface PendingUploadView {
	localId: string;
	filename: string;
	status: 'uploading' | 'error';
	errorMessage?: string;
}

export interface UploadedFileView {
	fileId: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
}

/**
 * Runtime guard for the UploadedFileView shape. Shared by the AI Journal
 * page (which validates /api/upload responses before adding them to the
 * queue) and journal-task.ts (which validates inputFileRefs read back
 * from chat_session jsonb). The two contexts use different type names —
 * UploadedFileView vs IntentInputFileRef — but the shape is identical,
 * so a single guard keeps the field checks from drifting if a new field
 * is ever added to one side.
 */
export function isUploadedFileView(value: unknown): value is UploadedFileView {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.fileId === 'string' &&
		v.fileId.length > 0 &&
		typeof v.filename === 'string' &&
		typeof v.mimeType === 'string' &&
		typeof v.sizeBytes === 'number'
	);
}
