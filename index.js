if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const RSSParser = require('rss-parser');
const axios = require('axios');
const cron = require('node-cron');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  realtime: { transport: ws }
});
const rss = new RSSParser({ xmlParserOptions: { strict: false } });

function getToday() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}
function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}
function getISODaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
function extractTags(text) {
  if (!text) return [];
  const keywords = ['energy','defense','tech','pharma','agriculture','semiconductor','infrastructure','manufacturing','AI','nuclear','LNG','subsidy'];
  return keywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getStockPrice(ticker) {
  await sleep(1200);
  try {
    const res = await axios.get('https://finnhub.io/api/v1/quote', {
      params: { symbol: ticker, token: process.env.FINNHUB_API_KEY },
      timeout: 10000
    });
    return res.data.c || null;
  } catch (e) {
    console.error(`Price error for ${ticker}:`, e.message);
    return null;
  }
}

async function getStockData(ticker) {
  const data = { ticker };
  try {
    await sleep(1200);
    const quote = await axios.get('https://finnhub.io/api/v1/quote', {
      params: { symbol: ticker, token: process.env.FINNHUB_API_KEY }
    });
    data.current_price = quote.data.c;
    data.day_change_pct = quote.data.dp;
    data.day_high = quote.data.h;
    data.day_low = quote.data.l;

    await sleep(1200);
    const profile = await axios.get('https://finnhub.io/api/v1/stock/profile2', {
      params: { symbol: ticker, token: process.env.FINNHUB_API_KEY }
    });
    data.company_name = profile.data.name;
    data.market_cap = profile.data.marketCapitalization;
    data.industry = profile.data.finnhubIndustry;

    await sleep(1200);
    const metrics = await axios.get('https://finnhub.io/api/v1/stock/metric', {
      params: { symbol: ticker, metric: 'all', token: process.env.FINNHUB_API_KEY }
    });
    const m = metrics.data.metric || {};
    data.pe_ratio = m.peNormalizedAnnual || m.peTTM;
    data.eps = m.epsNormalizedAnnual;
    data.revenue_growth = m.revenueGrowthTTMYoy;
    data.dividend_yield = m.dividendYieldIndicatedAnnual;
    data.ma_50 = m['50DayMovingAverage'];
    data.ma_200 = m['200DayMovingAverage'];
    data.week_52_high = m['52WeekHigh'];
    data.week_52_low = m['52WeekLow'];
    data.beta = m.beta;

    await sleep(1200);
    const reco = await axios.get('https://finnhub.io/api/v1/stock/recommendation', {
      params: { symbol: ticker, token: process.env.FINNHUB_API_KEY }
    });
    if (reco.data?.[0]) {
      const r = reco.data[0];
      data.analyst_strong_buy = r.strongBuy;
      data.analyst_buy = r.buy;
      data.analyst_hold = r.hold;
      data.analyst_sell = r.sell;
      data.analyst_strong_sell = r.strongSell;
    }

    await sleep(1200);
    const target = await axios.get('https://finnhub.io/api/v1/stock/price-target', {
      params: { symbol: ticker, token: process.env.FINNHUB_API_KEY }
    });
    data.target_high = target.data.targetHigh;
    data.target_low = target.data.targetLow;
    data.target_mean = target.data.targetMean;

    return data;
  } catch (e) {
    console.error(`Data fetch error for ${ticker}:`, e.message);
    return data;
  }
}

async function analyzeStock(ticker, companyName) {
  console.log(`Analyzing ${ticker}...`);
  try {
    const data = await getStockData(ticker);
    if (!data.current_price) {
      console.log(`No data for ${ticker}, skipping`);
      return;
    }

    const prompt = `You are a senior equity analyst. Analyze ${ticker} (${companyName || data.company_name}) using these data points:

CURRENT PRICE: $${data.current_price}
DAY CHANGE: ${data.day_change_pct?.toFixed(2)}%
52-WEEK RANGE: $${data.week_52_low} - $${data.week_52_high}
MARKET CAP: $${data.market_cap}M
INDUSTRY: ${data.industry}

TECHNICALS:
- 50-day MA: $${data.ma_50}
- 200-day MA: $${data.ma_200}
- Beta: ${data.beta}

FUNDAMENTALS:
- P/E ratio: ${data.pe_ratio}
- EPS: $${data.eps}
- Revenue growth YoY: ${data.revenue_growth}%
- Dividend yield: ${data.dividend_yield}%

ANALYST CONSENSUS:
- Strong Buy: ${data.analyst_strong_buy || 0}
- Buy: ${data.analyst_buy || 0}
- Hold: ${data.analyst_hold || 0}
- Sell: ${data.analyst_sell || 0}
- Strong Sell: ${data.analyst_strong_sell || 0}
- Mean target price: $${data.target_mean}
- High target: $${data.target_high}
- Low target: $${data.target_low}

Provide rigorous analysis like a professional sell-side analyst. Return ONLY valid JSON, no markdown:
{
  "signal": "STRONG BUY or BUY or HOLD or AVOID or STRONG AVOID",
  "technical_score": 1-10,
  "fundamental_score": 1-10,
  "risk_score": 1-10,
  "overall_score": 1-10,
  "reasoning": "4-6 sentence professional analysis citing specific indicators. Discuss technical setup (price vs MAs, RSI implied by 52-week range position), fundamental valuation (P/E vs peers, growth, profitability), analyst sentiment, and the political catalyst from being flagged. Be specific with numbers.",
  "key_risks": "2-3 specific risks",
  "key_catalysts": "2-3 specific upside catalysts"
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analysis = JSON.parse(raw);

    const upsidePct = data.target_mean && data.current_price
      ? ((data.target_mean - data.current_price) / data.current_price) * 100
      : null;

    const totalAnalysts = (data.analyst_strong_buy || 0) + (data.analyst_buy || 0) + (data.analyst_hold || 0) + (data.analyst_sell || 0) + (data.analyst_strong_sell || 0);
    const bullish = (data.analyst_strong_buy || 0) + (data.analyst_buy || 0);
    let consensus = 'No coverage';
    if (totalAnalysts > 0) {
      const bullPct = (bullish / totalAnalysts) * 100;
      if (bullPct >= 70) consensus = 'Strong Buy';
      else if (bullPct >= 50) consensus = 'Buy';
      else if (bullPct >= 30) consensus = 'Hold';
      else consensus = 'Sell';
    }

    await supabase.from('stock_analysis').insert({
      ticker,
      company_name: companyName || data.company_name,
      signal: analysis.signal,
      technical_score: analysis.technical_score,
      fundamental_score: analysis.fundamental_score,
      risk_score: analysis.risk_score,
      overall_score: analysis.overall_score,
      current_price: data.current_price,
      target_price: data.target_mean,
      upside_pct: upsidePct,
      ma_50: data.ma_50,
      ma_200: data.ma_200,
      pe_ratio: data.pe_ratio,
      market_cap: data.market_cap,
      analyst_rating: consensus,
      reasoning: analysis.reasoning,
      indicators: {
        key_risks: analysis.key_risks,
        key_catalysts: analysis.key_catalysts,
        day_change_pct: data.day_change_pct,
        week_52_high: data.week_52_high,
        week_52_low: data.week_52_low,
        revenue_growth: data.revenue_growth,
        dividend_yield: data.dividend_yield,
        beta: data.beta,
        analyst_strong_buy: data.analyst_strong_buy,
        analyst_buy: data.analyst_buy,
        analyst_hold: data.analyst_hold,
        analyst_sell: data.analyst_sell
      }
    });

    console.log(`✓ ${ticker}: ${analysis.signal} (score: ${analysis.overall_score}/10, upside: ${upsidePct?.toFixed(1)}%)`);
  } catch (e) {
    console.error(`Analysis error for ${ticker}:`, e.message);
  }
}

async function runStockAnalysis() {
  console.log('Running deep stock analysis...');
  const { data: mentions } = await supabase
    .from('stock_mentions')
    .select('ticker, company_name')
    .not('ticker', 'is', null);

  if (!mentions?.length) { console.log('No stocks to analyze'); return; }

  const unique = [...new Map(mentions.map(m => [m.ticker, m])).values()];
  console.log(`Analyzing ${unique.length} unique stocks...`);

  for (const stock of unique) {
    await analyzeStock(stock.ticker, stock.company_name);
  }
}

async function updatePortfolioValues() {
  console.log('Updating portfolio values...');
  try {
    const { data: mentions } = await supabase.from('stock_mentions').select('*').not('ticker', 'is', null);
    if (!mentions?.length) { console.log('No stock mentions to update'); return; }

    for (const mention of mentions) {
      const currentPrice = await getStockPrice(mention.ticker);
      if (!currentPrice) continue;
      const currentValue = mention.shares_bought * currentPrice;
      const gainLoss = currentValue - mention.investment_amount;
      const gainLossPct = (gainLoss / mention.investment_amount) * 100;
      await supabase.from('stock_mentions').update({
        current_price: currentPrice,
        current_value: currentValue,
        gain_loss: gainLoss,
        gain_loss_pct: gainLossPct,
        last_updated: new Date().toISOString()
      }).eq('id', mention.id);
      console.log(`${mention.ticker}: $${Number(mention.price_at_mention).toFixed(2)} → $${currentPrice.toFixed(2)} | ${gainLoss >= 0 ? '+' : ''}$${gainLoss.toFixed(2)} (${gainLossPct.toFixed(2)}%)`);
    }
  } catch (e) { console.error('Portfolio error:', e.message); }
}

async function trackStockMention(company, ticker, correlationId) {
  if (!ticker || ticker === 'null' || ticker === 'N/A') return;
  try {
    const price = await getStockPrice(ticker);
    if (!price) return;
    const sharesBought = 1000 / price;
    const mentionTime = new Date();
    console.log(`📈 ${company} (${ticker}) mentioned at ${mentionTime.toLocaleTimeString()}, $${price.toFixed(2)}`);
    await supabase.from('stock_mentions').insert({
      company_name: company, ticker,
      mentioned_at: mentionTime.toISOString(),
      price_at_mention: price,
      shares_bought: sharesBought,
      investment_amount: 1000,
      correlation_id: correlationId,
      current_price: price, current_value: 1000,
      gain_loss: 0, gain_loss_pct: 0,
      last_updated: mentionTime.toISOString()
    });
  } catch (e) { console.error(`Mention error for ${ticker}:`, e.message); }
}

async function fetchPosts() {
  console.log('Fetching Truth Social posts...');
  try {
    const res = await axios.get('https://truthsocial.com/@realDonaldTrump.rss', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'text', timeout: 15000
    });
    let xml = res.data.replace(/\s+[a-zA-Z:]+=[^"'\s>][^\s>]*/g, '');
    const feed = await rss.parseString(xml);
    let count = 0;
    for (const item of feed.items) {
      const id = item.guid || item.link;
      const content = item.contentSnippet || item.content || item.title || '';
      const { error } = await supabase.from('posts').upsert({ id, content, published_at: item.pubDate, tags: extractTags(content) }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log(`Fetched ${count} posts`);
  } catch (e) { console.error('RSS error:', e.message); }
}

async function fetchContracts() {
  console.log('Fetching SAM.gov contracts...');
  try {
    const res = await axios.get('https://api.sam.gov/opportunities/v2/search', {
      params: { api_key: process.env.SAM_API_KEY, limit: 20, postedFrom: getDateDaysAgo(30), postedTo: getToday(), ptype: 'o', active: 'Yes' },
      timeout: 15000
    });
    let count = 0;
    for (const opp of (res.data.opportunitiesData || [])) {
      const { error } = await supabase.from('contracts').upsert({
        id: opp.noticeId, title: opp.title,
        agency: opp.fullParentPathName || 'Unknown',
        value: opp.award?.amount?.toString() || 'TBD',
        deadline: opp.responseDeadLine ? opp.responseDeadLine.split('T')[0] : null,
        type: opp.typeOfSetAsideDescription || 'Open',
        tags: extractTags(opp.title)
      }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log(`Fetched ${count} contracts`);
  } catch (e) { console.error('SAM.gov error:', e.message); }
}

async function fetchBills() {
  console.log('Fetching Congress.gov bills...');
  try {
    const res = await axios.get('https://api.congress.gov/v3/bill', {
      params: { api_key: process.env.CONGRESS_API_KEY, limit: 20, fromDateTime: getISODaysAgo(30) + 'T00:00:00Z', toDateTime: getISODaysAgo(0) + 'T00:00:00Z', sort: 'updateDate+desc', format: 'json' },
      timeout: 15000
    });
    let count = 0;
    for (const bill of (res.data.bills || [])) {
      const { error } = await supabase.from('bills').upsert({
        id: `${bill.type}-${bill.number}-${bill.congress}`,
        title: bill.title, number: `${bill.type}${bill.number}`,
        status: bill.latestAction?.text || 'Unknown',
        sponsor: bill.sponsors?.[0]?.fullName || 'Unknown',
        summary: bill.latestAction?.text || '',
        tags: extractTags(bill.title)
      }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log(`Fetched ${count} bills`);
  } catch (e) { console.error('Congress error:', e.message); }
}

async function analyzeCorrelations() {
  console.log('Running AI correlation analysis...');
  try {
    const { data: posts } = await supabase.from('posts').select('*').order('published_at', { ascending: false }).limit(10);
    const { data: contracts } = await supabase.from('contracts').select('*').limit(20);
    const { data: bills } = await supabase.from('bills').select('*').limit(20);
    if (!posts?.length) { console.log('No posts to analyze'); return; }

    const prompt = `You are a political intelligence analyst. Analyze these Truth Social posts, federal contracts, and legislation for correlations.

POSTS:
${posts.map(p => `- [${p.id}] ${p.published_at}: ${p.content}`).join('\n')}

CONTRACTS:
${contracts?.length ? contracts.map(c => `- [${c.id}] ${c.title} | ${c.agency} | Due: ${c.deadline}`).join('\n') : 'None'}

BILLS:
${bills?.length ? bills.map(b => `- [${b.id}] ${b.number}: ${b.title} | Status: ${b.status}`).join('\n') : 'None'}

Find top 5 correlations. Return ONLY valid JSON array:
[{"post_id":"id","contract_id":"id or null","bill_id":"id or null","score":0-100,"summary":"explanation","level":"high or medium or low","companies":[{"name":"Name","ticker":"TICKER or null","industry":"sector"}]}]`;

    const message = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
    const raw = message.content[0].text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(raw);

    for (const corr of result) {
      const { data: corrData, error } = await supabase.from('correlations').insert({
        post_id: corr.post_id, contract_id: corr.contract_id, bill_id: corr.bill_id,
        score: corr.score, summary: corr.summary, level: corr.level
      }).select().single();
      if (error) continue;
      if (corr.companies?.length && corrData) {
        for (const co of corr.companies) {
          await supabase.from('companies').insert({ name: co.name, ticker: co.ticker, industry: co.industry, correlation_id: corrData.id, source: 'claude-analysis' });
          if (co.ticker && co.ticker !== 'null') await trackStockMention(co.name, co.ticker, corrData.id);
        }
      }
    }
    console.log(`Created ${result.length} correlations`);
  } catch (e) { console.error('Analysis error:', e.message); }
}

async function runPipeline() {
  console.log('\n========== PIPELINE START', new Date().toISOString(), '==========');
  await fetchPosts();
  await fetchContracts();
  await fetchBills();
  await analyzeCorrelations();
  await updatePortfolioValues();
  await runStockAnalysis();
  console.log('========== PIPELINE COMPLETE ==========\n');
}

runPipeline();
cron.schedule('*/30 * * * *', runPipeline);