const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ITEMS_PER_FEED = 18;

const DIRECT_FEEDS = [
  { category: 'mercado', name: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml' },
  { category: 'mercado', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { category: 'tecnologia', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { category: 'tecnologia', name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { category: 'tecnologia', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { category: 'tecnologia', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { category: 'cripto', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { category: 'cripto', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { category: 'hackernews', name: 'Hacker News', url: 'https://news.ycombinator.com/rss' }
];

const GOOGLE_NEWS_FEEDS = [
  { category: 'mercado', query: '(economia OR negócios OR sustentabilidade OR "economia circular" OR mercado) when:2d' },
  { category: 'financas', query: '(finanças OR consórcios OR crédito OR investimentos OR "renda fixa") when:2d' },
  { category: 'cripto', query: '(Bitcoin OR criptomoedas OR blockchain OR criptoativos) when:2d' },
  { category: 'tecnologia', query: '(tecnologia OR inovação OR transformação digital OR cibersegurança) when:2d' },
  { category: 'agronews', query: '(agronegócio OR agricultura OR AgTech OR agroindústria OR commodities) when:2d' },
  { category: 'ia', query: '("inteligência artificial" OR "IA generativa" OR "agentes de IA") when:2d' },
  { category: 'startups', query: '(startups OR "venture capital" OR empreendedorismo OR inovação) when:2d' },
  { category: 'empreendedorismo', query: '("pequenas empresas" OR empreendedorismo OR negócios) when:2d' },
  { category: 'oportunidades', query: '("mercado corporativo" OR oportunidades empresariais OR negócios B2B) when:2d' },
  { category: 'empregos', query: '(vagas tecnologia OR empregos inovação OR carreira digital) when:2d' },
  { category: 'hackernews', query: '(cibersegurança OR "segurança da informação" OR engenharia de software) when:2d' }
];

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function cleanText(value = '') {
  return decodeXml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readTag(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp('<' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + escaped + '>', 'i'));
  return match ? match[1].trim() : '';
}

function readAtomLink(xml) {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  for (const match of links) {
    const attrs = match[1];
    const rel = (attrs.match(/\brel=["']([^"']+)["']/i) || [])[1] || 'alternate';
    const href = (attrs.match(/\bhref=["']([^"']+)["']/i) || [])[1];
    if (href && (rel === 'alternate' || rel === '')) return decodeXml(href);
  }
  return '';
}

function parseEntries(xml) {
  const rss = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(match => match[1]);
  if (rss.length) return rss;
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(match => match[1]);
}

function parseTimestamp(item) {
  const raw = readTag(item, 'pubDate') || readTag(item, 'published') ||
    readTag(item, 'updated') || readTag(item, 'dc:date');
  if (!raw) return null;
  const timestamp = Date.parse(decodeXml(raw).replace(/<[^>]+>/g, '').trim());
  return Number.isFinite(timestamp) ? timestamp : null;
}

function canonicalUrl(value = '') {
  try {
    const url = new URL(decodeXml(value));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return '';
  }
}

function stableId(url, title) {
  let hash = 2166136261;
  for (const ch of (url || title).toLowerCase()) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return 'news-' + (hash >>> 0).toString(36);
}

function classifySource(source = '') {
  const name = source.toLowerCase();
  if (/agência brasil|bbc|techcrunch|the verge|ars technica|coindesk|cointelegraph/.test(name)) return 'Veículo jornalístico';
  if (/reuters|associated press|\bap news\b|afp/.test(name)) return 'Agência internacional';
  if (/hacker news/.test(name)) return 'Comunidade de tecnologia';
  if (/google notícias/.test(name)) return 'Agregador de notícias';
  return 'Fonte externa';
}

function mapFeedEntry(item, feed, now) {
  const title = cleanText(readTag(item, 'title'));
  const rawLink = readTag(item, 'link') || readAtomLink(item) || readTag(item, 'guid');
  const url = canonicalUrl(rawLink);
  const timestamp = parseTimestamp(item);
  if (!title || !url || timestamp === null) return null;
  const age = now - timestamp;
  if (age < -FUTURE_TOLERANCE_MS || age > MAX_AGE_MS) return null;

  const sourceFromFeed = cleanText(readTag(item, 'source'));
  const source = sourceFromFeed || feed.name;
  const description = cleanText(readTag(item, 'description') || readTag(item, 'summary') || readTag(item, 'content:encoded'));
  return {
    id: stableId(url, title),
    category: feed.category,
    title,
    summary: (description || 'Acesse a publicação original para consultar os detalhes.') .slice(0, 420),
    body: description || title,
    insight: 'Notícia recente publicada pela fonte original. Consulte o link para contexto e informações completas.',
    source,
    sourceType: classifySource(source),
    time: new Date(timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    timestamp,
    url,
    tags: [feed.category, 'Notícia recente'],
    isNew: age <= 3 * 60 * 60 * 1000,
    isLive: true
  };
}

async function fetchOneFeed(feed, now) {
  const response = await fetch(feed.url, {
    headers: {
      'User-Agent': 'RlopesNews/2.0 (+https://rlopes-news.vercel.app)',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const xml = await response.text();
  const entries = parseEntries(xml).slice(0, MAX_ITEMS_PER_FEED);
  return entries.map(item => mapFeedEntry(item, feed, now)).filter(Boolean);
}

function googleNewsUrl(query) {
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) +
    '&hl=pt-BR&gl=BR&ceid=BR:pt-419';
}

async function fetchGoogleFeed(feed, now) {
  return fetchOneFeed({
    ...feed,
    name: 'Google Notícias',
    url: googleNewsUrl(feed.query)
  }, now);
}

async function fetchHackerNews(now) {
  const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('Hacker News HTTP ' + response.status);
  const ids = (await response.json()).slice(0, 20);
  const stories = await Promise.all(ids.map(async id => {
    try {
      const result = await fetch('https://hacker-news.firebaseio.com/v0/item/' + id + '.json', {
        signal: AbortSignal.timeout(5000)
      });
      return result.ok ? result.json() : null;
    } catch {
      return null;
    }
  }));
  return stories.filter(story => story && story.title && story.time).map(story => {
    const timestamp = story.time * 1000;
    const age = now - timestamp;
    if (age < -FUTURE_TOLERANCE_MS || age > MAX_AGE_MS) return null;
    const url = canonicalUrl(story.url || ('https://news.ycombinator.com/item?id=' + story.id));
    return {
      id: 'hn-' + story.id,
      category: 'hackernews',
      title: cleanText(story.title),
      summary: 'Discussão no Hacker News: ' + (story.score || 0) + ' pontos e ' + (story.descendants || 0) + ' comentários.',
      body: 'Tópico publicado por ' + (story.by || 'comunidade Hacker News') + '. Consulte a discussão original.',
      insight: 'Sinal de tendência em tecnologia, engenharia, IA ou segurança.',
      source: 'Hacker News',
      sourceType: 'Comunidade de tecnologia',
      time: new Date(timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      timestamp,
      url,
      tags: ['Hacker News', 'Tecnologia'],
      isNew: age <= 3 * 60 * 60 * 1000,
      isLive: true
    };
  }).filter(Boolean);
}

module.exports = async function handler(req, res) {
  const forceRefresh = req.query && req.query.refresh === '1';
  res.setHeader('Cache-Control', forceRefresh ? 'no-store, max-age=0' : 'public, s-maxage=60, stale-while-revalidate=120');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const now = Date.now();
  const jobs = [
    ...DIRECT_FEEDS.map(feed => ({ name: feed.name, category: feed.category, run: () => fetchOneFeed(feed, now) })),
    ...GOOGLE_NEWS_FEEDS.map(feed => ({ name: 'Google Notícias', category: feed.category, run: () => fetchGoogleFeed(feed, now) })),
    { name: 'Hacker News API', category: 'hackernews', run: () => fetchHackerNews(now) }
  ];

  const results = await Promise.allSettled(jobs.map(job => job.run()));
  const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const unique = new Map();
  for (const item of items) {
    const existing = unique.get(item.id);
    if (!existing || item.timestamp > existing.timestamp) unique.set(item.id, item);
  }

  const sorted = [...unique.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 160);
  const successfulFeeds = results.filter(result => result.status === 'fulfilled').length;
  const failedFeeds = jobs.length - successfulFeeds;
  const sourceNames = [...new Set(sorted.map(item => item.source))];

  return res.status(200).json({
    updatedAt: new Date(now).toISOString(),
    freshnessWindowHours: 48,
    count: sorted.length,
    successfulFeeds,
    failedFeeds,
    feedChecks: jobs.map((job, index) => ({
      source: job.name,
      category: job.category,
      status: results[index].status === 'fulfilled' ? 'ok' : 'error'
    })),
    sources: sourceNames,
    items: sorted
  });
};
