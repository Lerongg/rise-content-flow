import { ClientRow } from "./types";

/** Creates a WordPress draft post via REST API. Returns the edit link / post link. */
export async function publishWpDraft(
  client: ClientRow,
  title: string,
  htmlContent: string
): Promise<{ url: string; postId: number }> {
  if (!client.wp_enabled) {
    throw new Error("Klient nie ma włączonej publikacji do WordPressa.");
  }
  if (!client.wp_url || !client.wp_username || !client.wp_app_password) {
    throw new Error(
      "Brak pełnej konfiguracji WordPress (adres, użytkownik, hasło aplikacji) w ustawieniach klienta."
    );
  }
  const base = client.wp_url.replace(/\/+$/, "");
  const auth = Buffer.from(`${client.wp_username}:${client.wp_app_password}`).toString("base64");
  const res = await fetch(`${base}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ title, content: htmlContent, status: "draft" }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WordPress HTTP ${res.status}: ${text.slice(0, 1000)}`);
  }
  const json = JSON.parse(text) as { id: number; link?: string };
  return { url: json.link ?? `${base}/wp-admin/post.php?post=${json.id}&action=edit`, postId: json.id };
}
