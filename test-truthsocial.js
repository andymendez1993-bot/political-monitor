require('dotenv').config();
const axios = require('axios');

async function fetchTrumpTruths() {
  console.log('Fetching Trump Truth Social posts via API...');
  
  try {
    // Trump's Truth Social account ID
    const accountId = '107780257626128497';
    
    const res = await axios.get(
      `https://truthsocial.com/api/v1/accounts/${accountId}/statuses`,
      {
        params: {
          limit: 20,
          exclude_replies: true,
          exclude_reblogs: false
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    const posts = res.data || [];
    console.log(`Found ${posts.length} posts`);
    
    posts.forEach((p, i) => {
      const text = p.content?.replace(/<[^>]+>/g, '') || '';
      console.log(`\nPost ${i+1} [${p.created_at}]:\n${text.substring(0, 200)}`);
    });

  } catch (e) {
    console.error('Error:', e.message);
    if (e.response) console.error('Status:', e.response.status, JSON.stringify(e.response.data).substring(0, 200));
  }
}

fetchTrumpTruths();