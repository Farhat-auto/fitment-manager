import * as React from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import { Banner, BlockStack, Button, Text, TextField } from "@shopify/polaris";
import { CatalogueArticleLink } from "./CatalogueArticleLink";

type SavePayload = {
  ok?: boolean;
  saved?: boolean;
  error?: string;
};

export function ItemInformation({
  productGid,
  shopifyProductId,
  shopifyVariantId,
  sku,
  brand,
  barcode,
  handle,
  initialMpn,
  initialArticleNumber,
  initialOe,
  initialCross,
  unmapped,
  onLinked,
}: {
  productGid: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  sku: string;
  brand: string;
  barcode: string;
  handle: string;
  initialMpn: string;
  initialArticleNumber: string;
  initialOe: string;
  initialCross: string;
  unmapped: boolean;
  onLinked: (listing: Record<string, unknown>) => void;
}) {
  const fetcher = useFetcher<SavePayload>();
  const revalidator = useRevalidator();
  const [mpn, setMpn] = React.useState(initialMpn);
  const [articleNumber, setArticleNumber] = React.useState(initialArticleNumber);
  const [oe, setOe] = React.useState(initialOe);
  const [cross, setCross] = React.useState(initialCross);
  const [notice, setNotice] = React.useState("");

  React.useEffect(() => {
    setMpn(initialMpn);
    setArticleNumber(initialArticleNumber);
    setOe(initialOe);
    setCross(initialCross);
  }, [productGid, initialMpn, initialArticleNumber, initialOe, initialCross]);

  React.useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.saved) {
      setNotice("Item information saved.");
      revalidator.revalidate();
      return;
    }
    if (fetcher.data.error) setNotice("");
  }, [fetcher.state, fetcher.data, revalidator]);

  const save = () => {
    setNotice("");
    fetcher.submit(
      {
        intent: "item_information",
        mpn,
        articleNumber,
        oe,
        cross,
      },
      { method: "POST", encType: "application/json" },
    );
  };

  const saving = fetcher.state !== "idle";
  const saveError = fetcher.data && fetcher.data.saved !== true ? fetcher.data.error : "";

  return (
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" tone="subdued">
        Fill the missing item fields. MPN, article number, OE, and cross references are saved from these boxes. The product title is not copied into them.
      </Text>
      <TextField label="MPN" value={mpn} autoComplete="off" onChange={setMpn} />
      <TextField label="Article number" value={articleNumber} autoComplete="off" onChange={setArticleNumber} />
      <TextField
        label="OE numbers"
        value={oe}
        multiline={4}
        autoComplete="off"
        helpText="One OE number per line."
        onChange={setOe}
      />
      <TextField
        label="Cross references"
        value={cross}
        multiline={3}
        autoComplete="off"
        helpText="One cross reference per line."
        onChange={setCross}
      />
      <Text as="p" variant="bodySm">Barcode {barcode || "—"} · brand {brand || "—"} · SKU {sku || "—"}</Text>
      {saveError ? <Banner tone="critical" title="Item information">{saveError}</Banner> : null}
      {notice ? <Banner tone="success" title="Item information">{notice}</Banner> : null}
      <Button variant="primary" loading={saving} onClick={save}>
        Save item information
      </Button>
      {unmapped ? (
        <CatalogueArticleLink
          shopifyProductId={shopifyProductId}
          shopifyVariantId={shopifyVariantId}
          sku={sku}
          brand={brand}
          mpn={mpn}
          barcode={barcode}
          handle={handle}
          articleNumber={articleNumber}
          oeText={oe}
          onLinked={onLinked}
        />
      ) : null}
    </BlockStack>
  );
}
