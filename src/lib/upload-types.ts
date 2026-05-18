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
