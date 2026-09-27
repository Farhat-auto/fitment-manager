import * as React from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, InlineStack, Select, Text } from "@shopify/polaris";

type ClassificationValue = { value: string; label: string };
type ProductClassificationState = {
  category: ClassificationValue;
  systemGroup: ClassificationValue;
  subcategory: ClassificationValue;
};

type Opt = { value: string; label: string };
type ClassificationSystemGroupRow = Opt & { parentCategoryId?: string };
type ClassificationSubcategoryRow = Opt & { systemGroupId?: string };

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function normalizeSystemGroupRows(raw: unknown): ClassificationSystemGroupRow[] {
  const out: ClassificationSystemGroupRow[] = [];
  const seen = new Set<string>();
  for (const item of safeArray<any>(raw)) {
    if (!item || typeof item !== "object") continue;
    const value = String(item.value ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: String(item.label ?? value).trim() || value,
      parentCategoryId: String(item.parentCategoryId ?? "").trim(),
    });
  }
  return out;
}

function normalizeSubcategoryRows(raw: unknown): ClassificationSubcategoryRow[] {
  const out: ClassificationSubcategoryRow[] = [];
  const seen = new Set<string>();
  for (const item of safeArray<any>(raw)) {
    if (!item || typeof item !== "object") continue;
    const value = String(item.value ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: String(item.label ?? value).trim() || value,
      systemGroupId: String(item.systemGroupId ?? "").trim(),
    });
  }
  return out;
}

function filterSpuriousCatalogRows<T extends Opt>(rows: T[] | undefined): T[] {
  return (safeArray(rows) as T[]).filter((r) => {
    if (!r || typeof r.value !== "string") return false;
    const lb = String(r.label ?? "").trim().toLowerCase();
    if (lb === "all system groups" || lb === "all subcategories" || lb === "all categories") return false;
    return true;
  });
}

function withCurrentSelectValue(
  options: Array<{ label: string; value: string }>,
  value: string,
  label: string,
): Array<{ label: string; value: string }> {
  const current = String(value || "").trim();
  if (!current) return options;
  if (options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: String(label || current).trim() || current }];
}

export function ProductClassification({
  productGid,
  classification,
  categories,
}: {
  productGid: string;
  classification: ProductClassificationState;
  categories: ClassificationValue[];
}) {
  const revalidator = useRevalidator();
  const classificationFetcher = useFetcher();
  const [classificationMsg, setClassificationMsg] = React.useState<string | null>(null);
  const [classCategory, setClassCategory] = React.useState(() => String(classification?.category?.value ?? ""));
  const [classSystemGroup, setClassSystemGroup] = React.useState(() => String(classification?.systemGroup?.value ?? ""));
  const [classSubcategory, setClassSubcategory] = React.useState(() => String(classification?.subcategory?.value ?? ""));
  const [allSystemGroups, setAllSystemGroups] = React.useState<ClassificationSystemGroupRow[]>([]);
  const [allSubcategories, setAllSubcategories] = React.useState<ClassificationSubcategoryRow[]>([]);
  const [classificationLinkage, setClassificationLinkage] = React.useState<{
    storeHasParentLinks?: boolean;
    storeHasSystemGroupLinks?: boolean;
    totalSystemGroupsInStore?: number;
    systemGroupsShown?: number;
    totalSubcategoriesInStore?: number;
    subcategoriesShown?: number;
  }>({});

  React.useEffect(() => {
    const cat = String(classification?.category?.value ?? "").trim();
    const sg = String(classification?.systemGroup?.value ?? "").trim();
    const sub = String(classification?.subcategory?.value ?? "").trim();
    setClassCategory(cat);
    setClassSystemGroup(sg);
    setClassSubcategory(sub);
    if (cat) {
      const fd = new FormData();
      fd.set("_intent", "classification_system_groups");
      fd.set("category", cat);
      classificationFetcher.submit(fd, { method: "post" });
    }
    if (sg) {
      const fd = new FormData();
      fd.set("_intent", "classification_subcategories");
      fd.set("systemGroup", sg);
      classificationFetcher.submit(fd, { method: "post" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revalidator.state, productGid]);

  React.useEffect(() => {
    const d: any = classificationFetcher.data;
    if (!d) return;
    if (d.ok === true && Array.isArray(d.systemGroups)) {
      setAllSystemGroups(normalizeSystemGroupRows(d.systemGroups));
    }
    if (d.ok === true && Array.isArray(d.subcategories)) {
      setAllSubcategories(normalizeSubcategoryRows(d.subcategories));
    }
    if (d.ok === true && d.classificationLinkage && typeof d.classificationLinkage === "object") {
      setClassificationLinkage((prev) => ({ ...prev, ...(d.classificationLinkage as Record<string, unknown>) }));
    }
    if (d.ok === true && d.mode === "classification_saved") {
      const sync = d.classificationSync as
        | {
            incompleteKeys?: boolean;
            graphqlErrors?: string[];
            keyMetafieldUserErrors?: Array<{ message?: string }>;
          }
        | undefined;
      let msg = "Classification saved.";
      if (sync?.incompleteKeys) {
        const ge = Array.isArray(sync.graphqlErrors) ? sync.graphqlErrors.filter(Boolean).join("; ") : "";
        msg +=
          " Catalog key metafields (catalog_*_key) may be incomplete — check metaobject slug/handle and Shopify Admin API logs.";
        if (ge) msg += ` Details: ${ge}`;
      }
      const ku = sync?.keyMetafieldUserErrors;
      if (Array.isArray(ku) && ku.length) {
        const first = ku.map((x) => String(x?.message ?? "").trim()).filter(Boolean)[0];
        if (first) msg += ` Metafield definition issue: ${first}`;
      }
      setClassificationMsg(msg);
      revalidator.revalidate();
    }
    if (d.ok === false) {
      setClassificationMsg(String(d.error || "Failed to save classification"));
    }
  }, [classificationFetcher.data, revalidator]);

  const visibleSystemGroups = React.useMemo(() => {
    if (!String(classCategory || "").trim()) return [];
    return filterSpuriousCatalogRows(
      safeArray<ClassificationSystemGroupRow>(allSystemGroups).filter((g) => g && typeof g.value === "string"),
    );
  }, [allSystemGroups, classCategory]);

  const visibleSubcategories = React.useMemo(() => {
    if (!String(classSystemGroup || "").trim()) return [];
    return filterSpuriousCatalogRows(
      safeArray<ClassificationSubcategoryRow>(allSubcategories).filter((s) => s && typeof s.value === "string"),
    );
  }, [allSubcategories, classSystemGroup]);

  React.useEffect(() => {
    const sg = String(classSystemGroup || "").trim();
    if (!sg || !visibleSystemGroups.length) return;
    const ok = visibleSystemGroups.some((g) => g.value === sg);
    if (!ok && classificationLinkage.storeHasParentLinks === true && (classificationLinkage.systemGroupsShown ?? 0) > 0) {
      setClassSystemGroup("");
      setClassSubcategory("");
      setAllSubcategories([]);
    }
  }, [visibleSystemGroups, classSystemGroup, classificationLinkage.storeHasParentLinks, classificationLinkage.systemGroupsShown]);

  React.useEffect(() => {
    const sub = String(classSubcategory || "").trim();
    if (!sub || !visibleSubcategories.length) return;
    const ok = visibleSubcategories.some((s) => s.value === sub);
    if (!ok && classificationLinkage.storeHasSystemGroupLinks === true && (classificationLinkage.subcategoriesShown ?? 0) > 0) {
      setClassSubcategory("");
    }
  }, [visibleSubcategories, classSubcategory, classificationLinkage.storeHasSystemGroupLinks, classificationLinkage.subcategoriesShown]);

  React.useEffect(() => {
    if (!String(classCategory || "").trim()) setClassificationLinkage({});
  }, [classCategory]);

  const classificationIdle = classificationFetcher.state === "idle";
  const loadingSystemGroups =
    !classificationIdle &&
    String((classificationFetcher as any).submission?.formData?.get("_intent") || "").trim() ===
      "classification_system_groups";
  const loadingSubcategories =
    !classificationIdle &&
    String((classificationFetcher as any).submission?.formData?.get("_intent") || "").trim() ===
      "classification_subcategories";
  const showSystemGroupLinkageWarning =
    !!String(classCategory || "").trim() &&
    classificationIdle &&
    !loadingSystemGroups &&
    (classificationLinkage.storeHasParentLinks === false ||
      (classificationLinkage.storeHasParentLinks === true && visibleSystemGroups.length === 0));
  const showSubcategoryLinkageWarning =
    !!String(classSystemGroup || "").trim() &&
    classificationIdle &&
    !loadingSubcategories &&
    (classificationLinkage.storeHasSystemGroupLinks === false ||
      (classificationLinkage.storeHasSystemGroupLinks === true && visibleSubcategories.length === 0));

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingMd">
          Product Classification
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Category → System Group → Sub-category is merchandising only. It is not vehicle identity.
        </Text>
        {showSystemGroupLinkageWarning ? (
          <Banner tone="warning" title="Catalog hierarchy">
            <p>Some system groups are not linked to this category yet.</p>
            <p style={{ marginTop: 8 }}>
              In Shopify <strong>Settings → Custom data</strong>, ensure each <code>catalog_system_group</code>{" "}
              references the correct <code>catalog_main_category</code>.
            </p>
          </Banner>
        ) : null}
        {showSubcategoryLinkageWarning ? (
          <Banner tone="warning" title="Catalog hierarchy">
            <p>Some sub-categories are not linked to this system group yet.</p>
            <p style={{ marginTop: 8 }}>
              Ensure each <code>catalog_subcategory</code> references its parent <code>catalog_system_group</code>.
            </p>
          </Banner>
        ) : null}
        {classificationMsg ? (
          <Banner
            title={String(classificationMsg).toLowerCase().includes("saved") ? "Saved" : "Classification"}
            tone={String(classificationMsg).toLowerCase().includes("saved") ? "success" : "critical"}
            onDismiss={() => setClassificationMsg(null)}
          >
            <p>{classificationMsg}</p>
          </Banner>
        ) : null}
        <InlineStack gap="300" wrap>
          <Select
            label="Category"
            options={withCurrentSelectValue(
              [
                { label: "Select category", value: "" },
                ...safeArray<ClassificationValue>(categories)
                  .filter((o) => o && (o.value != null || o.label != null))
                  .map((o) => ({
                    label: String(o.label ?? o.value ?? ""),
                    value: String(o.value ?? ""),
                  })),
              ],
              classCategory,
              String(classification?.category?.label ?? ""),
            )}
            value={classCategory}
            onChange={(v) => {
              const next = String(v || "").trim();
              setClassCategory(next);
              setClassSystemGroup("");
              setClassSubcategory("");
              setAllSystemGroups([]);
              setAllSubcategories([]);
              setClassificationLinkage({});
              if (next) {
                const fd = new FormData();
                fd.set("_intent", "classification_system_groups");
                fd.set("category", next);
                classificationFetcher.submit(fd, { method: "post" });
              }
            }}
            helpText={
              loadingSystemGroups
                ? "Loading system groups…"
                : showSystemGroupLinkageWarning
                  ? "No system groups are linked to this category until metaobject parents are set."
                  : undefined
            }
            disabled={classificationFetcher.state !== "idle"}
          />
          <Select
            label="System Group"
            options={withCurrentSelectValue(
              [
                { label: "Select system group", value: "" },
                ...visibleSystemGroups.map((o) => ({
                  label: String(o.label ?? o.value ?? ""),
                  value: String(o.value ?? ""),
                })),
              ],
              classSystemGroup,
              String(classification?.systemGroup?.label ?? ""),
            )}
            value={classSystemGroup}
            onChange={(v) => {
              const next = String(v || "").trim();
              setClassSystemGroup(next);
              setClassSubcategory("");
              setAllSubcategories([]);
              if (next) {
                const fd = new FormData();
                fd.set("_intent", "classification_subcategories");
                fd.set("systemGroup", next);
                classificationFetcher.submit(fd, { method: "post" });
              }
            }}
            helpText={
              loadingSubcategories
                ? "Loading sub-categories…"
                : showSubcategoryLinkageWarning
                  ? "No sub-categories are linked to this system group until metaobject parents are set."
                  : undefined
            }
            disabled={!classCategory || classificationFetcher.state !== "idle"}
          />
          <Select
            label="Sub-category"
            options={withCurrentSelectValue(
              [
                { label: "Select sub-category", value: "" },
                ...visibleSubcategories.map((o) => ({
                  label: String(o.label ?? o.value ?? ""),
                  value: String(o.value ?? ""),
                })),
              ],
              classSubcategory,
              String(classification?.subcategory?.label ?? ""),
            )}
            value={classSubcategory}
            onChange={(v) => setClassSubcategory(String(v || "").trim())}
            disabled={!classSystemGroup || classificationFetcher.state !== "idle"}
          />
          <Button
            onClick={() => {
              const pid = String(productGid || "").trim();
              if (!pid) {
                setClassificationMsg("Missing product id. Reload and try again.");
                return;
              }
              setClassificationMsg(null);
              const fd = new FormData();
              fd.set("_intent", "classification_save");
              fd.set("product_gid", pid);
              fd.set("category", classCategory);
              fd.set("systemGroup", classSystemGroup);
              fd.set("subcategory", classSubcategory);
              classificationFetcher.submit(fd, { method: "post" });
            }}
            disabled={
              !classCategory ||
              !classSystemGroup ||
              !classSubcategory ||
              classificationFetcher.state !== "idle"
            }
            loading={
              classificationFetcher.state !== "idle" &&
              ((classificationFetcher as any).submission?.formData?.get("_intent") as any) === "classification_save"
            }
          >
            Save Classification
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
