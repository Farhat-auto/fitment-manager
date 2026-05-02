import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  json,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { useFetcher, useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import * as React from "react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  InlineStack,
  Banner,
  ResourceList,
  ResourceItem,
  Thumbnail,
  Divider,
  DropZone,
  LegacyStack,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ ok: true });
}

const SEARCH_PRODUCTS = `#graphql
  query SearchProducts($first: Int! = 10, $query: String!) {
    products(first: $first, query: $query) {
      nodes {
        id
        title
        handle
        featuredImage {
          url
          altText
        }
      }
    }
  }
`;

const GET_PRODUCT_IMAGES = `#graphql
  query GetProductImages($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      images(first: 50) {
        nodes {
          id
          url
          altText
        }
      }
    }
  }
`;

const UPDATE_IMAGE_ALT = `#graphql
  mutation UpdateImageAlt($id: ID!, $altText: String) {
    productImageUpdate(id: $id, image: { altText: $altText }) {
      image {
        id
        altText
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ADD_IMAGE_BY_URL = `#graphql
  mutation AddImageByUrl($productId: ID!, $url: URL!, $alt: String) {
    productCreateMedia(
      productId: $productId
      media: [{ originalSource: $url, mediaContentType: IMAGE, alt: $alt }]
    ) {
      media {
        ... on MediaImage {
          id
          image {
            id
            url
            altText
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const STAGED_UPLOADS_CREATE = `#graphql
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ADD_IMAGE_BY_RESOURCE_URL = `#graphql
  mutation AddImageByResourceUrl($productId: ID!, $resourceUrl: URL!, $alt: String) {
    productCreateMedia(
      productId: $productId
      media: [{ originalSource: $resourceUrl, mediaContentType: IMAGE, alt: $alt }]
    ) {
      media {
        ... on MediaImage {
          id
          image {
            id
            url
            altText
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const ADD_IMAGES_BY_RESOURCE_URLS = `#graphql
  mutation AddImagesByResourceUrls($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          image {
            id
            url
            altText
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { admin } = await authenticate.admin(request);
    const ct = request.headers.get("content-type") || "";
    const uploadHandler = unstable_createMemoryUploadHandler({
      maxPartSize: 25_000_000, // ~25MB
    });
    const fd =
      ct.toLowerCase().includes("multipart/form-data")
        ? await unstable_parseMultipartFormData(request, uploadHandler)
        : await request.formData();
    const intent = String(fd.get("_intent") || "").trim();
    const gqlErrorMessage = (data: any): string => {
      const errs = data?.errors;
      if (!Array.isArray(errs) || !errs.length) return "";
      const msgs = errs.map((e: any) => String(e?.message ?? "")).filter(Boolean);
      return msgs.join("; ");
    };

    if (intent === "product_search") {
      const q = String(fd.get("q") || "").trim();
      if (!q) return json({ ok: false, error: "Missing query" }, { status: 400 });
      const resp = await admin.graphql(SEARCH_PRODUCTS, { variables: { first: 10, query: q } });
      const data = await resp.json();
      const nodes = data?.data?.products?.nodes;
      return json({ ok: true, products: Array.isArray(nodes) ? nodes : [] });
    }

    if (intent === "load_images") {
      const productId = String(fd.get("product_id") || "").trim();
      if (!productId) return json({ ok: false, error: "Missing product_id" }, { status: 400 });
      const resp = await admin.graphql(GET_PRODUCT_IMAGES, { variables: { id: productId } });
      const data = await resp.json();
      const p = data?.data?.product;
      const images = p?.images?.nodes;
      return json({
        ok: true,
        product: p ?? null,
        images: Array.isArray(images) ? images : [],
      });
    }

    if (intent === "update_alt") {
      const imageId = String(fd.get("image_id") || "").trim();
      const altText = String(fd.get("alt_text") || "");
      if (!imageId) return json({ ok: false, error: "Missing image_id" }, { status: 400 });
      const resp = await admin.graphql(UPDATE_IMAGE_ALT, { variables: { id: imageId, altText } });
      const data = await resp.json();
      const errs = data?.data?.productImageUpdate?.userErrors ?? [];
      if (Array.isArray(errs) && errs.length) {
        return json({ ok: false, userErrors: errs }, { status: 400 });
      }
      return json({ ok: true, image: data?.data?.productImageUpdate?.image ?? null });
    }

    if (intent === "add_image_url") {
      const productId = String(fd.get("product_id") || "").trim();
      const url = String(fd.get("image_url") || "").trim();
      const alt = String(fd.get("alt_text") || "");
      if (!productId) return json({ ok: false, error: "Missing product_id" }, { status: 400 });
      if (!url) return json({ ok: false, error: "Missing image_url" }, { status: 400 });
      const resp = await admin.graphql(ADD_IMAGE_BY_URL, {
        variables: { productId, url, alt: alt || null },
      });
      const data = await resp.json();
      const errs = data?.data?.productCreateMedia?.mediaUserErrors ?? [];
      if (Array.isArray(errs) && errs.length) {
        return json({ ok: false, userErrors: errs }, { status: 400 });
      }
      return json({ ok: true });
    }

    if (intent === "upload_image_file") {
      const productId = String(fd.get("product_id") || "").trim();
      const alt = String(fd.get("alt_text") || "");
      const file = fd.get("file");
      if (!productId) return json({ ok: false, error: "Missing product_id" }, { status: 400 });
      if (!file || typeof (file as any)?.arrayBuffer !== "function") {
        return json({ ok: false, error: "Missing file" }, { status: 400 });
      }

      const f: any = file as any;
      const filename = String(f?.name || "upload");
      const mimeType = String(f?.type || "application/octet-stream");
      if (!mimeType.toLowerCase().startsWith("image/")) {
        return json({ ok: false, error: "Please select an image file." }, { status: 400 });
      }

      const stagedResp = await admin.graphql(STAGED_UPLOADS_CREATE, {
        variables: {
          input: [
            {
              resource: "IMAGE",
              filename,
              mimeType,
              httpMethod: "POST",
              fileSize: String(Number(f?.size ?? 0)),
            },
          ],
        },
      });
      const stagedJson = await stagedResp.json();
      const stagedTopErr = gqlErrorMessage(stagedJson);
      if (stagedTopErr) return json({ ok: false, error: stagedTopErr }, { status: 400 });
      const stagedErrors = stagedJson?.data?.stagedUploadsCreate?.userErrors ?? [];
      if (Array.isArray(stagedErrors) && stagedErrors.length) {
        return json({ ok: false, userErrors: stagedErrors }, { status: 400 });
      }
      const target = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
      const uploadUrl = String(target?.url || "");
      const resourceUrl = String(target?.resourceUrl || "");
      const params: any[] = Array.isArray(target?.parameters) ? target.parameters : [];
      if (!uploadUrl || !resourceUrl) {
        return json({ ok: false, error: "Failed to create upload target." }, { status: 500 });
      }

      const form = new FormData();
      for (const p of params) {
        const name = String(p?.name || "");
        if (!name) continue;
        form.append(name, String(p?.value ?? ""));
      }
      form.append("file", file as any);

      const uploadRes = await fetch(uploadUrl, { method: "POST", body: form as any });
      if (!uploadRes.ok) {
        const preview = (await uploadRes.text()).slice(0, 400);
        return json(
          { ok: false, error: `Upload failed (${uploadRes.status}). ${preview}` },
          { status: 502 },
        );
      }

      const addResp = await admin.graphql(ADD_IMAGE_BY_RESOURCE_URL, {
        variables: { productId, resourceUrl, alt: alt || null },
      });
      const addJson = await addResp.json();
      const addTopErr = gqlErrorMessage(addJson);
      if (addTopErr) return json({ ok: false, error: addTopErr }, { status: 400 });
      const errs = addJson?.data?.productCreateMedia?.mediaUserErrors ?? [];
      if (Array.isArray(errs) && errs.length) {
        return json({ ok: false, userErrors: errs }, { status: 400 });
      }

      return json({ ok: true });
    }

    if (intent === "upload_image_files") {
      const productId = String(fd.get("product_id") || "").trim();
      if (!productId) return json({ ok: false, error: "Missing product_id" }, { status: 400 });

      const files = (fd.getAll("files") || []).filter((x) => x && typeof (x as any)?.arrayBuffer === "function") as any[];
      if (!files.length) return json({ ok: false, error: "Please choose one or more image files." }, { status: 400 });

      const normalized = files.map((f) => ({
        file: f,
        filename: String(f?.name || "upload"),
        mimeType: String(f?.type || "application/octet-stream"),
        size: Number(f?.size ?? 0),
      }));

      const results: Array<{ filename: string; ok: boolean; error?: string }> = normalized.map((f) => ({
        filename: f.filename,
        ok: false,
      }));

      // Validate image files up-front.
      for (let i = 0; i < normalized.length; i++) {
        const mt = String(normalized[i].mimeType || "").toLowerCase();
        if (!mt.startsWith("image/")) {
          results[i] = { filename: normalized[i].filename, ok: false, error: "Not an image file." };
        }
      }

      const inputs = normalized.map((f) => ({
        resource: "IMAGE",
        filename: f.filename,
        mimeType: f.mimeType,
        httpMethod: "POST",
        fileSize: String(Number(f.size ?? 0)),
      }));

      const stagedResp = await admin.graphql(STAGED_UPLOADS_CREATE, { variables: { input: inputs } });
      const stagedJson = await stagedResp.json();
      const stagedTopErr = gqlErrorMessage(stagedJson);
      if (stagedTopErr) return json({ ok: false, error: stagedTopErr }, { status: 400 });
      const stagedErrors = stagedJson?.data?.stagedUploadsCreate?.userErrors ?? [];
      if (Array.isArray(stagedErrors) && stagedErrors.length) {
        return json({ ok: false, userErrors: stagedErrors }, { status: 400 });
      }

      const targets: any[] = Array.isArray(stagedJson?.data?.stagedUploadsCreate?.stagedTargets)
        ? stagedJson.data.stagedUploadsCreate.stagedTargets
        : [];
      if (!targets.length) return json({ ok: false, error: "Failed to create upload targets." }, { status: 500 });

      const media: Array<{ originalSource: string; mediaContentType: "IMAGE"; alt?: string | null }> = [];

      for (let i = 0; i < normalized.length; i++) {
        if (results[i]?.error) continue; // skip invalid type
        const t = targets[i];
        const uploadUrl = String(t?.url || "");
        const resourceUrl = String(t?.resourceUrl || "");
        const params: any[] = Array.isArray(t?.parameters) ? t.parameters : [];
        if (!uploadUrl || !resourceUrl) {
          results[i] = { filename: normalized[i].filename, ok: false, error: "Missing staged upload target." };
          continue;
        }
        const form = new FormData();
        for (const p of params) {
          const name = String(p?.name || "");
          if (!name) continue;
          form.append(name, String(p?.value ?? ""));
        }
        form.append("file", normalized[i].file as any);

        const uploadRes = await fetch(uploadUrl, { method: "POST", body: form as any });
        if (!uploadRes.ok) {
          const preview = (await uploadRes.text()).slice(0, 400);
          results[i] = { filename: normalized[i].filename, ok: false, error: `Upload failed (${uploadRes.status}): ${preview}` };
          continue;
        }

        // Use filename as fallback alt text.
        const baseAlt = normalized[i].filename.replace(/\.[a-z0-9]+$/i, "").trim();
        media.push({ originalSource: resourceUrl, mediaContentType: "IMAGE", alt: baseAlt || null });
        results[i] = { filename: normalized[i].filename, ok: true };
      }

      // Attach uploaded resources to the product in chunks (Shopify limits apply).
      const chunkSize = 10;
      for (let start = 0; start < media.length; start += chunkSize) {
        const chunk = media.slice(start, start + chunkSize);
        const addResp = await admin.graphql(ADD_IMAGES_BY_RESOURCE_URLS, { variables: { productId, media: chunk } });
        const addJson = await addResp.json();
        const addTopErr = gqlErrorMessage(addJson);
        if (addTopErr) return json({ ok: false, error: addTopErr, results }, { status: 400 });
        const errs = addJson?.data?.productCreateMedia?.mediaUserErrors ?? [];
        if (Array.isArray(errs) && errs.length) {
          return json({ ok: false, userErrors: errs, results }, { status: 400 });
        }
      }

      return json({ ok: true, results });
    }

    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("IMAGES_ACTION_ERROR", error);
    const msg = String((error as any)?.message ?? "");
    const safe = msg && msg.length < 800 ? msg : "Unexpected error while uploading images.";
    return json({ ok: false, error: safe }, { status: 500 });
  }
}

export default function ImagesPage() {
  useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const qs = location.search || "";
  const searchParams = React.useMemo(() => new URLSearchParams(location.search), [location.search]);
  const productIdFromUrl = searchParams.get("productId") || "";

  const searchFetcher = useFetcher<typeof action>();
  const imagesFetcher = useFetcher<typeof action>();
  const updateFetcher = useFetcher<typeof action>();
  const addFetcher = useFetcher<typeof action>();

  const [q, setQ] = React.useState("");
  const [selectedProductId, setSelectedProductId] = React.useState<string>("");
  const [altDraftById, setAltDraftById] = React.useState<Record<string, string>>({});
  const [newImageUrl, setNewImageUrl] = React.useState<string>("");
  const [newImageAlt, setNewImageAlt] = React.useState<string>("");
  const [uploadAlt, setUploadAlt] = React.useState<string>("");
  const [uploadFiles, setUploadFiles] = React.useState<File[]>([]);
  const [multiFiles, setMultiFiles] = React.useState<File[]>([]);
  const [uploadResults, setUploadResults] = React.useState<Array<{ filename: string; ok: boolean; error?: string; status?: string }>>([]);

  const products: any[] = (searchFetcher.data as any)?.products ?? [];
  const product: any = (imagesFetcher.data as any)?.product ?? null;
  const images: any[] = (imagesFetcher.data as any)?.images ?? [];

  const busy =
    searchFetcher.state !== "idle" ||
    imagesFetcher.state !== "idle" ||
    updateFetcher.state !== "idle" ||
    addFetcher.state !== "idle";

  function submitSearch() {
    const fd = new FormData();
    fd.set("_intent", "product_search");
    fd.set("q", q);
    searchFetcher.submit(fd, { method: "post" });
  }

  function loadImages(productId: string) {
    setSelectedProductId(productId);
    const fd = new FormData();
    fd.set("_intent", "load_images");
    fd.set("product_id", productId);
    imagesFetcher.submit(fd, { method: "post" });
  }

  function selectProduct(productId: string) {
    const sp = new URLSearchParams(location.search);
    sp.set("productId", productId);
    navigate(`/app/images?${sp.toString()}`);
  }

  function saveAlt(imageId: string) {
    const fd = new FormData();
    fd.set("_intent", "update_alt");
    fd.set("image_id", imageId);
    fd.set("alt_text", altDraftById[imageId] ?? "");
    updateFetcher.submit(fd, { method: "post" });
  }

  function addImageByUrl() {
    if (!selectedProductId) return;
    const fd = new FormData();
    fd.set("_intent", "add_image_url");
    fd.set("product_id", selectedProductId);
    fd.set("image_url", newImageUrl);
    fd.set("alt_text", newImageAlt);
    addFetcher.submit(fd, { method: "post" });
  }

  function uploadImageFile() {
    if (!selectedProductId) return;
    const f = uploadFiles?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.set("_intent", "upload_image_file");
    fd.set("product_id", selectedProductId);
    fd.set("alt_text", uploadAlt);
    fd.set("file", f);
    addFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  function uploadManyFiles() {
    if (!selectedProductId) return;
    if (!multiFiles.length) return;
    setUploadResults(
      multiFiles.map((f) => ({ filename: String((f as any)?.name ?? "file"), ok: false, status: "uploading" })),
    );
    const fd = new FormData();
    fd.set("_intent", "upload_image_files");
    fd.set("product_id", selectedProductId);
    for (const f of multiFiles) fd.append("files", f);
    addFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  React.useEffect(() => {
    if (!productIdFromUrl) return;
    if (productIdFromUrl === selectedProductId && (imagesFetcher.data as any)?.ok === true) return;
    loadImages(productIdFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIdFromUrl]);

  React.useEffect(() => {
    // When images load, initialize drafts with current alt text.
    if (!imagesFetcher.data || (imagesFetcher.data as any).ok !== true) return;
    const next: Record<string, string> = {};
    for (const img of images) {
      const id = String(img?.id ?? "");
      if (id) next[id] = String(img?.altText ?? "");
    }
    setAltDraftById(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagesFetcher.data]);

  React.useEffect(() => {
    // After successful alt update or add-image, refresh the image list.
    const d1: any = updateFetcher.data;
    const d2: any = addFetcher.data;
    if ((d1 && d1.ok === true) || (d2 && d2.ok === true)) {
      if (selectedProductId) loadImages(selectedProductId);
      setNewImageUrl("");
      setNewImageAlt("");
      setUploadAlt("");
      setUploadFiles([]);
      setMultiFiles([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateFetcher.data, addFetcher.data]);

  React.useEffect(() => {
    const d: any = addFetcher.data;
    if (!d) return;
    if (d.ok === true && Array.isArray(d.results)) {
      setUploadResults(
        d.results.map((r: any) => ({
          filename: String(r?.filename ?? ""),
          ok: !!r?.ok,
          error: r?.error ? String(r.error) : undefined,
          status: r?.ok ? "success" : "failed",
        })),
      );
    }
    if (d.ok === false && Array.isArray(d.results)) {
      setUploadResults(
        d.results.map((r: any) => ({
          filename: String(r?.filename ?? ""),
          ok: !!r?.ok,
          error: r?.error ? String(r.error) : undefined,
          status: r?.ok ? "success" : "failed",
        })),
      );
    }
  }, [addFetcher.data]);

  return (
    <Page
      title="Image Manager"
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(`/app/products${location.search || ""}`),
      }}
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Search products
            </Text>
            <InlineStack gap="300" blockAlign="end">
              <TextField label="Search" value={q} onChange={setQ} autoComplete="off" />
              <Button variant="primary" onClick={submitSearch} disabled={busy || !q.trim()}>
                Search
              </Button>
            </InlineStack>
            {searchFetcher.data && (searchFetcher.data as any).ok === false ? (
              <Banner tone="critical" title="Search failed">
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(searchFetcher.data, null, 2)}</pre>
              </Banner>
            ) : null}
            {Array.isArray(products) && products.length ? (
              <ResourceList
                resourceName={{ singular: "product", plural: "products" }}
                items={products}
                renderItem={(p: any) => {
                  const id = String(p?.id ?? "");
                  const title = String(p?.title ?? "");
                  const handle = String(p?.handle ?? "");
                  const thumbUrl = p?.featuredImage?.url ?? null;
                  const thumbSrc =
                    thumbUrl || "https://cdn.shopify.com/static/images/placeholders/product-1.png";
                  return (
                    <ResourceItem
                      id={id}
                      accessibilityLabel={title}
                      onClick={() => (id ? selectProduct(id) : null)}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                          <Thumbnail source={thumbSrc} alt={p?.featuredImage?.altText || title} size="small" />
                          <BlockStack gap="100">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {title}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {handle}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <Button onClick={() => (id ? selectProduct(id) : null)} disabled={busy}>
                          Select
                        </Button>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            ) : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Product images
            </Text>
            <Divider />
            {!selectedProductId ? (
              <Text as="p" variant="bodyMd">
                Select a product to view and edit its images.
              </Text>
            ) : null}
            {product ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {product.title} · {product.handle}
              </Text>
            ) : null}

            {imagesFetcher.data && (imagesFetcher.data as any).ok === false ? (
              <Banner tone="critical" title="Failed to load images">
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(imagesFetcher.data, null, 2)}</pre>
              </Banner>
            ) : null}

            {updateFetcher.data && (updateFetcher.data as any).ok === false ? (
              <Banner tone="critical" title="Update failed">
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(updateFetcher.data, null, 2)}</pre>
              </Banner>
            ) : null}

            {addFetcher.data && (addFetcher.data as any).ok === false ? (
              <Banner tone="critical" title="Add image failed">
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(addFetcher.data, null, 2)}</pre>
              </Banner>
            ) : null}

            {selectedProductId ? (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Upload/Add images
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Upload from your computer (recommended) or add by URL.
                  </Text>

                  <Card>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">
                        Upload from computer (multiple)
                      </Text>
                      <DropZone
                        allowMultiple
                        accept="image/*"
                        onDrop={(droppedFiles) => setMultiFiles(droppedFiles as any)}
                        disabled={busy || !selectedProductId}
                      >
                        <LegacyStack vertical>
                          <DropZone.FileUpload actionTitle="Choose files" actionHint="Upload one or more images" />
                        </LegacyStack>
                      </DropZone>
                      <div>
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          disabled={busy || !selectedProductId}
                          onChange={(e) => setMultiFiles(Array.from(e.currentTarget.files || []))}
                        />
                      </div>
                      <InlineStack align="end">
                        <Button
                          variant="primary"
                          onClick={uploadManyFiles}
                          disabled={busy || !selectedProductId || multiFiles.length === 0}
                        >
                          Upload selected images
                        </Button>
                      </InlineStack>

                      {uploadResults.length ? (
                        <BlockStack gap="100">
                          {uploadResults.map((r) => (
                            <InlineStack key={r.filename} gap="200" align="space-between" blockAlign="center">
                              <Text as="span" variant="bodySm">
                                {r.filename}
                              </Text>
                              <InlineStack gap="200" blockAlign="center">
                                {r.status === "uploading" ? <Badge tone="attention">uploading</Badge> : null}
                                {r.status === "success" ? <Badge tone="success">success</Badge> : null}
                                {r.status === "failed" ? <Badge tone="critical">failed</Badge> : null}
                              </InlineStack>
                            </InlineStack>
                          ))}
                          {uploadResults.some((r) => r.status === "failed" && r.error) ? (
                            <Banner tone="critical" title="Upload errors">
                              <pre style={{ whiteSpace: "pre-wrap" }}>
                                {JSON.stringify(
                                  uploadResults.filter((r) => r.status === "failed").map((r) => ({ file: r.filename, error: r.error })),
                                  null,
                                  2,
                                )}
                              </pre>
                            </Banner>
                          ) : null}
                        </BlockStack>
                      ) : null}
                    </BlockStack>
                  </Card>

                  <Divider />

                  <Text as="h4" variant="headingSm">
                    Add by URL
                  </Text>
                  <InlineStack gap="300" wrap>
                    <TextField label="Image URL" value={newImageUrl} onChange={setNewImageUrl} autoComplete="off" />
                    <TextField label="Alt text" value={newImageAlt} onChange={setNewImageAlt} autoComplete="off" />
                    <Button
                      variant="primary"
                      onClick={addImageByUrl}
                      disabled={busy || !newImageUrl.trim() || !selectedProductId}
                    >
                      Add image
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            ) : null}

            {Array.isArray(images) && images.length ? (
              <BlockStack gap="300">
                {images.map((img: any) => {
                  const id = String(img?.id ?? "");
                  const url = String(img?.url ?? "");
                  const alt = altDraftById[id] ?? String(img?.altText ?? "");
                  return (
                    <Card key={id}>
                      <BlockStack gap="200">
                        <InlineStack gap="300" blockAlign="center">
                          <Thumbnail source={url} alt={alt || "Product image"} size="small" />
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">
                              {id}
                            </Text>
                            <TextField
                              label="Alt text"
                              value={alt}
                              onChange={(v) => setAltDraftById((prev) => ({ ...prev, [id]: v }))}
                              autoComplete="off"
                            />
                          </BlockStack>
                        </InlineStack>
                        <InlineStack align="end">
                          <Button variant="primary" onClick={() => saveAlt(id)} disabled={busy || !id}>
                            Save alt text
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  );
                })}
              </BlockStack>
            ) : selectedProductId && imagesFetcher.state === "idle" ? (
              <Text as="p" variant="bodyMd">
                No images found.
              </Text>
            ) : null}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

