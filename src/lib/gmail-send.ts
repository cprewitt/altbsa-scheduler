/**
 * Send mail from Google Workspace (tryouts@altbsa.org) via Gmail API.
 * Uses OAuth refresh token — same style of access as Workspace SMTP for
 * magic-link delivery, but callable from the app for arbitrary messages.
 */

type GmailSendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  ics: string;
  icsFileName: string;
};

function requiredEnv(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

export function gmailSendConfigured(): boolean {
  return Boolean(
    requiredEnv("GMAIL_CLIENT_ID") &&
      requiredEnv("GMAIL_CLIENT_SECRET") &&
      requiredEnv("GMAIL_REFRESH_TOKEN")
  );
}

async function getAccessToken(): Promise<string> {
  const clientId = requiredEnv("GMAIL_CLIENT_ID");
  const clientSecret = requiredEnv("GMAIL_CLIENT_SECRET");
  const refreshToken = requiredEnv("GMAIL_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Gmail OAuth env not configured");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gmail token refresh failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Gmail token refresh returned no access_token");
  return json.access_token;
}

function buildMime(input: GmailSendInput & { from: string }): string {
  const boundary = `altbsa_${Date.now().toString(36)}`;
  const icsBase64 = Buffer.from(input.ics, "utf8").toString("base64");
  // Gmail prefers RFC 2045 base64 lines ≤76 chars
  const icsWrapped = icsBase64.replace(/(.{76})/g, "$1\r\n");

  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const parts = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}_alt"`,
    "",
    `--${boundary}_alt`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    input.text,
    `--${boundary}_alt`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    input.html,
    `--${boundary}_alt--`,
    `--${boundary}`,
    `Content-Type: text/calendar; method=PUBLISH; name="${input.icsFileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${input.icsFileName}"`,
    "",
    icsWrapped,
    `--${boundary}--`,
    "",
  ];

  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

export async function sendWithGmailWorkspace(
  input: GmailSendInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!gmailSendConfigured()) {
    return { ok: false, error: "not_configured" };
  }

  const from =
    requiredEnv("EMAIL_FROM") ||
    requiredEnv("GMAIL_SENDER") ||
    "ALTBSA Scheduler <tryouts@altbsa.org>";

  try {
    const accessToken = await getAccessToken();
    const raw = Buffer.from(buildMime({ ...input, from }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      return {
        ok: false,
        error: `Gmail send failed (${res.status}): ${detail.slice(0, 240)}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Gmail send failed",
    };
  }
}
