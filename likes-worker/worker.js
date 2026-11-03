// Like counter for blog posts on https://matias-lee.github.io.
// Runs as a Cloudflare Worker with one KV namespace bound as LIKES and one
// secret named SALT. Stores only a count per post, plus a short-lived hashed
// marker so the same visitor can't like a post twice in a day. No IP
// addresses, cookies or personal data are stored.
//
//   GET  /likes?post=<slug>   -> { "post": "<slug>", "count": 12 }
//   POST /likes?post=<slug>   -> adds one like, returns the new count

const ALLOWED_ORIGIN = "https://matias-lee.github.io";
const SLUG = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]{1,60}$/;
const REPEAT_WINDOW_SECONDS = 60 * 60 * 24;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() },
  });
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    const url = new URL(request.url);
    if (url.pathname !== "/likes") return reply({ error: "Not found" }, 404);

    const post = url.searchParams.get("post") || "";
    if (!SLUG.test(post)) return reply({ error: "Unknown post" }, 400);
    const key = "count:" + post;

    if (request.method === "GET") {
      const count = parseInt((await env.LIKES.get(key)) || "0", 10);
      return reply({ post, count });
    }

    if (request.method === "POST") {
      // Only the website itself may add likes.
      if (request.headers.get("Origin") !== ALLOWED_ORIGIN) return reply({ error: "Forbidden" }, 403);

      // One like per visitor per post per day. The visitor is identified by a
      // salted hash of their IP address, which is kept for one day and then
      // deleted automatically by Cloudflare.
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const marker = "seen:" + post + ":" + (await sha256(env.SALT + ip + post));
      let count = parseInt((await env.LIKES.get(key)) || "0", 10);
      if (await env.LIKES.get(marker)) return reply({ post, count, alreadyLiked: true });

      count += 1;
      await env.LIKES.put(key, String(count));
      await env.LIKES.put(marker, "1", { expirationTtl: REPEAT_WINDOW_SECONDS });
      return reply({ post, count });
    }

    return reply({ error: "Method not allowed" }, 405);
  },
};
