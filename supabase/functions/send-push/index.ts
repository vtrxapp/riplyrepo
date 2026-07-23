import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Reads the Firebase service-account JSON from the FIREBASE_SERVICE_ACCOUNT
// secret (set via `supabase secrets set`, never committed to git) and uses
// it to mint a short-lived OAuth2 access token for the FCM HTTP v1 API.
async function getAccessToken(serviceAccount: any): Promise<string> {
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

  const pem = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
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

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader !== `Bearer ${Deno.env.get("EDGE_FUNCTION_SECRET")}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const { user_id, title, body } = await req.json();
    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: "user_id and title required" }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: user } = await supabase
      .from("users")
      .select("fcm_tokens")
      .eq("id", user_id)
      .single();
    const tokens: string[] = user?.fcm_tokens || [];
    if (tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
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
      await supabase
        .from("users")
        .update({ fcm_tokens: tokens.filter((t) => !staleTokens.includes(t)) })
        .eq("id", user_id);
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
