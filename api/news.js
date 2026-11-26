const FEEDS = [
  { category: 'mercado', query: 'economia circular sustentabilidade OR economia brasileira mercado negócios' },
  { category: 'financas', query: 'finanças OR consórcios OR crédito OR renda fixa Brasil' },
  { category: 'cripto', query: 'Bitcoin OR criptomoedas OR blockchain mercado' },
  { category: 'tecnologia', query: 'tecnologia inovação transformação digital empresas' },
  { category: 'agronews', query: 'agronegócio OR agricultura digital OR AgTech Brasil' },
  { category: 'ia', query: 'inteligência artificial OR IA generativa OR agentes de IA' },
  { category: 'hackernews', query: 'cibersegurança OR segurança da informação OR tecnologia hacker' },
  { category: 'startups', query: 'startups OR venture capital OR inovação empreendedorismo' },
  { category: 'empreendedorismo', query: 'empreendedorismo OR pequenas empresas OR novos negócios' },
  { category: 'oportunidades', query: 'negócios B2B OR oportunidades empresariais OR mercado corporativo' },
  { category: 'empregos', query: 'vagas tecnologia OR empregos inovação OR carreira digital Brasil' }
];
function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '‹').replace(/&gt;/g, '›').replace(/\s+/g, ' ').trim();
}
function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}
function stableId(url, title) {
  let hash = 2166136261;
  for (const ch of (url || title)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return `feed-${(hash >>> 0).toString(36)}`;
}
async function fetchFeed(feed) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(feed.query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const response = await fetch(url, { headers: { 'User-Agent': 'RlopesNews/1.0 (+https://github.com/rlopes84/rlopes)', 'Accept': 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Feed ${feed.category}: HTTP ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0, 12);
  return items.map(([, item]) => {
    const title = tag(item, 'title'), link = tag(item, 'link'), description = tag(item, 'description');
    const source = tag(item, 'source') || 'Google Notícias', pubDate = tag(item, 'pubDate');
    const timestamp = pubDate ? new Date(pubDate).getTime() : Date.now();
    if (!title || !link || !/^https?:\/\//i.test(link)) return null;
    return { id: stableId(link, title), category: feed.category, title,
      summary: description.slice(0, 420) || 'Acesse a matéria para consultar os detalhes na fonte original.',
      body: description || title, insight: 'Conteúdo publicado por fonte externa. Consulte a matéria original para contexto e atualização.',
      source, time: Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('pt-BR') : 'Recente',
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(), url: link,
      tags: [feed.category, 'Notícia externa'], isNew: Date.now() - timestamp < 10800000, isLive: true };
  }).filter(Boolean);
}
async function fetchHackerNews() {
  const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('Hacker News indisponível');
  const ids = (await response.json()).slice(0, 12);
  const stories = await Promise.all(ids.map(async id => {
    try { const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(5000) }); return r.ok ? r.json() : null; }
    catch { return null; }
  }));
  return stories.filter(s => s && s.title).map(s => ({
    id: `hn-${s.id}`, category: 'hackernews', title: s.title,
    summary: `Discussão em alta no Hacker News: ${s.score || 0} pontos e ${s.descendants || 0} comentários.`,
    body: `Tópico publicado por ${s.by || 'comunidade Hacker News'}. Consulte a discussão original.`,
    insight: 'Sinal de tendência em tecnologia, engenharia, IA ou segurança.', source: 'Hacker News',
    time: new Date((s.time || Date.now() / 1000) * 1000).toLocaleString('pt-BR'),
    timestamp: (s.time || Date.now() / 1000) * 1000,
    url: s.url || `https://news.ycombinator.com/item?id=${s.id}`, tags: ['Hacker News', 'Tecnologia'],
    isNew: Date.now() - (s.time || 0) * 1000 < 10800000, isLive: true
  }));
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  const results = await Promise.allSettled([...FEEDS.map(fetchFeed), fetchHackerNews()]);
  const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const unique = new Map();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  const sorted = [...unique.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 120);
  return res.status(200).json({ updatedAt: new Date().toISOString(), count: sorted.length,
    failedFeeds: results.filter(r => r.status === 'rejected').length,
    sources: ['Google Notícias RSS', 'Hacker News API'], items: sorted });
};
