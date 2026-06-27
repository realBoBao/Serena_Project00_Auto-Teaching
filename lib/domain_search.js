/**
 * lib/domain_search.js — DuckDuckGo + 50+ tech domains thay Google CSE
 * Miễn phí, không cần API key
 */

export const TECH_DOMAINS = [
  // Backend & DB
  'nodejs.org', 'sqlite.org', 'redis.io', 'expressjs.com',
  'bullmq.io', 'postgresql.org', 'elastic.co', 'mongodb.com',
  'neo4j.com', 'kafka.apache.org', 'ansible.com',
  // DevOps & Cloud
  'cloud.google.com', 'docker.com', 'kubernetes.io',
  'nginx.org', 'prometheus.io', 'grafana.com',
  'cloudflare.com', 'digitalocean.com', 'ubuntu.com',
  'linux.die.net', 'kernel.org', 'hashicorp.com',
  // AI & ML
  'huggingface.co', 'arxiv.org', 'qdrant.tech',
  'ollama.com', 'openrouter.ai', 'docs.anthropic.com',
  'platform.openai.com', 'pytorch.org', 'deeplearning.ai',
  'lilianweng.github.io',
  // Engineering blogs
  'engineering.fb.com', 'netflixtechblog.com',
  'discord.com', 'uber.com', 'bytebytego.com',
  'infoq.com', 'highscalability.com', 'martinfowler.com',
  // CS & Learning
  'stackoverflow.com', 'dev.to', 'geeksforgeeks.org',
  'leetcode.com', 'refactoring.guru', 'microservices.io',
  'developer.mozilla.org', 'github.blog', 'news.ycombinator.com',
  'hackerrank.com', 'teachyourselfcs.com', 'cs231n.github.io',
  'ocw.mit.edu',
  // Programming languages
  'go.dev', 'rust-lang.org', 'typescriptlang.org',
  'python.org', 'cppreference.com', 'isocpp.org',
  'spring.io', 'fastapi.tiangolo.com', 'nestjs.com',
  // More
  'docs.aws.amazon.com', 'docs.docker.com',
  'freecodecamp.org', 'towardsdatascience.com',
];

/**
 * Search tech domains via DuckDuckGo + RSS + GitHub
 */
export async function searchTechDomains(query, limit = 10) {
  const results = [];

  // Strategy 1: DuckDuckGo với site: filter
  try {
    const siteFilter = TECH_DOMAINS.slice(0, 5).map(d => `site:${d}`).join(' OR ');
    const ddgQuery = `${query} (${siteFilter})`;
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(ddgQuery)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'Serena-Brain/1.0' } }
    );
    if (res.ok) {
      const data = await res.json();
      const items = [...(data.Results || []), ...(data.RelatedTopics || [])];
      for (const item of items.slice(0, 5)) {
        if (item.FirstURL && item.Text) {
          results.push({ title: item.Text.slice(0, 100), url: item.FirstURL, src: 'DDG', score: 0.7 });
        }
      }
    }
  } catch { /* ignore */ }

  // Strategy 2: RSS sources
  const RSS_SOURCES = [
    { url: `https://hnrss.org/newest?q=${encodeURIComponent(query)}&count=5`, src: 'HN' },
    { url: `https://dev.to/api/articles?tag=${encodeURIComponent(query.split(' ')[0])}&per_page=5`, src: 'DevTo' },
    { url: `https://lobste.rs/search.json?q=${encodeURIComponent(query)}&what=stories&order=newest`, src: 'Lobsters' },
  ];
  for (const source of RSS_SOURCES) {
    try {
      const res = await fetch(source.url, { headers: { 'User-Agent': 'Serena-Brain/1.0' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.stories || data.items || []);
        for (const item of items.slice(0, 3)) {
          results.push({ title: item.title || item.name || 'Untitled', url: item.url || item.canonical_url || '', src: source.src, score: 0.75 });
        }
      } else if (ct.includes('xml') || ct.includes('rss')) {
        const xml = await res.text();
        for (const m of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3)) {
          const title = m[1].match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
          const link = m[1].match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
          if (title && link) results.push({ title, url: link, src: source.src, score: 0.75 });
        }
      }
    } catch { /* ignore */ }
  }

  // Strategy 3: GitHub search
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${limit}`,
      { headers: { 'User-Agent': 'Serena-Brain/1.0' } }
    );
    if (res.ok) {
      const data = await res.json();
      for (const repo of (data.items || []).slice(0, 3)) {
        results.push({ title: `${repo.full_name} — ${(repo.description || '').slice(0, 60)}`, url: repo.html_url, src: 'GitHub', score: Math.min(1, repo.stargazers_count / 1000) });
      }
    }
  } catch { /* ignore */ }

  // Dedup và sort
  const seen = new Set();
  return results.filter(r => { if (!r.url || seen.has(r.url)) return false; seen.add(r.url); return true; }).sort((a, b) => b.score - a.score).slice(0, limit);
}
