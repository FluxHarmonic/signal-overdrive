#!/usr/bin/env node
// build-news.mjs - signaloverdrive.net's /news/, its feeds and the landing's
// latest post, generated into a staged tree. Phantom Burn's
// scripts/build-news.mjs (Harkfell's D38 shape) in Signal Overdrive's names
// and look. substratic's stage-web runs it through scripts/stage-hook.mjs
// (the stage-hook: in substratic.sgv), so everything lands INSIDE the tree
// check-site checks and publish-web ships byte for byte.
//
//   node scripts/build-news.mjs NEWS-DIR TREE
//
// NEWS-DIR holds one Markdown file per release post, with front matter:
//     ---
//     title: Signal Overdrive 0.2
//     date: 2026-10-20
//     version: 0.2.0
//     summary: One line, in David's voice.
//     ---
// Short release posts only; no devlog (Harkfell's D38). The Markdown is the
// small subset the posts use: ## headings, paragraphs, "- " lists, **strong**,
// *em*, [text](url). Anything it does not know is text, escaped.
//
// Writes TREE/news/index.html (every post, newest first), TREE/news/<slug>/
// index.html (the slug is the file name without .md), and the feeds
// TREE/news/feed.xml (RSS 2.0) and TREE/news/feed.json (JSON Feed 1.1) in the
// shape Crash's Press site writes them. Then fills the landing's latest-post
// box: TREE/index.html (a copy of site/index.html) holds the markers
//     <!-- news:latest -->  ...  <!-- /news:latest -->
// once each, and what is between them becomes the newest post's title, date,
// summary and link, with links to all news and the RSS feed. site/index.html
// keeps a plain fallback there (the news links alone), so the page outside
// a stage still reads. Phantom Burn's /version.json is not written: Signal's
// game does not read one.
//
// Refuses (exit 1) on a post missing a field, a malformed date or version, an
// em dash anywhere, two posts for one version, or a landing without exactly
// one pair of markers.
import fs from "node:fs";
import path from "node:path";

const [SRC, TREE] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SITE = "https://signaloverdrive.net";
const NAME = "Signal Overdrive";
const die = (m) => { console.error(`build-news: ${m}`); process.exit(1); };
if (!SRC || !TREE) die("usage: build-news.mjs NEWS-DIR TREE");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(s) {
  let out = esc(s);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}
function markdown(body) {
  const html = [];
  const blocks = body.trim().split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split("\n");
    if (/^## /.test(lines[0]) && lines.length === 1) html.push(`<h2>${inline(lines[0].slice(3).trim())}</h2>`);
    else if (lines.every((l) => /^- /.test(l))) html.push("<ul>\n" + lines.map((l) => `  <li>${inline(l.slice(2).trim())}</li>`).join("\n") + "\n</ul>");
    else html.push(`<p>${inline(lines.join(" ").trim())}</p>`);
  }
  return html.join("\n");
}
// The landing's head, trimmed to what a news page needs: the same icons,
// font, stylesheet, the feeds, and the Plausible snippet in its gated form
// (the script tag is added only on signaloverdrive.net), as check-site's
// analytics leg requires of every page.
function page(title, description, canonical, main, depth) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#0a0a0c">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.ico" sizes="16x16 32x32">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="alternate" type="application/rss+xml" title="${NAME} news" href="/news/feed.xml">
  <link rel="alternate" type="application/feed+json" title="${NAME} news" href="/news/feed.json">
  <link rel="preload" href="/fonts/JetBrainsMono-Regular.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/style.css">
  <!-- Privacy-friendly analytics by Plausible (on signaloverdrive.net only: a copy played elsewhere, such as the itch.io build, sends nothing) -->
  <script>
    if (/^(www\\.)?signaloverdrive\\.net$/.test(location.hostname)) (function (s) { s.async = true; s.src = "https://plausible.io/js/pa-GCzY0KZPnFuB1DEsbPead.js"; document.head.appendChild(s); })(document.createElement("script"));
    window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
    plausible.init()
  </script>
</head>
<body>
  <main class="news">
    <p class="back"><a href="/">${NAME}</a>${depth > 1 ? ` / <a href="/news/">News</a>` : ""}</p>
${main}
  </main>
</body>
</html>
`;
}
const longDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

const posts = [];
for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith(".md")).sort()) {
  const text = fs.readFileSync(path.join(SRC, f), "utf8");
  if (/—/.test(text)) die(`${f} has an em dash`);
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) die(`${f} has no front matter`);
  const fm = Object.fromEntries(m[1].split("\n").filter((l) => l.trim()).map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const k of ["title", "date", "version", "summary"]) if (!fm[k]) die(`${f} has no ${k}:`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date) || isNaN(Date.parse(fm.date))) die(`${f}: date "${fm.date}" is not YYYY-MM-DD`);
  if (!/^\d+\.\d+\.\d+$/.test(fm.version)) die(`${f}: version "${fm.version}" is not X.Y.Z`);
  const slug = f.slice(0, -3);
  if (!/^[a-z0-9-]+$/.test(slug)) die(`${f}: the file name must be lowercase letters, digits and hyphens (it is the URL)`);
  posts.push({ ...fm, slug, body: m[2] });
}
if (!posts.length) die(`${SRC} has no posts`);
const versions = posts.map((p) => p.version);
const dup = versions.find((v, i) => versions.indexOf(v) !== i);
if (dup) die(`two posts for version ${dup}`);
posts.sort((a, b) => (b.date + b.version).localeCompare(a.date + a.version));

fs.mkdirSync(path.join(TREE, "news"), { recursive: true });
for (const p of posts) {
  fs.mkdirSync(path.join(TREE, "news", p.slug), { recursive: true });
  const main = `    <article class="post" data-version="${esc(p.version)}">
      <h1>${inline(p.title)}</h1>
      <p class="date"><time datetime="${p.date}">${longDate(p.date)}</time></p>
${markdown(p.body).split("\n").map((l) => "      " + l).join("\n")}
    </article>`;
  fs.writeFileSync(path.join(TREE, "news", p.slug, "index.html"), page(`${p.title} - ${NAME}`, p.summary, `${SITE}/news/${p.slug}/`, main, 2));
}
const list = posts.map((p) => `      <li data-version="${esc(p.version)}"><a href="/news/${p.slug}/">${inline(p.title)}</a>
        <time datetime="${p.date}">${longDate(p.date)}</time>
        <p>${inline(p.summary)}</p></li>`).join("\n");
fs.writeFileSync(path.join(TREE, "news", "index.html"), page(`News - ${NAME}`, `What's new in each release of ${NAME}.`, `${SITE}/news/`, `    <h1>News</h1>
    <p class="feeds">Follow along with <a href="/news/feed.xml">RSS</a> or <a href="/news/feed.json">JSON Feed</a>.</p>
    <ul class="post-list">
${list}
    </ul>`, 1));

// ---- the feeds (Crash's, as Press's (press feeds) writes them) --------------
// RSS 2.0 at /news/feed.xml and JSON Feed 1.1 at /news/feed.json, newest first,
// at most 20 entries. Each entry carries the post's absolute URL and its whole
// rendered body (Crash's feeds carry the body, not an excerpt), with the body's
// site-relative links made absolute so they work in a feed reader; the JSON
// Feed entry also carries the post's summary.
const FEED_TITLE = `${NAME} news`;
const FEED_DESC = `What's new in each release of ${NAME}.`;
const AUTHOR = "David Wilson";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rfc822 = (d) => { const t = new Date(d + "T00:00:00Z"); return `${WEEKDAYS[t.getUTCDay()]}, ${String(t.getUTCDate()).padStart(2, "0")} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()} 00:00:00 +0000`; };
const rfc3339 = (d) => `${d}T00:00:00Z`;
const absolute = (html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${SITE}/`);
const xml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const feedPosts = posts.slice(0, 20).map((p) => ({ ...p, url: `${SITE}/news/${p.slug}/`, html: absolute(markdown(p.body)) }));
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${xml(FEED_TITLE)}</title><link>${SITE}/</link><description>${xml(FEED_DESC)}</description><language>en</language><atom:link href="${SITE}/news/feed.xml" rel="self" type="application/rss+xml"></atom:link>${feedPosts.length ? `<lastBuildDate>${rfc822(feedPosts[0].date)}</lastBuildDate>` : ""}${feedPosts.map((p) => `<item><title>${xml(p.title)}</title><link>${p.url}</link><guid isPermaLink="true">${p.url}</guid><pubDate>${rfc822(p.date)}</pubDate><dc:creator>${AUTHOR}</dc:creator><description>${xml(p.html)}</description></item>`).join("")}</channel></rss>
`;
const jsonFeed = {
  version: "https://jsonfeed.org/version/1.1",
  title: FEED_TITLE,
  home_page_url: `${SITE}/`,
  description: FEED_DESC,
  language: "en",
  feed_url: `${SITE}/news/feed.json`,
  authors: [{ name: AUTHOR }],
  items: feedPosts.map((p) => ({ id: p.url, url: p.url, title: p.title, date_published: rfc3339(p.date), content_html: p.html, summary: p.summary })),
};
fs.writeFileSync(path.join(TREE, "news", "feed.xml"), rss);
fs.writeFileSync(path.join(TREE, "news", "feed.json"), JSON.stringify(jsonFeed, null, 2) + "\n");

// ---- the landing's latest post ----------------------------------------------
const OPEN = "<!-- news:latest -->", CLOSE = "<!-- /news:latest -->";
const landingFile = path.join(TREE, "index.html");
if (!fs.existsSync(landingFile)) die(`${landingFile} missing (the site is copied before this runs)`);
const landing = fs.readFileSync(landingFile, "utf8");
const count = (s) => landing.split(s).length - 1;
if (count(OPEN) !== 1 || count(CLOSE) !== 1 || landing.indexOf(OPEN) > landing.indexOf(CLOSE))
  die(`index.html must hold ${OPEN} then ${CLOSE}, once each (found ${count(OPEN)} and ${count(CLOSE)})`);
const latest = posts[0];
const box = `${OPEN}
    <section class="latest" aria-labelledby="latest-news">
      <h2 id="latest-news">Latest news</h2>
      <article data-version="${esc(latest.version)}">
        <h3><a class="latest-post" href="/news/${latest.slug}/">${inline(latest.title)}</a></h3>
        <p class="date"><time datetime="${latest.date}">${longDate(latest.date)}</time></p>
        <p>${inline(latest.summary)}</p>
      </article>
      <p class="news-links"><a href="/news/">All news</a> <span aria-hidden="true">/</span> <a href="/news/feed.xml">RSS</a></p>
    </section>
    ${CLOSE}`;
fs.writeFileSync(landingFile, landing.slice(0, landing.indexOf(OPEN)) + box + landing.slice(landing.indexOf(CLOSE) + CLOSE.length));
console.log(`build-news: ${posts.length} post(s) -> news/ (+ feed.xml, feed.json); the landing's latest: /news/${latest.slug}/ (${latest.version}, ${latest.date})`);
