if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const axios = require('axios');
const cron = require('node-cron');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  realtime: { transport: ws }
});

function getToday() {
  const d = new Date();
  return String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'/'+d.getFullYear();
}
function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate()-days);
  return String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'/'+d.getFullYear();
}
function getISODaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate()-days);
  return d.toISOString().split('T')[0];
}
function extractTags(text) {
  if (!text) return [];
  const keywords = ['energy','defense','tech','pharma','agriculture','semiconductor','infrastructure','manufacturing','AI','nuclear','LNG','subsidy','tariff','trade','military','economy','tax','healthcare','immigration','oil','gas','chip'];
  return keywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPosts() {
  console.log('Fetching Truth Social posts...');
  try {
    const res = await axios.get('https://truthsocial.com/api/v1/accounts/107780257626128497/statuses', {
      params: { limit: 20, exclude_replies: true },
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 15000
    });
    let count = 0;
    for (const p of res.data || []) {
      const content = p.content?.replace(/<[^>]+>/g,'').trim() || '';
      if (!content) continue;
      const { error } = await supabase.from('posts').upsert({ id: p.id, content, published_at: p.created_at, tags: extractTags(content) }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log('Fetched '+count+' Truth Social posts');
  } catch(e) { console.error('Truth Social error:', e.message); }
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
      const { error } = await supabase.from('contracts').upsert({ id: opp.noticeId, title: opp.title, agency: opp.fullParentPathName || 'Unknown', value: opp.award?.amount?.toString() || 'TBD', deadline: opp.responseDeadLine ? opp.responseDeadLine.split('T')[0] : null, type: opp.typeOfSetAsideDescription || 'Open', tags: extractTags(opp.title) }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log('Fetched '+count+' contracts');
  } catch(e) { console.error('SAM.gov error:', e.message); }
}

async function fetchBills() {
  console.log('Fetching Congress.gov bills...');
  try {
    const res = await axios.get('https://api.congress.gov/v3/bill', {
      params: { api_key: process.env.CONGRESS_API_KEY, limit: 20, fromDateTime: getISODaysAgo(30)+'T00:00:00Z', toDateTime: getISODaysAgo(0)+'T00:00:00Z', sort: 'updateDate+desc', format: 'json' },
      timeout: 15000
    });
    let count = 0;
    for (const bill of (res.data.bills || [])) {
      const { error } = await supabase.from('bills').upsert({ id: bill.type+'-'+bill.number+'-'+bill.congress, title: bill.title, number: bill.type+bill.number, status: bill.latestAction?.text || 'Unknown', sponsor: bill.sponsors?.[0]?.fullName || 'Unknown', summary: bill.latestAction?.text || '', tags: extractTags(bill.title) }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log('Fetched '+count+' bills');
  } catch(e) { console.error('Congress error:', e.message); }
}

async function getStockPrice(ticker) {
  await sleep(1200);
  try {
    const res = await axios.get('https://finnhub.io/api/v1/quote', { params: { symbol: ticker, token: process.env.FINNHUB_API_KEY }, timeout: 10000 });
    return res.data.c || null;
  } catch(e) { console.error('Price error for '+ticker+':', e.message); return null; }
}

async function getStockData(ticker) {
  const data = { ticker };
  try {
    await sleep(1200);
    const quote = await axios.get('https://finnhub.io/api/v1/quote', { params: { symbol: ticker, token: process.env.FINNHUB_API_KEY } });
    data.current_price = quote.data.c;
    data.day_change_pct = quote.data.dp;

    await sleep(1200);
    const profile = await axios.get('https://finnhub.io/api/v1/stock/profile2', { params: { symbol: ticker, token: process.env.FINNHUB_API_KEY } });
    data.company_name = profile.data.name;
    data.market_cap = profile.data.marketCapitalization;
    data.industry = profile.data.finnhubIndustry;

    await sleep(1200);
    const metrics = await axios.get('https://finnhub.io/api/v1/stock/metric', { params: { symbol: ticker, metric: 'all', token: process.env.FINNHUB_API_KEY } });
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
    const reco = await axios.get('https://finnhub.io/api/v1/stock/recommendation', { params: { symbol: ticker, token: process.env.FINNHUB_API_KEY } });
    if (reco.data?.[0]) { const r = reco.data[0]; data.analyst_strong_buy = r.strongBuy; data.analyst_buy = r.buy; data.analyst_hold = r.hold; data.analyst_sell = r.sell; data.analyst_strong_sell = r.strongSell; }

    await sleep(1200);
    const target = await axios.get('https://finnhub.io/api/v1/stock/price-target', { params: { symbol: ticker, token: process.env.FINNHUB_API_KEY } });
    data.target_high = target.data.targetHigh;
    data.target_low = target.data.targetLow;
    data.target_mean = target.data.targetMean;

    return data;
  } catch(e) { console.error('Data fetch error for '+ticker+':', e.message); return data; }
}

async function analyzeStock(ticker, companyName) {
  console.log('Analyzing '+ticker+'...');
  try {
    const data = await getStockData(ticker);
    if (!data.current_price) { console.log('No data for '+ticker); return; }

    const prompt = 'You are a senior equity analyst. Analyze '+ticker+' ('+( companyName || data.company_name)+').\n\nPRICE: $'+data.current_price+' | DAY: '+(data.day_change_pct?.toFixed(2))+'%\n52-WEEK: $'+data.week_52_low+' - $'+data.week_52_high+'\nMARKET CAP: $'+data.market_cap+'M | INDUSTRY: '+data.industry+'\n50-day MA: $'+data.ma_50+' | 200-day MA: $'+data.ma_200+' | Beta: '+data.beta+'\nP/E: '+data.pe_ratio+' | EPS: $'+data.eps+' | Rev Growth: '+data.revenue_growth+'% | Div: '+data.dividend_yield+'%\nAnalysts - Strong Buy: '+(data.analyst_strong_buy||0)+' Buy: '+(data.analyst_buy||0)+' Hold: '+(data.analyst_hold||0)+' Sell: '+(data.analyst_sell||0)+'\nTarget: Mean $'+data.target_mean+' | High $'+data.target_high+' | Low $'+data.target_low+'\n\nReturn ONLY valid JSON no markdown:\n{"signal":"STRONG BUY or BUY or HOLD or AVOID or STRONG AVOID","technical_score":5,"fundamental_score":5,"risk_score":5,"overall_score":5,"reasoning":"4-6 sentence analysis","key_risks":"2-3 risks","key_catalysts":"2-3 catalysts"}';

    const completion = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.3 });
    const raw = completion.choices[0].message.content.trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const analysis = JSON.parse(raw);

    const upsidePct = data.target_mean && data.current_price ? ((data.target_mean - data.current_price) / data.current_price) * 100 : null;
    const total = (data.analyst_strong_buy||0)+(data.analyst_buy||0)+(data.analyst_hold||0)+(data.analyst_sell||0)+(data.analyst_strong_sell||0);
    const bull = (data.analyst_strong_buy||0)+(data.analyst_buy||0);
    let consensus = 'No coverage';
    if (total > 0) { const pct = (bull/total)*100; consensus = pct>=70?'Strong Buy':pct>=50?'Buy':pct>=30?'Hold':'Sell'; }

    await supabase.from('stock_analysis').upsert({  ticker, company_name: companyName || data.company_name, signal: analysis.signal, technical_score: analysis.technical_score, fundamental_score: analysis.fundamental_score, risk_score: analysis.risk_score, overall_score: analysis.overall_score, current_price: data.current_price, target_price: data.target_mean, upside_pct: upsidePct, ma_50: data.ma_50, ma_200: data.ma_200, pe_ratio: data.pe_ratio, market_cap: data.market_cap, analyst_rating: consensus, reasoning: analysis.reasoning, indicators: { key_risks: analysis.key_risks, key_catalysts: analysis.key_catalysts, day_change_pct: data.day_change_pct, week_52_high: data.week_52_high, week_52_low: data.week_52_low, revenue_growth: data.revenue_growth, dividend_yield: data.dividend_yield, beta: data.beta, analyst_strong_buy: data.analyst_strong_buy, analyst_buy: data.analyst_buy, analyst_hold: data.analyst_hold, analyst_sell: data.analyst_sell } }, { onConflict: 'ticker' });
    console.log('✓ '+ticker+': '+analysis.signal+' ('+analysis.overall_score+'/10, upside: '+upsidePct?.toFixed(1)+'%)');
  } catch(e) { console.error('Analysis error for '+ticker+':', e.message); }
}

async function runStockAnalysis() {
  console.log('Running deep stock analysis...');
  const { data: mentions } = await supabase.from('stock_mentions').select('ticker, company_name').not('ticker','is',null);
  if (!mentions?.length) { console.log('No stocks to analyze'); return; }
  const unique = [...new Map(mentions.map(m => [m.ticker, m])).values()];
  console.log('Analyzing '+unique.length+' unique stocks...');
  for (const stock of unique) { await analyzeStock(stock.ticker, stock.company_name); }
}

async function updatePortfolioValues() {
  console.log('Updating portfolio values...');
  try {
    const { data: mentions } = await supabase.from('stock_mentions').select('*').not('ticker','is',null);
    if (!mentions?.length) { console.log('No stock mentions to update'); return; }
    for (const mention of mentions) {
      const currentPrice = await getStockPrice(mention.ticker);
      if (!currentPrice) continue;
      const currentValue = mention.shares_bought * currentPrice;
      const gainLoss = currentValue - mention.investment_amount;
      const gainLossPct = (gainLoss / mention.investment_amount) * 100;
      await supabase.from('stock_mentions').update({ current_price: currentPrice, current_value: currentValue, gain_loss: gainLoss, gain_loss_pct: gainLossPct, last_updated: new Date().toISOString() }).eq('id', mention.id);
      console.log(mention.ticker+': $'+Number(mention.price_at_mention).toFixed(2)+' -> $'+currentPrice.toFixed(2)+' | '+(gainLoss>=0?'+':'')+'$'+gainLoss.toFixed(2)+' ('+gainLossPct.toFixed(2)+'%)');
    }
  } catch(e) { console.error('Portfolio error:', e.message); }
}

async function trackStockMention(company, ticker, correlationId) {
  if (!ticker || ticker === 'null' || ticker === 'N/A') return;
  try {
    const { data: existing } = await supabase.from('stock_mentions').select('*').eq('ticker', ticker).limit(1);
    const price = await getStockPrice(ticker);
    if (!price) return;
    const mentionTime = new Date();
    if (existing?.length > 0) {
      const currentValue = existing[0].shares_bought * price;
      const gainLoss = currentValue - existing[0].investment_amount;
      const gainLossPct = (gainLoss / existing[0].investment_amount) * 100;
      await supabase.from('stock_mentions').update({ current_price: price, current_value: currentValue, gain_loss: gainLoss, gain_loss_pct: gainLossPct, last_updated: mentionTime.toISOString() }).eq('ticker', ticker);
      console.log('🔄 '+ticker+' updated: $'+price.toFixed(2));
    } else {
      const sharesBought = 1000 / price;
      console.log('📈 '+company+' ('+ticker+') NEW first mention at $'+price.toFixed(2));
      await supabase.from('stock_mentions').insert({ company_name: company, ticker, mentioned_at: mentionTime.toISOString(), price_at_mention: price, shares_bought: sharesBought, investment_amount: 1000, correlation_id: correlationId, current_price: price, current_value: 1000, gain_loss: 0, gain_loss_pct: 0, last_updated: mentionTime.toISOString(), is_new: true });
    }
  } catch(e) { console.error('Mention error for '+ticker+':', e.message); }
}

async function analyzeCorrelations() {
  console.log('Running AI correlation analysis...');
  try {
    const { data: posts } = await supabase.from('posts').select('*').order('published_at', { ascending: false }).limit(5);
    const { data: contracts } = await supabase.from('contracts').select('*').limit(10);
    const { data: bills } = await supabase.from('bills').select('*').limit(10);
    if (!posts?.length) { console.log('No posts to analyze'); return; }

    const prompt = 'Political intelligence analyst. Find top 3 correlations between these Truth Social posts, contracts, and bills.\n\nPOSTS:\n'+posts.map(p => '- ['+p.id+'] '+p.published_at+': '+(p.content?.substring(0,150))).join('\n')+'\n\nCONTRACTS:\n'+(contracts?.length ? contracts.map(c => '- ['+c.id+'] '+c.title+' | '+c.agency).join('\n') : 'None')+'\n\nBILLS:\n'+(bills?.length ? bills.map(b => '- ['+b.id+'] '+b.number+': '+b.title).join('\n') : 'None')+'\n\nReturn ONLY valid JSON array no markdown:\n[{"post_id":"id","contract_id":"id or null","bill_id":"id or null","score":0-100,"summary":"2 sentence explanation","level":"high or medium or low","companies":[{"name":"Name","ticker":"TICKER or null","industry":"sector"}]}]';

    const completion = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 0.3 });
    const raw = completion.choices[0].message.content.trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const result = JSON.parse(raw);

    for (const corr of result) {
      const { data: corrData, error } = await supabase.from('correlations').insert({ post_id: corr.post_id, contract_id: corr.contract_id, bill_id: corr.bill_id, score: corr.score, summary: corr.summary, level: corr.level }).select().single();
      if (error) { console.error('Correlation error:', error.message); continue; }
      if (corr.companies?.length && corrData) {
        for (const co of corr.companies) {
          await supabase.from('companies').insert({ name: co.name, ticker: co.ticker, industry: co.industry, correlation_id: corrData.id, source: 'groq-analysis' });
          if (co.ticker && co.ticker !== 'null') await trackStockMention(co.name, co.ticker, corrData.id);
        }
      }
    }
    console.log('Created '+result.length+' correlations');
  } catch(e) { console.error('Analysis error:', e.message); }
}

async function runPipeline() {
  console.log('\n========== PIPELINE START '+new Date().toISOString()+' ==========');
  const hour = new Date().getHours();
  const isFullRun = hour === 6 || hour === 12 || hour === 18;
  await fetchPosts();
  if (isFullRun) { await fetchContracts(); await fetchBills(); } else { console.log('Skipping contracts/bills'); }
  await analyzeCorrelations();
  await updatePortfolioValues();
  await runStockAnalysis();
  console.log('========== PIPELINE COMPLETE ==========\n');
}

if (process.argv.includes('--single-run')) {
  runPipeline().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
} else {
  runPipeline();
  cron.schedule('0 */2 * * *', runPipeline);
}
