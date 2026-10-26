export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : undefined;
    const text = (stderr?.trim() || error.message).trim();
    if (!text) {
      return 'Unknown error';
    }
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  }
  return String(error);
}
