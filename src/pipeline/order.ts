export type RunOrder = 'perRepository' | 'perOperation';

export interface RunStep<T extends string = string> {
  root: string;
  operation: T;
}

export function expandSteps<T extends string>(
  roots: readonly string[],
  operations: readonly T[],
  order: RunOrder,
): RunStep<T>[] {
  const steps: RunStep<T>[] = [];
  if (order === 'perOperation') {
    for (const operation of operations) {
      for (const root of roots) {
        steps.push({ root, operation });
      }
    }
    return steps;
  }
  for (const root of roots) {
    for (const operation of operations) {
      steps.push({ root, operation });
    }
  }
  return steps;
}

export function mergeOrder(saved: readonly string[] | undefined, catalog: readonly string[]): string[] {
  const known = new Set(catalog);
  const next: string[] = [];
  for (const id of saved ?? []) {
    if (known.has(id) && !next.includes(id)) {
      next.push(id);
    }
  }
  for (const id of catalog) {
    if (!next.includes(id)) {
      next.push(id);
    }
  }
  return next;
}

export function moveItem(order: readonly string[], id: string, direction: -1 | 1): string[] {
  const index = order.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) {
    return [...order];
  }
  const next = [...order];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function reorderBefore(
  order: readonly string[],
  moving: readonly string[],
  before: string | undefined,
): string[] {
  const movingIds = moving.filter((id, index) => order.includes(id) && moving.indexOf(id) === index);
  if (movingIds.length === 0) {
    return [...order];
  }
  if (before && movingIds.length === 1 && movingIds[0] === before) {
    return [...order];
  }
  const movingSet = new Set(movingIds);
  const rest = order.filter(id => !movingSet.has(id));
  let index = before ? rest.indexOf(before) : rest.length;
  if (index < 0) {
    index = rest.length;
  }
  rest.splice(index, 0, ...movingIds);
  return rest;
}

export function applyPreset(
  order: readonly string[],
  preset: readonly string[],
): { order: string[]; enabled: string[] } {
  const known = new Set(order);
  const selected: string[] = [];
  for (const id of preset) {
    if (known.has(id) && !selected.includes(id)) {
      selected.push(id);
    }
  }
  const selectedSet = new Set(selected);
  return {
    order: [...selected, ...order.filter(id => !selectedSet.has(id))],
    enabled: selected,
  };
}
