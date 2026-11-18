import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeDeadline(iso: string | null | undefined): string {
  if (!iso) return 'No deadline';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return iso;
  const diffMs = target - Date.now();
  const absHours = Math.abs(diffMs) / (1000 * 60 * 60);
  if (absHours < 24) {
    const hrs = Math.round(absHours);
    return diffMs >= 0 ? `${hrs}h left` : `${hrs}h ago`;
  }
  const days = Math.round(absHours / 24);
  return diffMs >= 0 ? `${days}d left` : `${days}d ago`;
}

export function downloadMarkdownFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  text: string;
}

export function computeLineDiff(olderText: string, newerText: string): DiffLine[] {
  const oldLines = olderText.split(/\r?\n/);
  const newLines = newerText.split(/\r?\n/);
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const result: DiffLine[] = [];

  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    const a = oldLines[i];
    const b = newLines[j];
    if (a !== undefined && b !== undefined && a === b) {
      result.push({ type: 'unchanged', text: b });
      i += 1;
      j += 1;
    } else if (a !== undefined && !newSet.has(a)) {
      result.push({ type: 'removed', text: a });
      i += 1;
    } else if (b !== undefined && !oldSet.has(b)) {
      result.push({ type: 'added', text: b });
      j += 1;
    } else {
      if (a !== undefined) {
        result.push({ type: 'removed', text: a });
        i += 1;
      }
      if (b !== undefined) {
        result.push({ type: 'added', text: b });
        j += 1;
      }
    }
  }
  return result;
}
