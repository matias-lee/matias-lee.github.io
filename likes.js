// Like button at the end of each blog post. Counts are stored by the
// Cloudflare Worker in likes-worker/. The button only appears on blog post
// pages, and remembers in this browser which posts the visitor has liked.
(function () {
  const API = "https://matias-likes.matias-lee.workers.dev/likes";

  const match = window.location.pathname.match(/\/blog\/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\/?(index\.html)?$/);
  const main = document.querySelector("main.content");
  if (!match || !main) return;
  const post = match[1];
  const storageKey = "liked:" + post;

  function hasLiked() {
    try { return window.localStorage.getItem(storageKey) === "1"; } catch (e) { return false; }
  }
  function rememberLike() {
    try { window.localStorage.setItem(storageKey, "1"); } catch (e) { /* storage blocked: ignore */ }
  }

  const wrap = document.createElement("div");
  wrap.className = "like-bar";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "like-button";
  const heart = document.createElement("span");
  heart.className = "like-heart";
  heart.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "like-count";
  button.append(heart, label);
  wrap.append(button);
  main.append(wrap);

  function show(count, liked) {
    heart.textContent = liked ? "♥" : "♡";
    label.textContent = count === null ? "Like" : String(count);
    button.classList.toggle("liked", liked);
    button.disabled = liked;
    button.setAttribute("aria-label", liked ? "You liked this post" : "Like this post");
    button.title = liked ? "Thanks for the like!" : "Like this post";
  }

  show(null, hasLiked());

  fetch(API + "?post=" + encodeURIComponent(post))
    .then((r) => r.json())
    .then((data) => show(data.count, hasLiked()))
    .catch(() => { wrap.hidden = true; });

  button.addEventListener("click", function () {
    if (hasLiked()) return;
    button.disabled = true;
    fetch(API + "?post=" + encodeURIComponent(post), { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        rememberLike();
        show(data.count, true);
      })
      .catch(() => { button.disabled = false; });
  });
})();
