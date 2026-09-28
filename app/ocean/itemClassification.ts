export type ClassRow = {
  value: string;
  label: string;
  parentId?: string;
};

export function sameMetaobjectId(left: string, right: string) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const aId = a.split("/").pop() || "";
  const bId = b.split("/").pop() || "";
  return Boolean(aId && bId && aId === bId);
}

/** Child rows for a chosen parent. Unlinked catalogues stay selectable instead of going blank. */
export function rowsForParent(rows: ClassRow[], parentId: string) {
  const parent = String(parentId || "").trim();
  if (!parent) return { rows: [] as ClassRow[], unlinked: false };
  const linked = rows.some((row) => String(row.parentId || "").trim());
  if (!linked) return { rows: rows.slice(), unlinked: true };
  return {
    rows: rows.filter((row) => sameMetaobjectId(String(row.parentId || ""), parent)),
    unlinked: false,
  };
}

export function withCurrentRow(rows: ClassRow[], value: string, label: string) {
  const current = String(value || "").trim();
  if (!current) return rows;
  if (rows.some((row) => sameMetaobjectId(row.value, current))) return rows;
  return [{ value: current, label: label || current }, ...rows];
}
