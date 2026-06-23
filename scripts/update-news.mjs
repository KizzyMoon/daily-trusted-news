import { writeFile, mkdir } from "node:fs/promises";

const feeds = [
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

const importantTerms = [
  "war", "election", "government", "prime minister", "president", "parliament",
  "crisis", "disaster", "earthquake", "flood", "wildfire", "ceasefire", "sanctions",
  "economy", "inflation", "interest rates", "nhs", "who", "outbreak", "climate",
  "court", "supreme court", "conflict", "minister", "budget", "recession", "attack"
];

const stopWords = new Set([
  "about", "after", "again", "amid", "before", "being", "could", "from", "have",
  "into", "more", "over", "says", "than", "that", "their", "them", "this",
  "with", "will", "your", "what", "when", "where", "which", "while", "would"
]);

const results = await Promise.allSettled(feeds.map(loadFeed));
const articles = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
const failures = results
  .map((result, index) => result.status === "rejected" ? {
    source: feeds[index].source,
    category: feeds[index].category,
    message: result.reason?.message || "Unknown error"
  } : null)
  .filter(Boolean);

const stories = rankStories(groupRelatedStories(articles));

await mkdir(".", { recursive: true });
await writeFile("news.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  storyCount: stories.length,
  failures,
  stories
}, null, 2));

console.log(`Wrote news.json with ${stories.length} grouped stories.`);
if (failures.length) {
  console.log(`Skipped ${failures.length} feeds: ${failures.map((failure) => failure.source).join(", ")}`);
}

async function loadFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { "user-agent": "DailyTrustedBriefing/1.0 (+https://github.com/)" }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const xml = await response.text();
  return parseFeed(xml, feed).slice(0, 18);
}

function parseFeed(xml, feed) {
  const blocks = matchBlocks(xml, "item").length ? matchBlocks(xml, "item") : matchBlocks(xml, "entry");
  return blocks.map((block) => normaliseItem(block, feed)).filter(Boolean);
}

function normaliseItem(block, feed) {
  const title = cleanText(readTag(block, "title"));
  const link = readLink(block);
  if (!title || !link) return null;

  const snippet = cleanText(
    readTag(block, "description") ||
    readTag(block, "summary") ||
    readTag(block, "content") ||
    readTag(block, "content:encoded")
  ).slice(0, 260);
  const published = new Date(
    readTag(block, "pubDate") ||
    readTag(block, "published") ||
    readTag(block, "updated") ||
    Date.now()
  );

  return {
    id: stableStoryId(title, link),
    title,
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
    const keywordHits = importantTerms.filter((term) => allText.includes(term));
    const sourceBoost = Math.max(0, group.sources.size - 1) * 14;
    const recencyHours = Math.max(1, (Date.now() - group.published.getTime()) / 36e5);
    const recencyBoost = Math.max(0, 18 - recencyHours * 0.8);
    const score = sourceBoost + keywordHits.length * 6 + recencyBoost + Math.min(group.items.length, 4) * 3;

    return {
      title: group.title,
      link: group.link,
      snippet: group.snippet,
      source: group.source,
      category: group.category,
      published: group.published.toISOString(),
      sources: [...group.sources],
      categories: [...group.categories],
      keywordHits,
      score,
      why: whyThisMatters(group, keywordHits)
    };
  });
}

function rankStories(groups) {
  return groups.sort((a, b) => b.score - a.score || new Date(b.published) - new Date(a.published));
}

function matchBlocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"))].map((match) => match[0]);
}

function readTag(block, tag) {
  const escaped = tag.replace(":", "\\:");
  const match = block.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return decodeEntities(stripCdata(match?.[1] || ""));
}

function readLink(block) {
  const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return decodeEntities(atomLink || readTag(block, "link"));
}

function stripCdata(value) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function cleanText(value) {
  return decodeEntities(String(value || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function headlineSignature(title) {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word))
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
  return `${headlineSignature(title).join("-")}-${new URL(link).hostname}`;
}

function whyThisMatters(group, keywordHits) {
  if (group.sources.size > 1) {
    return "Multiple reputable outlets are covering this, which usually signals wider public significance.";
  }
  if (keywordHits.includes("election") || keywordHits.includes("government") || keywordHits.includes("parliament")) {
    return "This could affect public policy, leadership, or democratic decision-making.";
  }
  if (keywordHits.includes("outbreak") || keywordHits.includes("who") || keywordHits.includes("nhs")) {
    return "This may affect public health guidance, services, or risk levels.";
  }
  if (keywordHits.includes("economy") || keywordHits.includes("inflation") || keywordHits.includes("interest rates")) {
    return "Economic shifts can affect household costs, jobs, markets, and public spending.";
  }
  if (keywordHits.includes("war") || keywordHits.includes("conflict") || keywordHits.includes("ceasefire")) {
    return "Conflict stories can have humanitarian, diplomatic, and security consequences.";
  }
  if (keywordHits.includes("climate") || keywordHits.includes("disaster")) {
    return "Environmental and disaster stories can affect safety, infrastructure, and long-term policy.";
  }
  return "";
}
