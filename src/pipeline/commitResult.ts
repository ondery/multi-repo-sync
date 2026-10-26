export interface CommitObservation {
  before?: string;
  after?: string;
  hadChanges: boolean;
}

export type CommitDecision = 'ok' | 'skipped' | 'cancelled';

export function commitWasCreated(before: string | undefined, after: string | undefined): boolean {
  return typeof after === 'string' && after.length > 0 && after !== before;
}

export function interpretCommitResult(observation: CommitObservation): CommitDecision {
  if (commitWasCreated(observation.before, observation.after)) {
    return 'ok';
  }
  if (!observation.hadChanges) {
    return 'skipped';
  }
  return 'cancelled';
}
