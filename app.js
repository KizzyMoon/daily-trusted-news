const FEEDS = [
  { source: "BBC", category: "world", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "BBC", category: "uk", url: "https://feeds.bbci.co.uk/news/uk/rss.xml" },
  { source: "BBC", category: "science-tech", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml" },
  { source: "BBC", category: "science-tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { source: "BBC", category: "health", url: "https://feeds.bbci.co.uk/news/health/rss.xml" },
  { source: "BBC", category: "business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { source: "The Guardian", category: "world", url: "https://www.theguardian.com/world/rss" },
  { source: "The Guardian", category: "uk", url: "https://www.theguardian.com/uk-news/rss" },
  { source: "The Guardian", category: "science-tech", url: "https://www.theguardian.com/science/rss" },
  { source: "The Guardian", category: "science-tech", url: "https://www.theguardian.com/technology/rss" },
  { source: "The Guardian", category: "business", url: "https://www.theguardian.com/business/rss" },
  { source: "NPR", category: "world", url: "https://feeds.npr.org/1004/rss.xml" },
  { source: "NPR", category: "science-tech", url: "https://feeds.npr.org/1007/rss.xml" },
  { source: "NPR", category: "health", url: "https://feeds.npr.org/1128/rss.xml" },
  { source: "NPR", category: "business", url: "https://feeds.npr.org/1006/rss.xml" },
  { source: "Al Jazeera", category: "world", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "WHO", category: "health", url: "https://www.who.int/rss-feeds/news-english.xml" }
];

const SECTIONS = ["top", "world", "uk", "science-tech", "health", "business"];
const IMPORTANT_TERMS = [
  "war", "election", "government", "prime minister", "president", "parliament",
  "crisis", "disaster", "earthquake", "flood", "wildfire", "ceasefire", "sanctions",
  "economy", "inflation", "interest rates", "nhs", "who", "outbreak", "climate",
  "court", "supreme court", "conflict", "minister", "budget", "recession", "attack"
];

const STORAGE_KEY = "daily-briefing-read-links";
const CACHE_KEY = "daily-briefing-cache-v1";
const GENERATED_NEWS_URL = "news.json";

const state = {
  stories: [],
  grouped: {},
  activeSection: "top",
  hideRead: true,
  readLinks: new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"))
};

const elements = {
  refreshButton: document.querySelector("#refresh-button"),
  toggleReadButton: document.querySelector("#toggle-read-button"),
  todayLabel: document.querySelector("#today-label"),
  lastUpdated: document.querySelector("#last-updated"),
  storyCount: document.querySelector("#story-count"),
  loadingPanel: document.querySelector("#loading-panel"),
  errorPanel: document.querySelector("#error-panel"),
  errorMessage: document.querySelector("#error-message")
};

const sectionLists = Object.fromEntries(
  SECTIONS.map((section) => [section, document.querySelector(`#${section}-stories`)])
);

init();

function init() {
  elements.todayLabel.textContent = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date());

  document.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => setActiveSection(button.dataset.section));
  });

  elements.refreshButton.addEventListener("click", () => loadBriefing({ force: true }));
  elements.toggleReadButton.addEventListener("click", toggleHideRead);
  document.body.classList.toggle("show-read", !state.hideRead);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  restoreCache();
  loadBriefing();
}

async function loadBriefing({ force = false } = {}) {
  setLoading(true);
  elements.errorPanel.hidden = true;
  elements.refreshButton.disabled = true;

  const generated = await loadGeneratedBriefing();
  if (generated.length) {
    state.stories = generated;
    saveCache();
    render();
    setLoading(false);
    elements.refreshButton.disabled = false;
    return;
  }

  const settled = await Promise.allSettled(FEEDS.map(loadFeed));
  const articles = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failures = settled
    .map((result, index) => result.status === "rejected" ? FEEDS[index].source : null)
    .filter(Boolean);

  if (articles.length || force) {
    state.stories = rankStories(groupRelatedStories(articles));
    saveCache();
  }

  if (failures.length) {
    const uniqueFailures = [...new Set(failures)].join(", ");
    elements.errorMessage.textContent = `${uniqueFailures} could not be reached in this browser refresh. The rest of the briefing is still shown.`;
    elements.errorPanel.hidden = false;
  }

  if (!state.stories.length && !failures.length) {
    elements.errorMessage.textContent = "No feed items were returned. Try Refresh again in a moment.";
    elements.errorPanel.hidden = false;
  }

  render();
  setLoading(false);
  elements.refreshButton.disabled = false;
}

async function loadGeneratedBriefing() {
  try {
    const response = await fetch(`${GENERATED_NEWS_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data.stories)) return [];
    return data.stories.map((story) => ({
      ...story,
      published: new Date(story.published)
    }));
  } catch (error) {
    return [];
  }
}

async function loadFeed(feed) {
  const text = await fetchFeedText(feed.url);
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error(`Invalid feed: ${feed.source}`);

  const nodes = [...doc.querySelectorAll("item, entry")].slice(0, 18);
  return nodes.map((node) => normaliseItem(node, feed)).filter(Boolean);
}

async function fetchFeedText(url) {
  const endpoints = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (response.ok) return await response.text();
    } catch (error) {
      // Static GitHub Pages apps cannot control publisher CORS headers.
      // If these public fallbacks become unreliable, add a tiny RSS proxy later.
    }
  }

  throw new Error(`Could not fetch ${url}`);
}

function normaliseItem(node, feed) {
  const title = textFrom(node, "title");
  const link = linkFrom(node);
  if (!title || !link) return null;

  const snippet = cleanText(
    textFrom(node, "description") ||
    textFrom(node, "summary") ||
    textFrom(node, "content") ||
    textFrom(node, "content\\:encoded")
  );
  const published = new Date(
    textFrom(node, "pubDate") ||
    textFrom(node, "published") ||
    textFrom(node, "updated") ||
    Date.now()
  );

  return {
    id: stableStoryId(title, link),
    title: cleanText(title),
    link,
    snippet,
    source: feed.source,
    category: feed.category,
    published: Number.isNaN(published.getTime()) ? new Date() : published
  };
}

function groupRelatedStories(articles) {
  const sorted = articles.sort((a, b) => b.published - a.published);
  const groups = [];

  sorted.forEach((article) => {
    const signature = headlineSignature(article.title);
    const existing = groups.find((group) => similarity(signature, group.signature) >= 0.45);

    if (existing) {
      existing.items.push(article);
      existing.sources.add(article.source);
      if (article.published > existing.published) existing.published = article.published;
      existing.categories.add(article.category);
      return;
    }

    groups.push({
      signature,
      title: article.title,
      link: article.link,
      snippet: article.snippet,
      source: article.source,
      category: article.category,
      published: article.published,
      items: [article],
      sources: new Set([article.source]),
      categories: new Set([article.category])
    });
  });

  return groups.map((group) => {
    const allText = `${group.title} ${group.snippet}`.toLowerCase();
    const keywordHits = IMPORTANT_TERMS.filter((term) => allText.includes(term));
    const sourceBoost = Math.max(0, group.sources.size - 1) * 14;
    const recencyHours = Math.max(1, (Date.now() - group.published.getTime()) / 36e5);
    const recencyBoost = Math.max(0, 18 - recencyHours * 0.8);
    const score = sourceBoost + keywordHits.length * 6 + recencyBoost + Math.min(group.items.length, 4) * 3;

    return {
      ...group,
      sources: [...group.sources],
      categories: [...group.categories],
      keywordHits,
      score,
      why: whyThisMatters(group, keywordHits)
    };
  });
}

function rankStories(groups) {
  return groups.sort((a, b) => b.score - a.score || b.published - a.published);
}

function render() {
  const bySection = {
    top: state.stories.slice(0, 12),
    world: storiesFor("world"),
    uk: storiesFor("uk"),
    "science-tech": storiesFor("science-tech"),
    health: storiesFor("health"),
    business: storiesFor("business")
  };

  state.grouped = bySection;

  SECTIONS.forEach((section) => {
    const list = sectionLists[section];
    const stories = bySection[section];
    list.innerHTML = stories.length
      ? stories.map(storyCard).join("")
      : `<div class="empty-state">No unread stories in this section right now. Refresh later or show read stories.</div>`;

    const count = document.querySelector(`[data-count-for="${section}"]`);
    if (count) count.textContent = `${stories.length} ${stories.length === 1 ? "story" : "stories"}`;
  });

  document.querySelectorAll(".read-toggle").forEach((button) => {
    button.addEventListener("click", () => toggleStoryRead(button.dataset.link));
  });

  document.body.classList.toggle("show-read", !state.hideRead);
  elements.lastUpdated.textContent = `Last updated ${formatTime(new Date())}`;
  elements.storyCount.textContent = `${state.stories.length} grouped stories`;
}

function storiesFor(category) {
  return state.stories
    .filter((story) => story.categories.includes(category))
    .slice(0, 10);
}

function storyCard(story) {
  const isRead = state.readLinks.has(story.link);
  const also = story.sources.filter((source) => source !== story.source);
  const sourceText = also.length ? `Also reported by: ${also.join(", ")}` : "Single-source item";
  const published = formatDate(story.published);
  const categoryLabel = labelFor(story.category);
  const priorityClass = story.sources.length > 1 || story.keywordHits.length > 1 ? "priority-high" : "";

  return `
    <article class="story-card ${priorityClass} ${isRead ? "is-read" : ""}">
      <div class="meta-row">
        <span class="badge">${escapeHtml(story.source)}</span>
        <span class="badge category">${categoryLabel}</span>
        ${story.sources.length > 1 ? `<span class="badge multi-source">${story.sources.length} sources</span>` : ""}
      </div>
      <h3><a href="${escapeAttribute(story.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.title)}</a></h3>
      ${story.snippet ? `<p class="snippet">${escapeHtml(story.snippet)}</p>` : ""}
      ${story.why ? `<p class="why"><strong>Why this matters:</strong> ${escapeHtml(story.why)}</p>` : ""}
      <div class="source-row">
        <span><strong>${escapeHtml(story.source)}</strong> · ${published}</span>
        <span>${escapeHtml(sourceText)}</span>
      </div>
      <div class="card-actions">
        <a class="original-link" href="${escapeAttribute(story.link)}" target="_blank" rel="noopener noreferrer">Original article</a>
        <button class="read-toggle" type="button" data-link="${escapeAttribute(story.link)}">${isRead ? "Mark unread" : "Mark read"}</button>
      </div>
    </article>
  `;
}

function setActiveSection(section) {
  state.activeSection = section;
  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === section);
  });
  document.querySelectorAll("[data-section-panel]").forEach((panel) => {
    panel.classList.toggle("is-visible", panel.dataset.sectionPanel === section);
  });
}

function toggleHideRead() {
  state.hideRead = !state.hideRead;
  elements.toggleReadButton.setAttribute("aria-pressed", String(state.hideRead));
  elements.toggleReadButton.textContent = state.hideRead ? "Hide read" : "Show read";
  document.body.classList.toggle("show-read", !state.hideRead);
}

function toggleStoryRead(link) {
  if (state.readLinks.has(link)) {
    state.readLinks.delete(link);
  } else {
    state.readLinks.add(link);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.readLinks]));
  render();
}

function setLoading(isLoading) {
  elements.loadingPanel.hidden = !isLoading;
}

function restoreCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!cached?.stories?.length) return;
    state.stories = cached.stories.map((story) => ({ ...story, published: new Date(story.published) }));
    render();
  } catch (error) {
    localStorage.removeItem(CACHE_KEY);
  }
}

function saveCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    stories: state.stories,
    savedAt: new Date().toISOString()
  }));
}

function textFrom(node, selector) {
  return node.querySelector(selector)?.textContent?.trim() || "";
}

function linkFrom(node) {
  const rssLink = textFrom(node, "link");
  if (rssLink) return rssLink;
  return node.querySelector("link[href]")?.getAttribute("href") || "";
}

function cleanText(value) {
  const div = document.createElement("div");
  div.innerHTML = value || "";
  return (div.textContent || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim()
    .slice(0, 260);
}

function headlineSignature(title) {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
    .slice(0, 10);
}

function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  const overlap = [...aSet].filter((word) => bSet.has(word)).length;
  return overlap / Math.max(aSet.size, bSet.size);
}

function stableStoryId(title, link) {
  return `${headlineSignature(title).join("-")}-${new URL(link, location.href).hostname}`;
}

function whyThisMatters(group, keywordHits) {
  const widelyReported = group.sources.size > 1 ? " It is also being reported by more than one trusted outlet." : "";

  if (keywordHits.includes("election") || keywordHits.includes("government") || keywordHits.includes("parliament")) {
    return `This could affect public policy, leadership, or democratic decision-making.${widelyReported}`;
  }
  if (keywordHits.includes("outbreak") || keywordHits.includes("who") || keywordHits.includes("nhs")) {
    return `This may affect public health guidance, services, or risk levels.${widelyReported}`;
  }
  if (keywordHits.includes("economy") || keywordHits.includes("inflation") || keywordHits.includes("interest rates")) {
    return `Economic shifts can affect household costs, jobs, markets, and public spending.${widelyReported}`;
  }
  if (keywordHits.includes("war") || keywordHits.includes("conflict") || keywordHits.includes("ceasefire")) {
    return `Conflict stories can have humanitarian, diplomatic, and security consequences.${widelyReported}`;
  }
  if (keywordHits.includes("climate") || keywordHits.includes("disaster")) {
    return `Environmental and disaster stories can affect safety, infrastructure, and long-term policy.${widelyReported}`;
  }

  if (group.category === "business") {
    return `Business and economy stories can affect prices, jobs, markets, and public finances.${widelyReported}`;
  }
  if (group.category === "health") {
    return `Health stories can affect services, guidance, research priorities, or everyday risk decisions.${widelyReported}`;
  }
  if (group.category === "science-tech") {
    return `Science and technology stories can shape regulation, research, security, and how people use new tools.${widelyReported}`;
  }
  if (group.category === "uk") {
    return `UK stories can affect public services, national policy, and daily life across the country.${widelyReported}`;
  }
  if (group.category === "world") {
    return `World stories can affect diplomacy, security, trade, migration, or humanitarian conditions.${widelyReported}`;
  }
  if (group.sources.size > 1) {
    return "This is being reported by more than one trusted outlet, which can signal wider public significance.";
  }
  return "";
}

function labelFor(category) {
  return {
    world: "World",
    uk: "UK",
    "science-tech": "Science & Tech",
    health: "Health",
    business: "Business"
  }[category] || "News";
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

const STOP_WORDS = new Set([
  "about", "after", "again", "amid", "before", "being", "could", "from", "have",
  "into", "more", "over", "says", "than", "that", "their", "them", "this",
  "with", "will", "your", "what", "when", "where", "which", "while", "would"
]);
