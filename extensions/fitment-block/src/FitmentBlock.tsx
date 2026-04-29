import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  BlockStack,
  Button,
  Divider,
  InlineStack,
  Link,
  ProgressIndicator,
  Text,
} from "@shopify/ui-extensions-react/admin";
import { reactExtension, useApi } from "@shopify/ui-extensions-react/admin";

type AssignedVehicle = {
  id: string;
  handle?: string;
  vehicle_key?: string;
  display_name?: string;
};

type FitmentPayload = {
  productId: string;
  vehicles: AssignedVehicle[];
};

function extractNumericProductId(productGid: string): string {
  const value = String(productGid || "").trim();
  if (!value) return "";
  const match = value.match(/\/Product\/(\d+)(?:\D.*)?$/i) || value.match(/(\d+)$/);
  return match?.[1] ?? "";
}

export default reactExtension("admin.product-details.block.render", () => <FitmentBlock />);

function FitmentBlock() {
  const api = useApi();
  const productId = String((api as any)?.data?.product?.id ?? "").trim();
  const sessionToken = (api as any)?.sessionToken;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [vehicles, setVehicles] = useState<AssignedVehicle[]>([]);

  const appBaseUrl = String((api as any)?.appUrl ?? "").trim(); // provided by Admin runtime

  const manageUrl = useMemo(() => {
    const numericId = extractNumericProductId(productId);
    return numericId
      ? `/admin/apps/fitment-manager-2#product=${encodeURIComponent(numericId)}`
      : `/admin/apps/fitment-manager-2`;
  }, [productId]);

  const count = vehicles.length;

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!sessionToken || typeof sessionToken.get !== "function") {
        throw new Error("Missing sessionToken");
      }
      const token = await sessionToken.get();
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("Content-Type", headers.get("Content-Type") || "application/json");

      const url = path.startsWith("http")
        ? path
        : appBaseUrl
          ? `${appBaseUrl.replace(/\/+$/g, "")}${path.startsWith("/") ? "" : "/"}${path}`
          : path;

      const res = await fetch(url, { ...init, headers });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${txt}`.trim());
      }
      return res;
    },
    [appBaseUrl, sessionToken],
  );

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError("");
    try {
      // Backend route expected:
      // GET /api/fitment?productId=<gid> -> { productId, vehicles: [{id, handle, vehicle_key, display_name}] }
      const res = await authFetch(`/api/fitment?productId=${encodeURIComponent(productId)}`, {
        method: "GET",
      });
      const data = (await res.json()) as FitmentPayload;
      setVehicles(Array.isArray(data?.vehicles) ? data.vehicles : []);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load fitment"));
    } finally {
      setLoading(false);
    }
  }, [authFetch, productId]);

  useEffect(() => {
    load();
  }, [load]);

  const quickRemove = useCallback(
    async (vehicleId: string) => {
      const vid = String(vehicleId || "").trim();
      if (!vid || !productId) return;
      setSavingId(vid);
      setError("");
      try {
        // Backend route expected:
        // POST /api/fitment/remove { productId, vehicleId } -> { ok: true, vehicles: [...] }
        const res = await authFetch(`/api/fitment/remove`, {
          method: "POST",
          body: JSON.stringify({ productId, vehicleId: vid }),
        });
        const data = await res.json().catch(() => null);
        if (data && Array.isArray((data as any).vehicles)) {
          setVehicles((data as any).vehicles as AssignedVehicle[]);
        } else {
          // fallback: local update
          setVehicles((prev) => prev.filter((v) => String(v.id) !== vid));
        }
      } catch (e: any) {
        setError(String(e?.message || e || "Failed to remove vehicle"));
      } finally {
        setSavingId("");
      }
    },
    [authFetch, productId],
  );

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <BlockStack gap="base">
      <InlineStack blockAlign="center" inlineAlign="space-between" gap="base">
        <InlineStack blockAlign="center" gap="base">
          <Text fontWeight="bold">Fitment</Text>
          <Badge tone={count ? "success" : "subdued"}>{count} vehicles</Badge>
        </InlineStack>
        <InlineStack gap="base" blockAlign="center">
          <Link to={manageUrl}>Manage Fitment</Link>
          <Button
            kind="secondary"
            onPress={toggle}
            disabled={loading}
          >
            {open ? "Hide" : "Show"}
          </Button>
        </InlineStack>
      </InlineStack>

      {loading ? (
        <ProgressIndicator size="small" />
      ) : null}

      {error ? (
        <Text tone="critical">{error}</Text>
      ) : null}

      {open ? (
        <BlockStack gap="base">
          <Divider />
          {vehicles.length ? (
            <BlockStack gap="tight">
              {vehicles.map((v) => {
                const id = String(v.id || "").trim();
                const label =
                  String(v.display_name || "").trim() ||
                  String(v.vehicle_key || "").trim() ||
                  String(v.handle || "").trim() ||
                  id;
                const busy = savingId && savingId === id;
                return (
                  <InlineStack
                    key={id}
                    inlineAlign="space-between"
                    blockAlign="center"
                    gap="base"
                  >
                    <Text>{label}</Text>
                    <Button
                      kind="secondary"
                      tone="critical"
                      onPress={() => quickRemove(id)}
                      disabled={busy}
                    >
                      {busy ? "Removing…" : "Remove"}
                    </Button>
                  </InlineStack>
                );
              })}
            </BlockStack>
          ) : (
            <Text tone="subdued">No vehicles assigned.</Text>
          )}
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}

