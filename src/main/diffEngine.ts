export interface DiffRow {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  leftLineNumber?: number;
  rightLineNumber?: number;
  leftContent: string;
  rightContent: string;
}

export interface DiffResult {
  rows: DiffRow[];
  hasDifferences: boolean;
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

export function runFileCompare(leftText: string | null, rightText: string | null): DiffResult {
  // Handle null/missing file cases
  if (leftText === null && rightText === null) {
    return {
      rows: [],
      hasDifferences: false,
      stats: { added: 0, removed: 0, modified: 0, unchanged: 0 },
    };
  }

  const leftLines = leftText !== null ? leftText.split(/\r?\n/) : [];
  const rightLines = rightText !== null ? rightText.split(/\r?\n/) : [];

  if (leftText === null) {
    const rows = rightLines.map((line, idx) => ({
      type: 'added' as const,
      rightLineNumber: idx + 1,
      leftContent: '',
      rightContent: line,
    }));
    return {
      rows,
      hasDifferences: true,
      stats: { added: rows.length, removed: 0, modified: 0, unchanged: 0 },
    };
  }

  if (rightText === null) {
    const rows = leftLines.map((line, idx) => ({
      type: 'removed' as const,
      leftLineNumber: idx + 1,
      leftContent: line,
      rightContent: '',
    }));
    return {
      rows,
      hasDifferences: true,
      stats: { added: 0, removed: rows.length, modified: 0, unchanged: 0 },
    };
  }

  // Run Myers Diff
  const rawDiff = myersDiff(leftLines, rightLines);
  
  // Format rawDiff into side-by-side rows with pairing of delete/insert into modified
  const rows: DiffRow[] = [];
  let leftLineNum = 1;
  let rightLineNum = 1;
  
  let i = 0;
  while (i < rawDiff.length) {
    const current = rawDiff[i];
    
    if (current.type === 'keep') {
      rows.push({
        type: 'unchanged',
        leftLineNumber: leftLineNum++,
        rightLineNumber: rightLineNum++,
        leftContent: current.val,
        rightContent: current.val,
      });
      i++;
    } else {
      // Gather consecutive deletes and inserts
      const deletes: string[] = [];
      const inserts: string[] = [];
      
      let j = i;
      while (j < rawDiff.length && rawDiff[j].type !== 'keep') {
        if (rawDiff[j].type === 'delete') {
          deletes.push(rawDiff[j].val);
        } else {
          inserts.push(rawDiff[j].val);
        }
        j++;
      }
      
      // Pair them up
      const maxLen = Math.max(deletes.length, inserts.length);
      const minLen = Math.min(deletes.length, inserts.length);
      
      for (let k = 0; k < maxLen; k++) {
        if (k < minLen) {
          // Pair delete & insert as 'modified'
          rows.push({
            type: 'modified',
            leftLineNumber: leftLineNum++,
            rightLineNumber: rightLineNum++,
            leftContent: deletes[k],
            rightContent: inserts[k],
          });
        } else if (k < deletes.length) {
          // Extra deletes are 'removed'
          rows.push({
            type: 'removed',
            leftLineNumber: leftLineNum++,
            leftContent: deletes[k],
            rightContent: '',
          });
        } else {
          // Extra inserts are 'added'
          rows.push({
            type: 'added',
            rightLineNumber: rightLineNum++,
            leftContent: '',
            rightContent: inserts[k],
          });
        }
      }
      
      i = j;
    }
  }

  // Calculate stats
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;
  
  for (const row of rows) {
    if (row.type === 'added') added++;
    else if (row.type === 'removed') removed++;
    else if (row.type === 'modified') modified++;
    else if (row.type === 'unchanged') unchanged++;
  }

  return {
    rows,
    hasDifferences: added > 0 || removed > 0 || modified > 0,
    stats: { added, removed, modified, unchanged },
  };
}

interface DiffOp {
  type: 'keep' | 'delete' | 'insert';
  val: string;
}

function myersDiff(a: string[], b: string[]): DiffOp[] {
  const N = a.length;
  const M = b.length;
  
  // Handle empty bounds immediately
  if (N === 0 && M === 0) return [];
  if (N === 0) return b.map(line => ({ type: 'insert' as const, val: line }));
  if (M === 0) return a.map(line => ({ type: 'delete' as const, val: line }));

  // Performance ceiling: if file is too large, use a simple line match to avoid freezing
  if (N + M > 8000) {
    return simpleLinearDiff(a, b);
  }

  const MAX = N + M;
  const V: { [key: number]: number } = { 1: 0 };
  const history: { [key: number]: { [key: number]: number } } = {};

  let x = 0;
  let y = 0;
  let found = false;

  for (let d = 0; d <= MAX; d++) {
    history[d] = { ...V };
    for (let k = -d; k <= d; k += 2) {
      if (k === -d || (k !== d && (V[k - 1] ?? -1) < (V[k + 1] ?? -1))) {
        x = V[k + 1] ?? 0;
      } else {
        x = (V[k - 1] ?? 0) + 1;
      }
      y = x - k;

      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }

      V[k] = x;

      if (x >= N && y >= M) {
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Backtrack
  const path: DiffOp[] = [];
  let currX = N;
  let currY = M;

  for (let d = Object.keys(history).length - 1; d >= 0; d--) {
    const prevV = history[d];
    if (!prevV) continue;

    const k = currX - currY;
    let prevK = 0;
    
    if (d === 0) break;

    if (k === -d || (k !== d && (prevV[k - 1] ?? -1) < (prevV[k + 1] ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = prevV[prevK] ?? 0;
    const prevY = prevX - prevK;

    while (currX > prevX && currY > prevY) {
      path.push({ type: 'keep', val: a[currX - 1] });
      currX--;
      currY--;
    }

    if (currX > prevX) {
      path.push({ type: 'delete', val: a[currX - 1] });
      currX--;
    } else if (currY > prevY) {
      path.push({ type: 'insert', val: b[currY - 1] });
      currY--;
    }
  }

  while (currX > 0 && currY > 0) {
    if (a[currX - 1] === b[currY - 1]) {
      path.push({ type: 'keep', val: a[currX - 1] });
      currX--;
      currY--;
    } else {
      path.push({ type: 'delete', val: a[currX - 1] });
      currX--;
    }
  }
  while (currX > 0) {
    path.push({ type: 'delete', val: a[currX - 1] });
    currX--;
  }
  while (currY > 0) {
    path.push({ type: 'insert', val: b[currY - 1] });
    currY--;
  }

  return path.reverse();
}

/**
 * Fallback simple linear comparison for extremely large files
 */
function simpleLinearDiff(a: string[], b: string[]): DiffOp[] {
  const path: DiffOp[] = [];
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < a.length && i < b.length) {
      if (a[i] === b[i]) {
        path.push({ type: 'keep', val: a[i] });
      } else {
        path.push({ type: 'delete', val: a[i] });
        path.push({ type: 'insert', val: b[i] });
      }
    } else if (i < a.length) {
      path.push({ type: 'delete', val: a[i] });
    } else {
      path.push({ type: 'insert', val: b[i] });
    }
  }
  return path;
}
