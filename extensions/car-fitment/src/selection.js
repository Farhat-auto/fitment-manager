function readList(value) {
  if (value && typeof value.peek === "function") {
    try {
      // .value subscribes through shopify.setSignals. peek() does not, so a
      // selection that arrives after the first paint would stay invisible.
      const next = "value" in value ? value.value : value.peek();
      return readList(next);
    } catch (err) {
      return [];
    }
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && typeof value.length === "number") {
    try {
      return Array.prototype.slice.call(value);
    } catch (err) {
      return [];
    }
  }
  if (value && typeof value === "object" && value.id) return [value];
  return [];
}

function productIdFrom(row) {
  if (!row) return "";
  if (typeof row === "string") return row;
  return String(row.id || row.productId || "");
}

export function selectedProductIds(data) {
  const source = data || {};
  const ids = readList(source.selected).map(productIdFrom).filter(Boolean);
  if (ids.length) return ids;
  const single = productIdFrom(source.product || source.resource);
  return single ? [single] : [];
}
