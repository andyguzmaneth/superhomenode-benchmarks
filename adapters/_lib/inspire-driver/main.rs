// Bench driver for the `inspire` API, shared by every adapter that builds
// against a copy of it (crates.io 0.2.0, the lianghuiqiang9 fork, ...).
// `--label` names the codebase under test.
//
// The published crate ships a library and three CLI binaries, but no benchmark
// that emits machine-readable results — so this driver calls the protocol
// directly and writes the canonical adapter report (see adapters/README.md).
//
// Phases are timed the way the rest of this repo defines them:
//   preprocessing  = setup()            (once, offline, DB-sized)
//   client_query   = query()            (per query)
//   server_answer  = respond()          (per query)
//   client_decode  = extract()          (per query)
//
// Usage:
//   <driver-bin> --label inspire-upstream --entries-log2 24 --record-bytes 32 \
//     --seeds 0,1,2 --warmup 4 --measured 16 --variant two-packing \
//     --out report.json

use std::env;
use std::fs;
use std::time::Instant;

use inspire::math::GaussianSampler;
use inspire::params::{InspireParams, InspireVariant};
use inspire::pir::{extract_with_variant, query, respond_with_variant, setup};

struct Args {
    entries_log2: u32,
    record_bytes: usize,
    seeds: Vec<u64>,
    warmup: usize,
    measured: usize,
    variant: InspireVariant,
    variant_label: String,
    /// Names the codebase under test in the report's `variant` field — the same
    /// source builds against several copies of this API.
    label: String,
    out: String,
}

fn parse_args() -> Args {
    let mut a = Args {
        entries_log2: 20,
        record_bytes: 32,
        seeds: vec![0, 1, 2],
        warmup: 4,
        measured: 16,
        variant: InspireVariant::TwoPacking,
        variant_label: "two-packing".to_string(),
        label: "inspire".to_string(),
        out: "report.json".to_string(),
    };
    let argv: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let key = argv[i].as_str();
        let val = argv.get(i + 1).cloned().unwrap_or_default();
        match key {
            "--entries-log2" => a.entries_log2 = val.parse().expect("entries-log2"),
            "--record-bytes" => a.record_bytes = val.parse().expect("record-bytes"),
            "--seeds" => {
                a.seeds = val
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.parse().expect("seed"))
                    .collect()
            }
            "--warmup" => a.warmup = val.parse().expect("warmup"),
            "--measured" => a.measured = val.parse().expect("measured"),
            "--variant" => {
                a.variant_label = val.clone();
                a.variant = match val.as_str() {
                    "no-packing" => InspireVariant::NoPacking,
                    "one-packing" => InspireVariant::OnePacking,
                    "two-packing" => InspireVariant::TwoPacking,
                    other => panic!("unknown variant: {other}"),
                }
            }
            "--label" => a.label = val.clone(),
            "--out" => a.out = val.clone(),
            other => panic!("unknown flag: {other}"),
        }
        i += 2;
    }
    a
}

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let m = xs.len() / 2;
    if xs.len() % 2 == 0 {
        (xs[m - 1] + xs[m]) / 2.0
    } else {
        xs[m]
    }
}

/// Canonical timing object: median plus the observed spread across seeds.
fn timing(xs: &[f64]) -> serde_json::Value {
    let mut o = serde_json::Map::new();
    o.insert("median".into(), median(xs.to_vec()).into());
    if xs.len() > 1 {
        let min = xs.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        o.insert("min".into(), min.into());
        o.insert("max".into(), max.into());
        o.insert("n".into(), (xs.len() as u64).into());
    }
    serde_json::Value::Object(o)
}

fn main() {
    let args = parse_args();

    // d=2048 is the parameter set the crate documents for 32-byte Ethereum
    // entries, and the one Raven's fork patches — keeping it makes the two rows
    // a like-for-like comparison of the same nominal configuration.
    let params = InspireParams::secure_128_d2048();
    params.validate().expect("params validate");

    let total_entries: usize = 1usize << args.entries_log2;
    let db_bytes = total_entries * args.record_bytes;
    eprintln!(
        "{}: 2^{} x {}B = {:.2} GB, variant {}",
        args.label,
        args.entries_log2,
        args.record_bytes,
        db_bytes as f64 / 1e9,
        args.variant_label
    );

    // Deterministic filler. The content is irrelevant to timing; what matters is
    // that every implementation sees a database of identical shape.
    let mut database = vec![0u8; db_bytes];
    for (i, b) in database.iter_mut().enumerate() {
        *b = (i % 251) as u8;
    }

    let mut setup_ms = Vec::new();
    let mut query_ms = Vec::new();
    let mut server_ms = Vec::new();
    let mut extract_ms = Vec::new();
    let mut query_bytes = 0usize;
    let mut response_bytes = 0usize;

    for seed in &args.seeds {
        let mut sampler = GaussianSampler::new(params.sigma);

        let t0 = Instant::now();
        let (crs, encoded_db, sk) = setup(&params, &database, args.record_bytes, &mut sampler)
            .expect("setup failed");
        setup_ms.push(t0.elapsed().as_secs_f64() * 1e3);

        let shard_config = encoded_db.config.clone();
        // Spread indices across the database rather than hammering index 0, so a
        // single hot cache line cannot flatter the answer time.
        let index_for = |it: usize| -> u64 {
            ((seed.wrapping_mul(7919).wrapping_add(it as u64 * 104_729)) as usize % total_entries)
                as u64
        };

        for it in 0..args.warmup {
            let (state, q) = query(&crs, index_for(it), &shard_config, &sk, &mut sampler)
                .expect("warmup query");
            let resp = respond_with_variant(&crs, &encoded_db, &q, args.variant)
                .expect("warmup respond");
            let _ = extract_with_variant(&crs, &state, &resp, args.record_bytes, args.variant)
                .expect("warmup extract");
        }

        let mut q_local = Vec::new();
        let mut s_local = Vec::new();
        let mut e_local = Vec::new();
        for it in 0..args.measured {
            let idx = index_for(args.warmup + it);

            let t = Instant::now();
            let (state, q) =
                query(&crs, idx, &shard_config, &sk, &mut sampler).expect("query failed");
            q_local.push(t.elapsed().as_secs_f64() * 1e3);

            let t = Instant::now();
            let resp = respond_with_variant(&crs, &encoded_db, &q, args.variant)
                .expect("respond failed");
            s_local.push(t.elapsed().as_secs_f64() * 1e3);

            let t = Instant::now();
            let _entry = extract_with_variant(&crs, &state, &resp, args.record_bytes, args.variant)
                .expect("extract failed");
            e_local.push(t.elapsed().as_secs_f64() * 1e3);

            if query_bytes == 0 {
                query_bytes = bincode::serialize(&q).expect("serialize query").len();
                response_bytes = bincode::serialize(&resp).expect("serialize response").len();
            }
        }

        // One median per seed, so the reported spread is across seeds and not
        // across iterations within a seed — matching how the raven adapter
        // reports it.
        query_ms.push(median(q_local));
        server_ms.push(median(s_local));
        extract_ms.push(median(e_local));
    }

    let report = serde_json::json!({
        "cell": { "entries_log2": args.entries_log2, "record_bytes": args.record_bytes },
        "variant": format!("{}-{}-inspiring", args.label, args.variant_label),
        "scheme_params": {
            "ring_dim": params.ring_dim,
            "log_q": (params.q as f64).log2(),
            "crt_moduli": params.crt_moduli,
            "plaintext_modulus": params.p,
            "sigma": params.sigma,
            "gadget_base": params.gadget_base,
            "gadget_len": params.gadget_len,
        },
        "timings_ms": {
            "server_answer": timing(&server_ms),
            "client_query_gen": timing(&query_ms),
            "client_decode": timing(&extract_ms),
            "preprocessing": timing(&setup_ms),
        },
        // Silent preprocessing: no hint is downloaded by the client.
        "sizes_bytes": { "query": query_bytes, "response": response_bytes, "offline_hint": 0 },
        "seeds": args.seeds,
        "measured_per_seed": args.measured,
    });

    fs::write(&args.out, serde_json::to_string_pretty(&report).unwrap() + "\n")
        .expect("write report");
    eprintln!("wrote {}", args.out);
}
