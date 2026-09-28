import * as React from "react";
import { useFetcher } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, Select, Text } from "@shopify/polaris";
import { rowsForParent, withCurrentRow, type ClassRow } from "../ocean/itemClassification";

type InitialClassification = {
  categoryId: string;
  categoryLabel: string;
  itemCategoryId: string;
  itemCategoryLabel: string;
  subcategoryId: string;
  subcategoryLabel: string;
};

type OptionsPayload = {
  ok?: boolean;
  error?: string;
  categories?: ClassRow[];
  itemCategories?: ClassRow[];
  subcategories?: ClassRow[];
};

type SavePayload = {
  ok?: boolean;
  saved?: boolean;
  error?: string;
  classificationSync?: {
    incompleteKeys?: boolean;
    keyMetafieldUserErrors?: unknown[];
    graphqlErrors?: string[];
  } | null;
};

function byLabel(left: ClassRow, right: ClassRow) {
  return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
}

function selectOptions(rows: ClassRow[], placeholder: string) {
  return [{ label: placeholder, value: "" }, ...rows.map((row) => ({ label: row.label, value: row.value }))];
}

export function ItemClassification({
  productGid,
  initial,
}: {
  productGid: string;
  initial: InitialClassification;
}) {
  const optionsFetcher = useFetcher<OptionsPayload>();
  const saveFetcher = useFetcher<SavePayload>();
  const [categoryId, setCategoryId] = React.useState(initial.categoryId || "");
  const [itemCategoryId, setItemCategoryId] = React.useState(initial.itemCategoryId || "");
  const [subcategoryId, setSubcategoryId] = React.useState(initial.subcategoryId || "");
  const [notice, setNotice] = React.useState("");
  const [noticeTone, setNoticeTone] = React.useState<"success" | "critical" | "warning">("success");
  const requested = React.useRef("");

  React.useEffect(() => {
    setCategoryId(initial.categoryId || "");
    setItemCategoryId(initial.itemCategoryId || "");
    setSubcategoryId(initial.subcategoryId || "");
    setNotice("");
  }, [productGid, initial.categoryId, initial.itemCategoryId, initial.subcategoryId]);

  React.useEffect(() => {
    if (!productGid || requested.current === productGid) return;
    requested.current = productGid;
    optionsFetcher.submit(
      { intent: "classification_options" },
      { method: "POST", encType: "application/json" },
    );
    // The fetcher identity changes after submit; the product id is the reload key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productGid]);

  React.useEffect(() => {
    if (saveFetcher.state !== "idle" || !saveFetcher.data) return;
    const data = saveFetcher.data;
    if (data.saved) {
      const sync = data.classificationSync;
      const keysMissing = Boolean(sync?.incompleteKeys || (sync?.keyMetafieldUserErrors || []).length);
      if (keysMissing) {
        setNoticeTone("warning");
        setNotice(
          "Shopify saved the category references, but the storefront category keys were not updated. "
          + (sync?.graphqlErrors || []).filter(Boolean).join(" "),
        );
      } else {
        setNoticeTone("success");
        setNotice("Item category saved.");
      }
      return;
    }
    if (data.error) {
      setNoticeTone("critical");
      setNotice(String(data.error));
    }
  }, [saveFetcher.state, saveFetcher.data]);

  const options = optionsFetcher.data?.ok ? optionsFetcher.data : null;
  const categories = React.useMemo(
    () => withCurrentRow((options?.categories || []).slice().sort(byLabel), categoryId, initial.categoryLabel),
    [options?.categories, categoryId, initial.categoryLabel],
  );
  const itemScope = rowsForParent(options?.itemCategories || [], categoryId);
  const itemCategories = React.useMemo(
    () => withCurrentRow(itemScope.rows.slice().sort(byLabel), itemCategoryId, initial.itemCategoryLabel),
    [itemScope.rows, itemCategoryId, initial.itemCategoryLabel],
  );
  const subScope = rowsForParent(options?.subcategories || [], itemCategoryId);
  const subcategories = React.useMemo(
    () => withCurrentRow(subScope.rows.slice().sort(byLabel), subcategoryId, initial.subcategoryLabel),
    [subScope.rows, subcategoryId, initial.subcategoryLabel],
  );
  const loadingOptions = optionsFetcher.state !== "idle" && !options;
  const saving = saveFetcher.state !== "idle";

  const save = () => {
    setNotice("");
    saveFetcher.submit(
      {
        intent: "classification_save",
        category: categoryId,
        itemCategory: itemCategoryId,
        subcategory: subcategoryId,
      },
      { method: "POST", encType: "application/json" },
    );
  };

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Item category</Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Choose the catalogue category and subcategory for this article. Saving writes the Shopify catalog
          fields the storefront category page uses. It does not verify vehicle fitment.
        </Text>
        {optionsFetcher.data && optionsFetcher.data.ok === false ? (
          <Banner tone="critical" title="Item category">
            {optionsFetcher.data.error || "Category list failed."}
          </Banner>
        ) : null}
        {notice ? (
          <Banner tone={noticeTone} title="Item category">
            {notice}
          </Banner>
        ) : null}
        {itemScope.unlinked && categoryId ? (
          <Banner tone="warning" title="Catalog hierarchy">
            Item categories are not linked to a parent category in Shopify yet, so the full list is shown.
          </Banner>
        ) : null}
        {subScope.unlinked && itemCategoryId ? (
          <Banner tone="warning" title="Catalog hierarchy">
            Subcategories are not linked to an item category in Shopify yet, so the full list is shown.
          </Banner>
        ) : null}
        <Select
          label="Category"
          disabled={loadingOptions}
          options={selectOptions(categories, loadingOptions ? "Loading categories" : "Select category")}
          value={categoryId}
          onChange={(value) => {
            setCategoryId(value);
            setItemCategoryId("");
            setSubcategoryId("");
          }}
        />
        <Select
          label="Item category"
          disabled={!categoryId || loadingOptions}
          options={selectOptions(itemCategories, "Select item category")}
          value={itemCategoryId}
          onChange={(value) => {
            setItemCategoryId(value);
            setSubcategoryId("");
          }}
        />
        <Select
          label="Subcategory"
          disabled={!itemCategoryId || loadingOptions}
          options={selectOptions(subcategories, "Select subcategory")}
          value={subcategoryId}
          onChange={setSubcategoryId}
        />
        <Button
          variant="primary"
          loading={saving}
          disabled={!categoryId || !itemCategoryId || !subcategoryId || saving}
          onClick={save}
        >
          Save item category
        </Button>
      </BlockStack>
    </Card>
  );
}
