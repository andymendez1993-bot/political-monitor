import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_KEY
);

export default function Dashboard() {
  const [correlations, setCorrelations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [bills, setBills] = useState([]);
  const [portfolio, setPortfolio] = useState([]);
  const [analysis, setAnalysis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeTab, setActiveTab] = useState('correlations');
  const [expandedAnalysis, setExpandedAnalysis] = useState(null);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function fetchAll() {
    const [c, co, ct, b, p, a] = await Promise.all([
      supabase.from('correlations').select('*').order('score', { ascending: false }).limit(20),
      supabase.from('companies').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('contracts').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('bills').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('stock_mentions').select('*').order('mentioned_at', { ascending: false }).limit(200),
      supabase.from('stock_analysis').select('*').order('overall_score', { ascending: false }).limit(30),
    ]);
    setCorrelations(c.data || []);
    setCompanies(co.data || []);
    setContracts(ct.data || []);
    setBills(b.data || []);
    const rawPortfolio = p.data || [];
    const uniquePortfolio = [...new Map(rawPortfolio.map(s => [s.ticker, s])).values()];
    setPortfolio(uniquePortfolio);
    setAnalysis(a.data || []);
    setLastUpdated(new Date().toLocaleTimeString());
    setLoading(false);
  }

  const isNewStock = (mentionedAt) => {
    const hoursSince = (new Date() - new Date(mentionedAt)) / (1000 * 60 * 60);
    return hoursSince < 24;
  };

  const levelColor = (level) => {
    if (level === 'high') return '#E24B4A';
    if (level === 'medium') return '#EF9F27';
    return '#1D9E75';
  };

  const signalColor = (signal) => {
    if (!signal) return '#999';
    if (signal.includes('STRONG BUY')) return '#1D9E75';
    if (signal.includes('BUY')) return '#2ECC71';
    if (signal.includes('HOLD')) return '#EF9F27';
    if (signal.includes('STRONG AVOID')) return '#C0392B';
    if (signal.includes('AVOID')) return '#E24B4A';
    return '#999';
  };

  const signalBg = (signal) => {
    if (!signal) return '#f5f5f5';
    if (signal.includes('STRONG BUY')) return '#e8f8f0';
    if (signal.includes('BUY')) return '#f0faf4';
    if (signal.includes('HOLD')) return '#fff9ed';
    if (signal.includes('AVOID')) return '#fff0f0';
    return '#f5f5f5';
  };

  const totalInvested = portfolio.reduce((sum, s) => sum + (s.investment_amount || 0), 0);
  const totalValue = portfolio.reduce((sum, s) => sum + (Number(s.current_value) || 0), 0);
  const totalGainLoss = totalValue - totalInvested;
  const totalGainLossPct = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;
  const newStocks = portfolio.filter(s => isNewStock(s.mentioned_at));

  const uniqueAnalysis = analysis.reduce((acc, item) => {
    if (!acc.find(a => a.ticker === item.ticker)) acc.push(item);
    return acc;
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Political Intelligence Monitor</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>Truth Social · SAM.gov · Congress.gov · AI Analysis · Stock Intelligence</p>
        </div>
        <div style={{ fontSize: 12, color: '#999' }}>{lastUpdated ? `Updated ${lastUpdated}` : 'Loading...'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Correlations', value: correlations.length },
          { label: 'Companies', value: companies.length },
          { label: 'Contracts', value: contracts.length },
          { label: 'Bills', value: bills.length },
          { label: 'Stocks tracked', value: portfolio.length },
          { label: '🆕 New today', value: newStocks.length, highlight: newStocks.length > 0 },
        ].map(m => (
          <div key={m.label} style={{ background: m.highlight ? '#fff9ed' : '#f5f5f5', borderRadius: 8, padding: '10px 14px', border: m.highlight ? '1px solid #EF9F27' : 'none' }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 3 }}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: m.highlight ? '#EF9F27' : 'inherit' }}>{loading ? '—' : m.value}</div>
          </div>
        ))}
      </div>

      {!loading && portfolio.length > 0 && (
        <div style={{ background: totalGainLoss >= 0 ? '#f0faf4' : '#fff5f5', border: `1px solid ${totalGainLoss >= 0 ? '#1D9E75' : '#E24B4A'}`, borderRadius: 10, padding: '14px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Simulated portfolio — $1,000 per mention</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>Invested: ${totalInvested.toLocaleString()}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Current value</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div style={{ fontSize: 14, color: totalGainLoss >= 0 ? '#1D9E75' : '#E24B4A', fontWeight: 500 }}>
              {totalGainLoss >= 0 ? '+' : ''}${totalGainLoss.toFixed(2)} ({totalGainLossPct.toFixed(2)}%)
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {['correlations', 'analysis', 'portfolio', 'companies', 'contracts', 'bills'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '8px 14px', border: '1px solid #ddd', borderRadius: 6,
            background: activeTab === tab ? '#000' : '#fff',
            color: activeTab === tab ? '#fff' : '#333',
            cursor: 'pointer', fontSize: 13, textTransform: 'capitalize',
            position: 'relative'
          }}>
            {tab === 'analysis' ? '🔬 Analysis' : tab}
            {tab === 'portfolio' && newStocks.length > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, background: '#EF9F27', color: 'white', borderRadius: '50%', width: 16, height: 16, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                {newStocks.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>Loading data...</div>}

      {!loading && activeTab === 'correlations' && (
        <div>
          {correlations.map((c, i) => (
            <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: `4px solid ${levelColor(c.level)}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: levelColor(c.level) }}>Score: {c.score}/100</span>
                <span style={{ fontSize: 12, color: '#999', textTransform: 'capitalize' }}>{c.level} signal</span>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.5 }}>{c.summary}</p>
              <div style={{ fontSize: 11, color: '#999' }}>{new Date(c.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === 'analysis' && (
        <div>
          <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400e' }}>
            ⚠️ For research and educational purposes only. Not financial advice. Always consult a licensed financial advisor before investing.
          </div>
          {uniqueAnalysis.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>Analysis runs at 9am daily. Check back tomorrow!</div>
          ) : (
            uniqueAnalysis.map((a, i) => (
              <div key={i} style={{ border: '1px solid #eee', borderRadius: 10, marginBottom: 12, overflow: 'hidden', background: signalBg(a.signal) }}>
                <div style={{ padding: '14px 16px', cursor: 'pointer' }} onClick={() => setExpandedAnalysis(expandedAnalysis === i ? null : i)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{a.ticker}</span>
                        <span style={{ fontSize: 13, color: '#555' }}>{a.company_name}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 99, background: signalColor(a.signal), color: 'white' }}>{a.signal}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#666', flexWrap: 'wrap' }}>
                        <span>Price: <strong>${Number(a.current_price).toFixed(2)}</strong></span>
                        {a.target_price && <span>Target: <strong>${Number(a.target_price).toFixed(2)}</strong></span>}
                        {a.upside_pct && <span style={{ color: a.upside_pct > 0 ? '#1D9E75' : '#E24B4A', fontWeight: 600 }}>{a.upside_pct > 0 ? '+' : ''}{Number(a.upside_pct).toFixed(1)}% upside</span>}
                        <span>Analyst: <strong>{a.analyst_rating}</strong></span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {[{label:'Tech',val:a.technical_score},{label:'Fund',val:a.fundamental_score},{label:'Risk',val:a.risk_score},{label:'Score',val:a.overall_score}].map(s => (
                        <div key={s.label} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: '#999', marginBottom: 2 }}>{s.label}</div>
                          <div style={{ fontSize: s.label==='Score'?22:18, fontWeight: 700, color: s.label==='Risk' ? (s.val<=4?'#1D9E75':s.val<=6?'#EF9F27':'#E24B4A') : (s.val>=7?'#1D9E75':s.val>=5?'#EF9F27':'#E24B4A') }}>{s.val}/10</div>
                        </div>
                      ))}
                      <span style={{ fontSize: 18, color: '#999' }}>{expandedAnalysis === i ? '▲' : '▼'}</span>
                    </div>
                  </div>
                </div>
                {expandedAnalysis === i && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid #eee' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '12px 0' }}>
                      <div style={{ background: 'white', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 6, textTransform: 'uppercase' }}>Technical Indicators</div>
                        <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {a.ma_50 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>50-day MA</span><strong>${Number(a.ma_50).toFixed(2)}</strong></div>}
                          {a.ma_200 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>200-day MA</span><strong>${Number(a.ma_200).toFixed(2)}</strong></div>}
                          {a.indicators?.week_52_high && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>52-wk High</span><strong>${Number(a.indicators.week_52_high).toFixed(2)}</strong></div>}
                          {a.indicators?.week_52_low && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>52-wk Low</span><strong>${Number(a.indicators.week_52_low).toFixed(2)}</strong></div>}
                          {a.indicators?.beta && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>Beta</span><strong>{Number(a.indicators.beta).toFixed(2)}</strong></div>}
                        </div>
                      </div>
                      <div style={{ background: 'white', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 6, textTransform: 'uppercase' }}>Fundamentals</div>
                        <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {a.pe_ratio && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>P/E Ratio</span><strong>{Number(a.pe_ratio).toFixed(1)}x</strong></div>}
                          {a.market_cap && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>Market Cap</span><strong>${(Number(a.market_cap)/1000).toFixed(1)}B</strong></div>}
                          {a.indicators?.revenue_growth && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>Rev Growth</span><strong style={{ color: a.indicators.revenue_growth>0?'#1D9E75':'#E24B4A' }}>{Number(a.indicators.revenue_growth).toFixed(1)}%</strong></div>}
                          {a.indicators?.dividend_yield && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666' }}>Dividend</span><strong>{Number(a.indicators.dividend_yield).toFixed(2)}%</strong></div>}
                        </div>
                      </div>
                    </div>
                    <div style={{ background: 'white', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 6, textTransform: 'uppercase' }}>Analyst Consensus</div>
                      <div style={{ display: 'flex', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
                        {a.indicators?.analyst_strong_buy > 0 && <span style={{ background: '#1D9E75', color: 'white', padding: '2px 8px', borderRadius: 99 }}>Strong Buy: {a.indicators.analyst_strong_buy}</span>}
                        {a.indicators?.analyst_buy > 0 && <span style={{ background: '#2ECC71', color: 'white', padding: '2px 8px', borderRadius: 99 }}>Buy: {a.indicators.analyst_buy}</span>}
                        {a.indicators?.analyst_hold > 0 && <span style={{ background: '#EF9F27', color: 'white', padding: '2px 8px', borderRadius: 99 }}>Hold: {a.indicators.analyst_hold}</span>}
                        {a.indicators?.analyst_sell > 0 && <span style={{ background: '#E24B4A', color: 'white', padding: '2px 8px', borderRadius: 99 }}>Sell: {a.indicators.analyst_sell}</span>}
                      </div>
                    </div>
                    <div style={{ background: 'white', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 6, textTransform: 'uppercase' }}>AI Analysis</div>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: '#333' }}>{a.reasoning}</p>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ background: '#fff0f0', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#c0392b', marginBottom: 4, textTransform: 'uppercase' }}>Key Risks</div>
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: '#555' }}>{a.indicators?.key_risks}</p>
                      </div>
                      <div style={{ background: '#f0faf4', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#1D9E75', marginBottom: 4, textTransform: 'uppercase' }}>Key Catalysts</div>
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: '#555' }}>{a.indicators?.key_catalysts}</p>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#999', marginTop: 8, textAlign: 'right' }}>Analyzed: {new Date(a.analyzed_at).toLocaleString()}</div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {!loading && activeTab === 'portfolio' && (
        <div>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            Each stock flagged by AI when mentioned alongside a political post. Simulating $1,000 invested at time of mention.
          </div>
          {newStocks.length > 0 && (
            <div style={{ background: '#fff9ed', border: '1px solid #EF9F27', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#EF9F27', marginBottom: 8 }}>🆕 NEWLY ADDED TODAY ({newStocks.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {newStocks.map((s, i) => (
                  <span key={i} style={{ background: '#EF9F27', color: 'white', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                    {s.ticker} @ ${Number(s.price_at_mention).toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {portfolio.map((s, i) => {
            const gl = s.gain_loss || 0;
            const glPct = s.gain_loss_pct || 0;
            const isNew = isNewStock(s.mentioned_at);
            return (
              <div key={i} style={{ border: `1px solid ${isNew ? '#EF9F27' : '#eee'}`, borderRadius: 8, padding: 16, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: isNew ? '#fffdf5' : 'white' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{s.ticker}</span>
                    {isNew && <span style={{ background: '#EF9F27', color: 'white', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>NEW</span>}
                    <span style={{ fontSize: 13, color: '#666' }}>{s.company_name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#999' }}>Mentioned: {new Date(s.mentioned_at).toLocaleString()}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>Entry: ${Number(s.price_at_mention).toFixed(2)} · {Number(s.shares_bought).toFixed(4)} shares</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, color: '#333', marginBottom: 2 }}>Now: ${Number(s.current_price).toFixed(2)}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: gl >= 0 ? '#1D9E75' : '#E24B4A' }}>{gl >= 0 ? '+' : ''}${gl.toFixed(2)}</div>
                  <div style={{ fontSize: 12, color: gl >= 0 ? '#1D9E75' : '#E24B4A' }}>{glPct >= 0 ? '+' : ''}{glPct.toFixed(2)}%</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && activeTab === 'companies' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {companies.map((c, i) => (
            <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{c.name}</div>
              {c.ticker && <div style={{ fontSize: 12, color: '#1D9E75', marginBottom: 4 }}>{c.ticker}</div>}
              <div style={{ fontSize: 12, color: '#666' }}>{c.industry}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === 'contracts' && (
        <div>
          {contracts.map((c, i) => (
            <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{c.title}</div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{c.agency}</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#999' }}>
                <span>Value: {c.value}</span>
                {c.deadline && <span>Due: {c.deadline}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === 'bills' && (
        <div>
          {bills.map((b, i) => (
            <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, background: '#E6F1FB', color: '#0C447C', padding: '2px 8px', borderRadius: 99 }}>{b.number}</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{b.title}</div>
              <div style={{ fontSize: 13, color: '#666' }}>{b.status}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}