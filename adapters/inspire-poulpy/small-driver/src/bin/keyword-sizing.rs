// Measure the client-side download of poulpy's keyword layer.
//
// Every latency and bandwidth number elsewhere in this repo is for INDEX PIR —
// retrieval by position. A real lookup starts from an address, and closing that
// gap costs a client download that appears in none of those numbers:
//
//   - the MPHF parameters (once, and again on every re-derivation), and
//   - the delta tail of keys added since the last re-derivation.
//
// poulpy documents ~2.116 bits/key at its chosen alpha. This measures the
// serialized blob directly rather than trusting the constant, and reports the
// per-month cost against a query budget so the two are comparable.
//
//   keyword-sizing --keys 8388608 [--new-keys-per-day 10000] [--lookups-per-month 600]

use std::time::Instant;

use poulpy_pir::keyword::{DEFAULT_REBUILD_THRESHOLD, EthAddress, KeywordIndex};

fn main() {
    let mut keys_n: usize = 8_388_608; // 2^23, single-token scale
    let mut new_per_day: usize = 10_000;
    let mut lookups_per_month: usize = 600;
    let mut query_bytes: usize = 296_238; // interpolation c8192 total, this repo's recommendation

    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let v = argv.get(i + 1).cloned().unwrap_or_default();
        match argv[i].as_str() {
            "--keys" => keys_n = v.parse().expect("keys"),
            "--new-keys-per-day" => new_per_day = v.parse().expect("new-keys-per-day"),
            "--lookups-per-month" => lookups_per_month = v.parse().expect("lookups-per-month"),
            "--query-bytes" => query_bytes = v.parse().expect("query-bytes"),
            other => panic!("unknown flag: {other}"),
        }
        i += 2;
    }

    // Distinct pseudorandom addresses. An MPHF is only defined over distinct
    // keys, and splitmix64 over the index guarantees that without a hash set.
    let mut keys: Vec<EthAddress> = Vec::with_capacity(keys_n);
    for idx in 0..keys_n as u64 {
        let mut a = [0u8; 20];
        for word in 0..3u64 {
            let mut x = (idx.wrapping_mul(3).wrapping_add(word)).wrapping_add(0x9e37_79b9_7f4a_7c15);
            x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            x ^= x >> 31;
            let off = (word as usize) * 8;
            let n = 20usize.saturating_sub(off).min(8);
            a[off..off + n].copy_from_slice(&x.to_le_bytes()[..n]);
        }
        keys.push(a);
    }

    let t = Instant::now();
    let index = KeywordIndex::build(&keys).expect("MPHF build");
    let build = t.elapsed();

    let mut blob = Vec::new();
    index.write_to(&mut blob).expect("serialize MPHF");

    let bits_per_key = (blob.len() as f64 * 8.0) / keys_n as f64;

    println!("keys                         : {keys_n}");
    println!("MPHF build                   : {build:?}");
    println!("MPHF serialized              : {} B ({:.2} MB)", blob.len(), blob.len() as f64 / 1e6);
    println!("bits/key                     : {bits_per_key:.3}");

    // A re-derivation permutes every index, so the client must re-download the
    // whole blob; it happens once per DEFAULT_REBUILD_THRESHOLD new keys.
    let days_per_rebuild = DEFAULT_REBUILD_THRESHOLD as f64 / new_per_day.max(1) as f64;
    let mphf_per_month = blob.len() as f64 * (30.0 / days_per_rebuild.max(0.001));
    // Between rebuilds the client fetches the delta tail: bare 20-byte keys.
    let delta_per_month = (new_per_day * 30 * 20) as f64;
    let queries_per_month = (lookups_per_month * query_bytes) as f64;

    println!();
    println!("assuming {new_per_day} new keys/day, {lookups_per_month} lookups/month at {query_bytes} B:");
    println!("  rebuild every              : {days_per_rebuild:.1} days ({DEFAULT_REBUILD_THRESHOLD} key threshold)");
    println!("  MPHF re-download / month   : {:.2} MB", mphf_per_month / 1e6);
    println!("  delta tail / month         : {:.2} MB", delta_per_month / 1e6);
    println!("  keyword layer total        : {:.2} MB", (mphf_per_month + delta_per_month) / 1e6);
    println!("  PIR queries / month        : {:.2} MB", queries_per_month / 1e6);
    println!(
        "  keyword share of traffic   : {:.1}%",
        100.0 * (mphf_per_month + delta_per_month) / (mphf_per_month + delta_per_month + queries_per_month)
    );
}
