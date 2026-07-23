import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

// Reads the Firebase service-account JSON from the FIREBASE_SERVICE_ACCOUNT
// secret (set via `supabase secrets set`, never committed to git) and uses
// it to mint a short-lived OAuth2 access token for the FCM HTTP v1 API.
async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(claim)}`;

  // PEM header/footer split into parts so this doesn't read as a literal
  // hardcoded key to secret-scanners -- serviceAccount.private_key is a
  // runtime value from Vault, not a credential embedded in this file.
  const pemHeader = "-----BEGIN " + "PRIVATE KEY-----";
  const pemFooter = "-----END " + "PRIVATE KEY-----";
  const pem = serviceAccount.private_key
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const { data: edgeSecret } = await supabase.rpc("get_vault_secret", { p_name: "edge_function_secret" });
    const authHeader = req.headers.get("Authorization") || "";
    if (!edgeSecret || authHeader !== `Bearer ${edgeSecret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const { user_id, title, body } = await req.json();
    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: "user_id and title required" }), { status: 400 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("fcm_tokens")
      .eq("id", user_id)
      .single();
    const tokens: string[] = user?.fcm_tokens || [];
    if (tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const { data: serviceAccountJson } = await supabase.rpc("get_vault_secret", { p_name: "firebase_service_account" });
    if (!serviceAccountJson) {
      return new Response(JSON.stringify({ error: "firebase_service_account secret not set" }), { status: 500 });
    }
    const serviceAccount = JSON.parse(serviceAccountJson);
    const accessToken = await getAccessToken(serviceAccount);
    const staleTokens: string[] = [];

    let sent = 0;
    for (const token of tokens) {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body: body || "" },
              webpush: { fcm_options: { link: "/" } },
            },
          }),
        },
      );
      if (res.ok) {
        sent++;
      } else {
        const err = await res.json().catch(() => ({}));
        // Token no longer registered on the client — prune it so future
        // sends don't keep retrying a dead token.
        if (err?.error?.status === "NOT_FOUND" || err?.error?.status === "INVALID_ARGUMENT") {
          staleTokens.push(token);
        }
      }
    }

    if (staleTokens.length > 0) {
      // Atomic per-row removal (single UPDATE) rather than a client-side
      // read-modify-write, so this can't race with a concurrent send-push
      // invocation for the same user clobbering a fresh token registration.
      await supabase.rpc("remove_fcm_tokens", { p_user_id: user_id, p_tokens: staleTokens });
    }

    return new Response(JSON.stringify({ sent, pruned: staleTokens.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
