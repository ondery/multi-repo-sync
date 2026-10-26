export class RunSession {
  private readonly values = new Map<string, string>();

  async once(key: string, ask: () => Thenable<string | undefined>): Promise<string | undefined> {
    const existing = this.values.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const value = await ask();
    if (value === undefined) {
      return undefined;
    }
    this.values.set(key, value);
    return value;
  }
}
