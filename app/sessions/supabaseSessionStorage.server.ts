import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { Session } from "@shopify/shopify-api";
import { getSupabaseAdmin } from "../supabase.server";

type SessionRow = {
  id: string;
  shop: string;
  is_online: boolean;
  data: Array<[string, string | number | boolean]>;
};

/**
 * Persistent Shopify session storage backed by Supabase Postgres.
 *
 * This avoids `MemorySessionStorage`, which is not suitable for serverless
 * runtimes (e.g. Vercel) because processes are ephemeral and can cause
 * stale/incorrect sessions across requests.
 */
export class SupabaseSessionStorage implements SessionStorage {
  private readonly tableName: string;

  constructor(opts?: { tableName?: string }) {
    this.tableName = opts?.tableName ?? "shopify_sessions";
  }

  public async storeSession(session: Session): Promise<boolean> {
    const supabase = getSupabaseAdmin();
    const data = session.toPropertyArray(true);
    const row: SessionRow = {
      id: session.id,
      shop: session.shop,
      is_online: Boolean(session.isOnline),
      data,
    };

    const { error } = await supabase.from(this.tableName).upsert(row, {
      onConflict: "id",
    });
    if (error) throw error;
    return true;
  }

  public async loadSession(id: string): Promise<Session | undefined> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(this.tableName)
      .select("data")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.data) return undefined;
    return Session.fromPropertyArray(data.data as any, true);
  }

  public async deleteSession(id: string): Promise<boolean> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from(this.tableName).delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  public async deleteSessions(ids: string[]): Promise<boolean> {
    const uniq = Array.from(new Set((ids ?? []).map((x) => String(x || "").trim()).filter(Boolean)));
    if (!uniq.length) return true;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from(this.tableName).delete().in("id", uniq);
    if (error) throw error;
    return true;
  }

  public async findSessionsByShop(shop: string): Promise<Session[]> {
    const s = String(shop || "").trim();
    if (!s) return [];
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from(this.tableName).select("data").eq("shop", s);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const sessions: Session[] = [];
    for (const r of rows) {
      if (!r?.data) continue;
      sessions.push(Session.fromPropertyArray(r.data as any, true));
    }
    return sessions;
  }
}

