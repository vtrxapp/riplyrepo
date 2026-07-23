import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Sends transactional email via Resend. Both the shared caller secret and
// the Resend API key live in Supabase Vault (never in git or Deno env),
// fetched here through the service-role-only get_vault_secret RPC.
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

    const { user_id, subject, body } = await req.json();
    if (!user_id || !subject) {
      return new Response(JSON.stringify({ error: "user_id and subject required" }), { status: 400 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("email")
      .eq("id", user_id)
      .single();
    if (!user?.email) {
      return new Response(JSON.stringify({ sent: false, reason: "no email on file" }), { status: 200 });
    }

    const { data: resendKey } = await supabase.rpc("get_vault_secret", { p_name: "resend_api_key" });
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "resend_api_key secret not set" }), { status: 500 });
    }
    const { data: fromAddress } = await supabase.rpc("get_vault_secret", { p_name: "resend_from_address" });

    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    // Built as its own value (not inline in the request object) so the only
    // thing feeding the `html` field is this already-escaped string.
    const safeHtmlBody = `<p>${escapeHtml(body || "")}</p>`;
    const senderAddress = fromAddress || "Riply <onboarding@resend.dev>";
    // Subject is a mail header, not HTML -- strip line breaks so a crafted
    // notification title can't inject extra headers.
    const safeSubject = String(subject).replace(/[\r\n]/g, " ");

    const emailPayload = {
      from: senderAddress,
      to: [user.email],
      subject: safeSubject,
      html: safeHtmlBody,
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ sent: false, error: err }), { status: 200 });
    }

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
