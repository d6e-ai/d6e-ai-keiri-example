// Shared helpers used across the app.
// - cn(): combine class names with tailwind-merge (same convention as
//   shadcn-svelte). Use this whenever conditional Tailwind classes meet.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Format an integer JPY amount with a thousand-separator.
 * Used in both the pending task list and the generated journal table.
 */
export function formatJpyAmount(value: number): string {
	return value.toLocaleString('ja-JP');
}
