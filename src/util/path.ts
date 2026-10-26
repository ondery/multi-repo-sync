import * as path from 'path';

export function normalizeKey(root: string): string {
  const normalized = path.normalize(root);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function sameRoot(a: string, b: string): boolean {
  return normalizeKey(a) === normalizeKey(b);
}

export function repoLabel(root: string): string {
  const base = path.basename(root);
  return base || root;
}

export function labelsFor(roots: readonly string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const root of roots) {
    const base = repoLabel(root);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const root of roots) {
    const base = repoLabel(root);
    const duplicate = (counts.get(base) ?? 0) > 1;
    const parts = root.split(/[\\/]/).filter(Boolean);
    const qualified = parts.slice(-2).join('/');
    labels.set(normalizeKey(root), duplicate ? qualified || base : base);
  }
  return labels;
}

export function relativePath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..')) {
    return path.basename(filePath);
  }
  return relative.split(path.sep).join('/');
}
