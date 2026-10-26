export interface GraphInput {
  hash: string;
  parents: string[];
}

export interface GraphLayoutRow {
  hash: string;
  lane: number;
  parentLanes: number[];
  through: number[];
  fromAbove: boolean;
  laneCount: number;
}

export function layoutGraph(commits: readonly GraphInput[]): GraphLayoutRow[] {
  const rows: GraphLayoutRow[] = [];
  let next: Array<string | undefined> = [];

  for (const commit of commits) {
    const active = next.slice();
    let lane = active.indexOf(commit.hash);
    const fromAbove = lane !== -1;
    if (lane === -1) {
      const free = active.findIndex(hash => hash === undefined);
      if (free === -1) {
        lane = active.length;
        active.push(commit.hash);
      } else {
        lane = free;
        active[lane] = commit.hash;
      }
    }

    const through: number[] = [];
    for (let index = 0; index < active.length; index++) {
      if (index !== lane && active[index]) {
        through.push(index);
      }
    }

    const upcoming = active.slice();
    const parentLanes: number[] = [];
    if (commit.parents.length === 0) {
      upcoming[lane] = undefined;
    } else {
      commit.parents.forEach((parent, parentIndex) => {
        if (parentIndex === 0) {
          const existing = upcoming.findIndex((hash, index) => index !== lane && hash === parent);
          if (existing !== -1) {
            upcoming[lane] = undefined;
            parentLanes.push(existing);
          } else {
            upcoming[lane] = parent;
            parentLanes.push(lane);
          }
          return;
        }
        const existing = upcoming.indexOf(parent);
        if (existing !== -1) {
          parentLanes.push(existing);
          return;
        }
        const free = upcoming.findIndex(hash => hash === undefined);
        if (free === -1) {
          upcoming.push(parent);
          parentLanes.push(upcoming.length - 1);
        } else {
          upcoming[free] = parent;
          parentLanes.push(free);
        }
      });
    }

    while (upcoming.length > 0 && upcoming[upcoming.length - 1] === undefined) {
      upcoming.pop();
    }

    const uniqueParents: number[] = [];
    for (const parentLane of parentLanes) {
      if (!uniqueParents.includes(parentLane)) {
        uniqueParents.push(parentLane);
      }
    }

    const width = Math.max(active.length, upcoming.length, lane + 1, 1);
    rows.push({
      hash: commit.hash,
      lane,
      parentLanes: uniqueParents,
      through,
      fromAbove,
      laneCount: width,
    });
    next = upcoming;
  }

  const laneCount = rows.reduce((max, row) => Math.max(max, row.laneCount, ...row.parentLanes.map(lane => lane + 1)), 1);
  return rows.map(row => ({ ...row, laneCount }));
}
