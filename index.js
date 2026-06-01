if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const RSSParser = require('rss-parser');
const axios = require('axios');
const cron = require('node-cron');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const rss = new RSSParser({
  customFields: { item: ['media:content'] },
  xmlParserOptions: { strict: false }
});

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

// ── 1. INGEST TRUTH SOCIAL ──────────────────────────────────────────
async function fetchPosts() {
  console.log('Fetching Truth Social posts...');
  try {
    const res = await axios.get('https://truthsocial.com/@realDonaldTrump.rss', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      },
      responseType: 'text',
      timeout: 15000
    });
    let xml = res.data;
    xml = xml.replace(/\s+[a-zA-Z]+=[^"'][^\s>]*/g, '');
    xml = xml.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)>/g, (match, tag, attrs) => {
      const fixedAttrs = attrs.replace(/(\s+[a-zA-Z:]+)(?==)/g, '$1');
      return `<${tag} ${fixedAttrs}>`;
    });
    const feed = await rss.parseString(xml);
    let count = 0;
    for (const item of feed.items) {
      const id = item.guid || item.link;
      const content = item.contentSnippet || item.content || item.title || '';
      const { error } = await supabase.from('posts').upsert({
        id,
        content,
        published_at: item.pubDate,
        tags: extractTags(content)
      }, { onConflict: 'id' });
      if (!error) count++;
      else console.error('Post insert error:', error.message);
    }
    console.log(`Fetched ${count} posts`);
  } catch (e) {
    console.error('RSS fetch error:', e.message);
    await fetchPostsFallback();
  }
}

async function fetchPostsFallback() {
  console.log('Trying Truth Social fallback...');
  try {
    const res = await axios.get('https://api.truthsocial.com/api/v1/accounts/107780257626128497/statuses', {
      params: { limit: 20, exclude_replies: true },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });
    const statuses = res.data || [];
    let count = 0;
    for (const s of statuses) {
      const content = s.content?.replace(/<[^>]+>/g, '') || '';
      const { error } = await supabase.from('posts').upsert({
        id: s.id,
        content,
        published_at: s.created_at,
        tags: extractTags(content)
      }, { onConflict: 'id' });
      if (!error) count++;
    }
    console.log(`Fallback fetched ${count} posts`);
  } catch (e) {
    console.error('Fallback error:', e.message);
  }
}

// ── 2. INGEST CONTRACTS ─────────────────────────────────────────────
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
      else console.error('Contract insert error:', error.message);
    }
    console.log(`Fetched ${count} contracts`);
  } catch (e) {
    console.error('SAM.gov fetch error:', e.message);
    if (e.response) console.error('SAM.gov response:', JSON.stringify(e.response.data).slice(0, 300));
  }
}

// ── 3. INGEST BILLS ─────────────────────────────────────────────────
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
      else console.error('Bill insert error:', error.message);
    }
    console.log(`Fetched ${count} bills`);
  } catch (e) {
    console.error('Congress fetch error:', e.message);
    if (e.response) console.error('Congress response:', JSON.stringify(e.response.data).slice(0, 300));
  }
}

// ── 4. AI CORRELATION ANALYSIS ──────────────────────────────────────
async function analyzeCorrelations() {
  console.log('Running AI correlation analysis...');
  try {
    const { data: posts } = await supabase.from('posts').select('*').order('published_at', { ascending: false }).limit(10);
    const { data: contracts } = await supabase.from('contracts').select('*').limit(20);
    const { data: bills } = await supabase.from('bills').select('*').limit(20);

    if (!posts?.length) { console.log('No posts to analyze yet — will retry next run'); return; }

    const prompt = `You are a political intelligence analyst. Analyze these Truth Social posts, federal contracts, and legislation for correlations.

POSTS:
${posts.map(p => `- [${p.id}] ${p.published_at}: ${p.content}`).join('\n')}

CONTRACTS:
${contracts?.length ? contracts.map(c => `- [${c.id}] ${c.title} | ${c.agency} | Due: ${c.deadline}`).join('\n') : 'None yet'}

BILLS:
${bills?.length ? bills.map(b => `- [${b.id}] ${b.number}: ${b.title} | Status: ${b.status}`).join('\n') : 'None yet'}

Find the top 5 correlations between posts and contracts/bills. Return ONLY a valid JSON array:
[{
  "post_id": "the post id",
  "contract_id": "contract id or null",
  "bill_id": "bill id or null",
  "score": 0-100,
  "summary": "2-3 sentence explanation",
  "level": "high or medium or low",
  "companies": [{"name": "Company Name", "ticker": "TICKER or null", "industry": "industry sector"}]
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

      if (error) { console.error('Correlation insert error:', error.message); continue; }

      if (corr.companies?.length && corrData) {
        for (const co of corr.companies) {
          await supabase.from('companies').insert({
            name: co.name,
            ticker: co.ticker,
            industry: co.industry,
            correlation_id: corrData.id,
            source: 'claude-analysis'
          });
        }
      }
    }
    console.log(`Created ${result.length} correlations`);
  } catch (e) {
    console.error('Analysis error:', e.message);
  }
}

// ── MAIN PIPELINE ────────────────────────────────────────────────────
async function runPipeline() {
  console.log('\n========== PIPELINE START', new Date().toISOString(), '==========');
  await fetchPosts();
  await fetchContracts();
  await fetchBills();
  await analyzeCorrelations();
  console.log('========== PIPELINE COMPLETE ==========\n');
}

runPipeline();
cron.schedule('0 */4 * * *', runPipeline);