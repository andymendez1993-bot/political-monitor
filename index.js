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
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}
function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
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
  try {
    console.log('FINNHUB KEY:', process.env.FINNHUB_API_KEY ? 'found' : 'MISSING');
    const res = await axios.get('https://finnhub.io/api/v1/quote', {
      params: {
        symbol: ticker,
        token: process.env.FINNHUB_API_KEY
      },
      timeout: 10000
    });
    const price = res.data.c;
    if (!price || price === 0) return null;
    return price;
  } catch (e) {
    console.error(`Stock price error for ${ticker}:`, e.message);
    return null;
  }
}

async function updatePortfolioValues() {
  console.log('Updating portfolio values...');
  try {
    const { data: mentions } = await supabase
      .from('stock_mentions')
      .select('*')
      .not('ticker', 'is', null);

    if (!mentions?.length) { console.log('No stock mentions to update'); return; }

    for (const mention of mentions) {
      if (!mention.ticker) continue;
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

      console.log(`${mention.ticker}: $${Number(mention.price_at_mention).toFixed(2)} → $${currentPrice.toFixed(2)} | P&L: ${gainLoss >= 0 ? '+' : ''}$${gainLoss.toFixed(2)} (${gainLossPct.toFixed(2)}%)`);
    }
  } catch (e) {
    console.error('Portfolio update error:', e.message);
  }
}

async function trackStockMention(company, ticker, correlationId) {
  if (!ticker || ticker === 'null' || ticker === 'N/A') return;
  try {
    const price = await getStockPrice(ticker);
    if (!price) {
      console.log(`Could not get price for ${ticker}`);
      return;
    }
    const sharesBought = 1000 / price;
    const mentionTime = new Date();

    console.log(`📈 ${company} (${ticker}) mentioned at ${mentionTime.toLocaleTimeString()}, stock price is $${price.toFixed(2)}`);
    console.log(`   Simulating $1000 purchase: ${sharesBought.toFixed(4)} shares at $${price.toFixed(2)}`);

    const { error } = await supabase.from('stock_mentions').insert({
      company_name: company,
      ticker,
      mentioned_at: mentionTime.toISOString(),
      price_at_mention: price,
      shares_bought: sharesBought,
      investment_amount: 1000,
      correlation_id: correlationId,
      current_price: price,
      current_value: 1000,
      gain_loss: 0,
      gain_loss_pct: 0,
      last_updated: mentionTime.toISOString()
    });

    if (error) console.error('Stock mention insert error:', error.message);
  } catch (e) {
    console.error(`Stock tracking error for ${ticker}:`, e.message);
  }
}

async function fetchPosts() {
  console.log('Fetching Truth Social posts...');
  try {
    const res = await axios.get('https://truthsocial.com/@realDonaldTrump.rss', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      responseType: 'text',
      timeout: 15000
    });
    let xml = res.data;
    xml = xml.replace(/\s+[a-zA-Z:]+=[^"'\s>][^\s>]*/g, '');
    const feed = await rss.parseString(xml);
    let count = 0;
    for (const item of feed.items) {
      const id = item.guid || item.link;
      const content = item.contentSnippet || item.content || item.title || '';
      const { error } = await supabase.from('posts').upsert({
        id, content, published_at: item.pubDate, tags: extractTags(content)
      }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log(`Fetched ${count} posts`);
  } catch (e) {
    console.error('RSS error:', e.message);
    try {
      const res = await axios.get('https://api.truthsocial.com/api/v1/accounts/107780257626128497/statuses', {
        params: { limit: 20, exclude_replies: true },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      });
      let count = 0;
      for (const s of res.data || []) {
        const content = s.content?.replace(/<[^>]+>/g, '') || '';
        const { error } = await supabase.from('posts').upsert({
          id: s.id, content, published_at: s.created_at, tags: extractTags(content)
        }, { onConflict: 'id' });
        if (!error) count++;
      }
      console.log(`Fallback fetched ${count} posts`);
    } catch (e2) {
      console.error('Fallback error:', e2.message);
    }
  }
}

async function fetchContracts() {
  console.log('Fetching SAM.gov contracts...');
  try {
    const res = await axios.get('https://api.sam.gov/opportunities/v2/search', {
      params: {
        api_key: process.env.SAM_API_KEY,
        limit: 20,
        postedFrom: getDateDaysAgo(30),
        postedTo: getToday(),
        ptype: 'o',
        active: 'Yes'
      },
      timeout: 15000
    });
    const opps = res.data.opportunitiesData || [];
    let count = 0;
    for (const opp of opps) {
      const { error } = await supabase.from('contracts').upsert({
        id: opp.noticeId,
        title: opp.title,
        agency: opp.fullParentPathName || 'Unknown',
        value: opp.award?.amount?.toString() || 'TBD',
        deadline: opp.responseDeadLine ? opp.responseDeadLine.split('T')[0] : null,
        type: opp.typeOfSetAsideDescription || 'Open',
        tags: extractTags(opp.title)
      }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log(`Fetched ${count} contracts`);
  } catch (e) {
    console.error('SAM.gov error:', e.message);
  }
}

async function fetchBills() {
  console.log('Fetching Congress.gov bills...');
  try {
    const res = await axios.get('https://api.congress.gov/v3/bill', {
      params: {
        api_key: process.env.CONGRESS_API_KEY,
        limit: 20,
        fromDateTime: getISODaysAgo(30) + 'T00:00:00Z',
        toDateTime: getISODaysAgo(0) + 'T00:00:00Z',
        sort: 'updateDate+desc',
        format: 'json'
      },
      timeout: 15000
    });
    const bills = res.data.bills || [];
    let count = 0;
    for (const bill of bills) {
      const { error } = await supabase.from('bills').upsert({
        id: `${bill.type}-${bill.number}-${bill.congress}`,
        title: bill.title,
        number: `${bill.type}${bill.number}`,
        status: bill.latestAction?.text || 'Unknown',
        sponsor: bill.sponsors?.[0]?.fullName || 'Unknown',
        summary: bill.latestAction?.text || '',
        tags: extractTags(bill.title)
      }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log(`Fetched ${count} bills`);
  } catch (e) {
    console.error('Congress error:', e.message);
  }
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
${contracts?.length ? contracts.map(c => `- [${c.id}] ${c.title} | ${c.agency} | Due: ${c.deadline}`).join('\n') : 'None yet'}

BILLS:
${bills?.length ? bills.map(b => `- [${b.id}] ${b.number}: ${b.title} | Status: ${b.status}`).join('\n') : 'None yet'}

Find the top 5 correlations. Return ONLY a valid JSON array with no markdown:
[{
  "post_id": "post id",
  "contract_id": "contract id or null",
  "bill_id": "bill id or null",
  "score": 0-100,
  "summary": "2-3 sentence explanation",
  "level": "high or medium or low",
  "companies": [{"name": "Company Name", "ticker": "TICKER or null", "industry": "sector"}]
}]`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(raw);

    for (const corr of result) {
      const { data: corrData, error } = await supabase.from('correlations').insert({
        post_id: corr.post_id,
        contract_id: corr.contract_id,
        bill_id: corr.bill_id,
        score: corr.score,
        summary: corr.summary,
        level: corr.level
      }).select().single();

      if (error) { console.error('Correlation error:', error.message); continue; }

      if (corr.companies?.length && corrData) {
        for (const co of corr.companies) {
          await supabase.from('companies').insert({
            name: co.name,
            ticker: co.ticker,
            industry: co.industry,
            correlation_id: corrData.id,
            source: 'claude-analysis'
          });

          if (co.ticker && co.ticker !== 'null') {
            await trackStockMention(co.name, co.ticker, corrData.id);
          }
        }
      }
    }
    console.log(`Created ${result.length} correlations`);
  } catch (e) {
    console.error('Analysis error:', e.message);
  }
}

async function runPipeline() {
  console.log('\n========== PIPELINE START', new Date().toISOString(), '==========');
  await fetchPosts();
  await fetchContracts();
  await fetchBills();
  await analyzeCorrelations();
  await updatePortfolioValues();
  console.log('========== PIPELINE COMPLETE ==========\n');
}

runPipeline();
cron.schedule('*/30 * * * *', runPipeline);