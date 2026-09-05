require('dotenv').config();

const supabase = require('./src/config/supabase');

async function testSupabase() {
  try {
    const { data, error } =
      await supabase.storage.listBuckets();

    if (error) {
      console.error('Supabase error:', error);
      return;
    }

    console.log('Connected to Supabase.');
    console.log('Buckets:', data);
  } catch (error) {
    console.error('Connection failed:', error);
  }
}

testSupabase();