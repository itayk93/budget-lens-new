import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type RequestBody = {
  fileName?: string;
  fileType?: string;
  width?: number;
  height?: number;
  imageDataUrl?: string;
};

type TagRow = {
  id: string;
  name: string;
  parent_id: string | null;
};

function normalizeTagIds(ids: unknown, validTagIds: Set<string>): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => id.length > 0 && validTagIds.has(id)),
    ),
  );
}

function parseSuggestedTagIds(raw: string, validTagIds: Set<string>): string[] {
  const candidates: string[] = [];
  candidates.push(raw);

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced);

  const bracketJson = raw.match(/\[[\s\S]*\]/)?.[0];
  if (bracketJson) candidates.push(bracketJson);

  const objectJson = raw.match(/\{[\s\S]*\}/)?.[0];
  if (objectJson) candidates.push(objectJson);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        const parsedIds = normalizeTagIds(parsed, validTagIds);
        if (parsedIds.length > 0) return parsedIds;
      }
      if (parsed && typeof parsed === "object") {
        const parsedIds = normalizeTagIds((parsed as any).tagIds ?? (parsed as any).tag_ids, validTagIds);
        if (parsedIds.length > 0) return parsedIds;
      }
    } catch {
      // Best-effort parsing; fallback below.
    }
  }

  // Fallback: extract UUID-like values and keep only IDs that exist in DB.
  const fallbackIds = (raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) || [])
    .map((id) => id.toLowerCase())
    .filter((id) => validTagIds.has(id));

  return Array.from(new Set(fallbackIds));
}

function safeImageDataUrl(imageDataUrl?: string): string | null {
  if (!imageDataUrl) return null;
  if (!imageDataUrl.startsWith("data:image/")) return null;
  // Keep payload bounded for the AI gateway.
  if (imageDataUrl.length > 7_000_000) return null;
  return imageDataUrl;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !LOVABLE_API_KEY) {
      throw new Error("Missing required environment configuration");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { fileName, fileType, width, height, imageDataUrl } = (await req.json()) as RequestBody;
    if (!fileName) {
      return new Response(JSON.stringify({ error: "fileName is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: tagsData, error: tagsError } = await adminClient
      .from("tags")
      .select("id, name, parent_id")
      .eq("is_active", true)
      .order("name");

    if (tagsError) {
      throw new Error(tagsError.message);
    }

    const tags = (tagsData || []) as TagRow[];
    if (tags.length === 0) {
      return new Response(JSON.stringify({ tagIds: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validTagIds = new Set(tags.map((tag) => tag.id));
    const parentNameById = new Map<string, string>();
    tags.forEach((tag) => {
      parentNameById.set(tag.id, tag.name);
    });

    const tagCatalog = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      parentName: tag.parent_id ? parentNameById.get(tag.parent_id) || null : null,
    }));

    const safeImage = safeImageDataUrl(imageDataUrl);
    const metadataPrompt =
      `נכס לשיוך תגיות:\n` +
      `שם קובץ: ${fileName}\n` +
      `סוג קובץ: ${fileType || "לא ידוע"}\n` +
      `מידות: ${width || "לא ידוע"}×${height || "לא ידוע"}\n\n` +
      `רשימת תגיות פעילות במערכת (מותר לבחור אך ורק מזהים מהרשימה):\n` +
      `${JSON.stringify(tagCatalog)}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You classify marketing assets into existing tags. " +
              "Return strictly JSON only with shape: {\"tagIds\":[\"<id>\",\"<id>\"]}. " +
              "Rules: choose 1-5 most relevant IDs from provided catalog only; prefer specific tags over broad parent tags; do not invent IDs; if uncertain return empty array.",
          },
          safeImage
            ? {
              role: "user",
              content: [
                { type: "text", text: metadataPrompt },
                { type: "image_url", image_url: { url: safeImage } },
              ],
            }
            : {
              role: "user",
              content: metadataPrompt,
            },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "יותר מדי בקשות, נסה שוב בעוד רגע" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "נדרש תשלום, הוסף קרדיטים" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(JSON.stringify({ error: "שגיאה בשירות AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiPayload = await response.json();
    const rawResult = aiPayload?.choices?.[0]?.message?.content?.trim() || "";
    const tagIds = parseSuggestedTagIds(rawResult, validTagIds).slice(0, 5);

    return new Response(JSON.stringify({ tagIds }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-tags error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
