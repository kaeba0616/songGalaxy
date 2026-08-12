/**
 * 목록 순서 편집의 계산 — SSOT (docs/SSOT.md).
 * 드래그 UI와 서버 검증이 같은 규칙을 써야 하므로 여기 한 곳에만 둔다.
 */

/** from 자리의 항목을 빼서 to 자리에 끼운 새 배열. 원본은 건드리지 않는다 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 드래그한 세로 이동량으로 놓일 자리를 구한다.
 * 행 높이가 균일하다는 전제 — 목록의 모든 행이 같은 패딩·글꼴을 쓴다.
 * rowHeight가 0이면(아직 못 잼) 제자리를 준다. 0으로 나누면 NaN이 되어
 * 목록이 통째로 어긋난다.
 */
export function dropIndex(
  from: number,
  deltaY: number,
  rowHeight: number,
  count: number,
): number {
  if (rowHeight <= 0 || count <= 0) return from;
  const moved = Math.round(deltaY / rowHeight);
  return Math.min(Math.max(from + moved, 0), count - 1);
}

/**
 * 두 배열이 순서를 무시하고 같은 원소를 같은 개수만큼 갖는지.
 * Set 비교로는 [1,1,2]와 [1,2,2]를 구분하지 못하므로 정렬해서 비교한다.
 */
export function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}
