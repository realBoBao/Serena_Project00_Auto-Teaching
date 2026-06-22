import 'dotenv/config';

// Inline test — copy the function since it's not exported
function formatSourcesWithScore(results, type = 'web', maxItems = 5) {
  if (!results || results.length === 0) return '';

  const seen = new Set();
  const deduped = results.filter(r => {
    let key = r.url || r.title || '';
    const ytMatch = key.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (ytMatch) key = `yt:${ytMatch[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const items = deduped.slice(0, maxItems);
  const groups = { youtube: [], github: [], web: [], local: [], other: [] };
  for (const r of items) {
    const s = (r.source || 'other').toLowerCase();
    if (s.includes('youtube')) groups.youtube.push(r);
    else if (s.includes('github')) groups.github.push(r);
    else if (s.includes('local') || s.includes('vector') || s.includes('sqlite')) groups.local.push(r);
    else if (s.includes('web') || s.includes('tavily') || s.includes('google')) groups.web.push(r);
    else groups.other.push(r);
  }

  const lines = [];
  const avgScore = items.length > 0
    ? (items.reduce((s, r) => s + (r.score || 0), 0) / items.length).toFixed(2)
    : 'N/A';

  if (groups.youtube.length > 0) {
    const top = groups.youtube[0];
    const title = top.title.replace(/^\[YouTube\]\s*/, '').slice(0, 60);
    const url = top.url || '';
    const linked = url ? `[${title}](${url})` : title;
    lines.push(`🎬 **YouTube** (${groups.youtube.length} video) — ${linked}`);
  }
  if (groups.github.length > 0) {
    const top = groups.github[0];
    const title = top.title.replace(/^\[GitHub\]\s*/, '').slice(0, 60);
    const url = top.url || '';
    const linked = url ? `[${title}](${url})` : title;
    const stars = top.stars ? ` ⭐${Number(top.stars).toLocaleString()}` : '';
    lines.push(`💻 **GitHub** (${groups.github.length} repo) — ${linked}${stars}`);
  }
  if (groups.web.length > 0) {
    const top = groups.web[0];
    const title = top.title.slice(0, 60);
    const url = top.url || '';
    const linked = url ? `[${title}](${url})` : title;
    lines.push(`🌐 **Web** (${groups.web.length} nguồn) — ${linked}`);
  }
  if (groups.local.length > 0) {
    lines.push(`📁 **Local/Knowledge Base** (${groups.local.length} kết quả)`);
  }
  if (groups.other.length > 0) {
    const top = groups.other[0];
    const title = top.title.slice(0, 60);
    const url = top.url || '';
    const linked = url ? `[${title}](${url})` : title;
    lines.push(`📄 **Khác** (${groups.other.length}) — ${linked}`);
  }

  if (lines.length > 0) {
    lines.push(`\n📊 Điểm trung bình: ${avgScore}`);
  }

  return lines.join('\n');
}

// Mock data — like what webScout returns for "Algorithm"
const mockResults = [
  {
    title: '[YouTube] Mbappé Speed? 🏃💨',
    url: 'https://www.youtube.com/watch?v=M4eTRSAwbvE',
    source: 'youtube',
    score: 1.0,
    views: 36821856,
    likes: 582530,
    channelTitle: 'Footy Loops',
  },
  {
    title: '[YouTube] 15 Sorting Algorithms in 6 Minutes',
    url: 'https://www.youtube.com/watch?v=kPRA0W1kECg',
    source: 'youtube',
    score: 1.0,
    views: 27979163,
    likes: 558339,
    channelTitle: 'Timo Bingmann',
  },
  {
    title: '[YouTube] Advanced Algorithms (COMPSCI 224), Lecture 1',
    url: 'https://www.youtube.com/watch?v=0JUN9aDxVmI',
    source: 'youtube',
    score: 1.0,
    views: 20551732,
    likes: 259135,
    channelTitle: 'Harvard University',
  },
  {
    title: '[GitHub] TheAlgorithms/Python ⭐222,087',
    url: 'https://github.com/TheAlgorithms/Python',
    source: 'github',
    score: 0.95,
    stars: 222087,
    forks: 45000,
  },
  {
    title: '[GitHub] jwasham/coding-interview-university ⭐353,270',
    url: 'https://github.com/jwasham/coding-interview-university',
    source: 'github',
    score: 0.92,
    stars: 353270,
    forks: 85000,
  },
];

console.log('=== Test 1: Mixed YouTube + GitHub ===');
console.log(formatSourcesWithScore(mockResults, 'web', 5));

console.log('\n=== Test 2: Empty results ===');
console.log(JSON.stringify(formatSourcesWithScore([], 'web', 5)));

console.log('\n=== Test 3: Single YouTube ===');
console.log(formatSourcesWithScore([mockResults[0]], 'web', 5));

console.log('\n=== Test 4: GitHub only ===');
console.log(formatSourcesWithScore([mockResults[3], mockResults[4]], 'web', 5));

console.log('\n=== Test 5: Local results ===');
console.log(formatSourcesWithScore([
  { title: 'Algorithm doc', source: 'local', score: 0.8, collection: 'academic' },
  { title: 'Data structures', source: 'vector', score: 0.75 },
], 'local', 5));
