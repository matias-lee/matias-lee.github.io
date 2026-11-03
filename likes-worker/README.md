# Blog like counter

`worker.js` is a small Cloudflare Worker that stores like counts for blog posts.
It is not part of the Quarto site; it runs on Cloudflare's free plan.

What it stores: one number per post, plus a salted, one-way hash per visitor
that expires after 24 hours (to stop repeat likes). No IP addresses, cookies or
personal data are kept. Only https://matias-lee.github.io can add likes.

## Setup (one time, in the Cloudflare dashboard)

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. **Workers & Pages → Create → Create Worker.** Name it `matias-likes` and deploy the starter code.
3. **Storage & Databases → KV → Create namespace.** Name it `LIKES`.
4. Open the `matias-likes` worker → **Settings → Bindings → Add → KV namespace.**
   Variable name `LIKES`, namespace `LIKES`.
5. Same page, **Variables and Secrets → Add**, type **Secret**, name `SALT`,
   value: any long random string (for example from a password manager). Never share it.
6. **Edit code**, replace everything with the contents of `worker.js`, and **Deploy**.
7. Copy the worker's address (`https://matias-likes.<your-subdomain>.workers.dev`).

To check it works, open `<worker address>/likes?post=2026-11-03-writing-is-thinking`
in a browser. It should show `{"post":"2026-11-03-writing-is-thinking","count":0}`.
