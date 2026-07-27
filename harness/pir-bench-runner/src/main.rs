//! pir-bench runner: drive one adapter at one parameter point, verify
//! correctness, measure (or accept modeled) metrics, and write a result record.

mod mock;

use pir_bench_core::{
    median, BenchParams, BenchResult, Environment, Metrics, PirImplementation, SetupInfo,
};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const RUNNER_VERSION: &str = env!("CARGO_PKG_VERSION");

struct Args {
    adapter: String,
    scheme: Option<String>,
    num_records: u64,
    record_bytes: u64,
    security_bits: u32,
    threads: u32,
    reps: usize,
    index: u64,
    out: PathBuf,
}

fn usage() -> ! {
    eprintln!(
        "usage: pir-bench-runner --adapter <name> [options]\n\
         \n\
         adapters (all synthetic, no real crypto):\n\
         \x20 mock-paper | mock-poulpy | mock-hisoka   InsPIRe-shaped profiles\n\
         \n\
         options:\n\
         \x20 --scheme <name>          scheme label (default inferred from adapter)\n\
         \x20 --records <N>            database size          (default 1048576)\n\
         \x20 --record-bytes <B>       bytes per record       (default 256)\n\
         \x20 --security-bits <L>      security level         (default 128)\n\
         \x20 --threads <T>            server threads         (default: all cores)\n\
         \x20 --reps <R>               timed repetitions      (default 5)\n\
         \x20 --index <I>              record index to fetch  (default 0)\n\
         \x20 --out <dir>              results directory      (default ../results)"
    );
    std::process::exit(2);
}

fn parse_args() -> Args {
    let default_threads = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(1);
    let mut a = Args {
        adapter: String::new(),
        scheme: None,
        num_records: 1_048_576,
        record_bytes: 256,
        security_bits: 128,
        threads: default_threads,
        reps: 5,
        index: 0,
        out: PathBuf::from("../results"),
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut val = || it.next().unwrap_or_else(|| usage());
        match flag.as_str() {
            "--adapter" => a.adapter = val(),
            "--scheme" => a.scheme = Some(val()),
            "--records" => a.num_records = val().parse().unwrap_or_else(|_| usage()),
            "--record-bytes" => a.record_bytes = val().parse().unwrap_or_else(|_| usage()),
            "--security-bits" => a.security_bits = val().parse().unwrap_or_else(|_| usage()),
            "--threads" => a.threads = val().parse().unwrap_or_else(|_| usage()),
            "--reps" => a.reps = val().parse().unwrap_or_else(|_| usage()),
            "--index" => a.index = val().parse().unwrap_or_else(|_| usage()),
            "--out" => a.out = PathBuf::from(val()),
            "-h" | "--help" => usage(),
            other => {
                eprintln!("unknown argument: {other}");
                usage();
            }
        }
    }
    if a.adapter.is_empty() {
        eprintln!("error: --adapter is required");
        usage();
    }
    a
}

fn build_adapter(name: &str) -> (Box<dyn PirImplementation>, String) {
    if let Some(m) = mock::MockInspire::by_name(name) {
        return (Box::new(m), "InsPIRe".to_string());
    }
    eprintln!("error: unknown adapter '{name}'");
    usage();
}

fn main() {
    let args = parse_args();
    let (mut adapter, default_scheme) = build_adapter(&args.adapter);
    let scheme = args.scheme.clone().unwrap_or(default_scheme);

    let params = BenchParams {
        num_records: args.num_records,
        record_bytes: args.record_bytes,
        security_bits: args.security_bits,
        threads: args.threads,
        scheme_params: BTreeMap::new(),
    };

    // ---- setup / preprocessing ----
    let t0 = Instant::now();
    let SetupInfo { offline_hint_bytes } = adapter.setup(&params).expect("setup failed");
    let preprocessing_ms = t0.elapsed().as_secs_f64() * 1000.0;

    // ---- warmup + timed reps ----
    let _ = time_once(adapter.as_mut(), args.index); // warmup (ignored)

    let mut gen_ms = Vec::new();
    let mut answer_ms = Vec::new();
    let mut decode_ms = Vec::new();
    let (mut query_len, mut response_len) = (0u64, 0u64);

    for _ in 0..args.reps.max(1) {
        let m = time_once(adapter.as_mut(), args.index);
        gen_ms.push(m.gen_ms);
        answer_ms.push(m.answer_ms);
        decode_ms.push(m.decode_ms);
        query_len = m.query_len;
        response_len = m.response_len;

        if let Some(expected) = adapter.expected_record(args.index) {
            assert!(
                m.decoded == expected,
                "CORRECTNESS FAILURE: decoded record != expected for index {}",
                args.index
            );
        }
    }

    // ---- measured metrics ----
    let server_answer_ms = median(&answer_ms);
    let db_bytes = (args.num_records * args.record_bytes) as f64;
    let measured = Metrics {
        query_bytes: Some(query_len),
        response_bytes: Some(response_len),
        offline_hint_bytes,
        preprocessing_ms: Some(preprocessing_ms),
        server_answer_ms,
        server_throughput_mbps: server_answer_ms
            .filter(|ms| *ms > 0.0)
            .map(|ms| (db_bytes / 1.0e6) / (ms / 1000.0)),
        client_query_gen_ms: median(&gen_ms),
        client_decode_ms: median(&decode_ms),
        peak_memory_bytes: None,
    };

    // A modeled adapter overrides the measured numbers.
    let modeled = adapter.modeled_metrics(&params);
    let is_modeled = modeled.is_some();
    let metrics = modeled.unwrap_or(measured);

    let result = BenchResult {
        scheme: scheme.clone(),
        implementation: adapter.metadata(),
        params,
        environment: capture_env(),
        metrics,
        notes: is_modeled.then(|| "MODELED metrics (no real cryptography executed).".to_string()),
    };

    let path = write_result(&args.out, &result).expect("failed to write result");
    print_summary(&result, &path);
}

struct Once {
    gen_ms: f64,
    answer_ms: f64,
    decode_ms: f64,
    query_len: u64,
    response_len: u64,
    decoded: Vec<u8>,
}

fn time_once(adapter: &mut dyn PirImplementation, index: u64) -> Once {
    let t = Instant::now();
    let query = adapter.gen_query(index).expect("gen_query failed");
    let gen_ms = t.elapsed().as_secs_f64() * 1000.0;

    let t = Instant::now();
    let response = adapter.answer(&query).expect("answer failed");
    let answer_ms = t.elapsed().as_secs_f64() * 1000.0;

    let t = Instant::now();
    let decoded = adapter.decode(&response).expect("decode failed");
    let decode_ms = t.elapsed().as_secs_f64() * 1000.0;

    Once {
        gen_ms,
        answer_ms,
        decode_ms,
        query_len: query.len() as u64,
        response_len: response.len() as u64,
        decoded,
    }
}

// ---------------------------------------------------------------------------
// Environment capture
// ---------------------------------------------------------------------------

fn capture_env() -> Environment {
    Environment {
        cpu_model: read_cpu_model(),
        cpu_features: read_cpu_features(),
        logical_cores: std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .ok(),
        ram_bytes: read_mem_total(),
        os: Some(std::env::consts::OS.to_string()),
        timestamp: Some(now_rfc3339()),
        runner_version: Some(RUNNER_VERSION.to_string()),
    }
}

fn read_cpu_model() -> String {
    std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("model name"))
                .and_then(|l| l.split(':').nth(1))
                .map(|v| v.trim().to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
}

fn read_cpu_features() -> Vec<String> {
    let flags = std::fs::read_to_string("/proc/cpuinfo").ok().and_then(|s| {
        s.lines()
            .find(|l| l.starts_with("flags"))
            .and_then(|l| l.split(':').nth(1))
            .map(|v| v.to_string())
    });
    let mut out = Vec::new();
    if let Some(flags) = flags {
        for feat in ["avx512f", "avx2", "avx", "sse4_2"] {
            if flags.split_whitespace().any(|f| f == feat) {
                out.push(feat.replace("avx512f", "avx512"));
            }
        }
    }
    out
}

fn read_mem_total() -> Option<u64> {
    let s = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = s.lines().find(|l| l.starts_with("MemTotal"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

fn write_result(out: &PathBuf, r: &BenchResult) -> std::io::Result<PathBuf> {
    let dir = out.join(slug(&r.scheme));
    std::fs::create_dir_all(&dir)?;
    let stamp = compact_stamp();
    let fname = format!(
        "{}_{}x{}_{}.json",
        slug(&r.implementation.name),
        r.params.num_records,
        r.params.record_bytes,
        stamp
    );
    let path = dir.join(fname);
    let json = serde_json::to_string_pretty(r).expect("serialize");
    std::fs::write(&path, json + "\n")?;
    Ok(path)
}

fn slug(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

fn print_summary(r: &BenchResult, path: &PathBuf) {
    let m = &r.metrics;
    println!("\n{} / {}", r.scheme, r.implementation.name);
    println!(
        "  N={} x {}B, {}-bit, {} threads on {}",
        r.params.num_records,
        r.params.record_bytes,
        r.params.security_bits,
        r.params.threads,
        r.environment.cpu_model
    );
    if let Some(v) = m.server_throughput_mbps {
        println!("  server throughput : {v:.1} MB/s");
    }
    if let Some(v) = m.server_answer_ms {
        println!("  server answer     : {v:.3} ms");
    }
    if let (Some(q), Some(resp)) = (m.query_bytes, m.response_bytes) {
        println!("  query / response  : {q} B / {resp} B");
    }
    if r.notes.is_some() {
        println!("  note              : modeled (not measured)");
    }
    println!("  -> {}", path.display());
}

// ---------------------------------------------------------------------------
// Time formatting (no external deps)
// ---------------------------------------------------------------------------

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// (year, month, day) from days since the Unix epoch. Howard Hinnant's algorithm.
fn civil_from_days(z0: i64) -> (i64, u32, u32) {
    let z = z0 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn ymd_hms(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, mo, d) = civil_from_days(days);
    (
        y,
        mo,
        d,
        (rem / 3600) as u32,
        (rem % 3600 / 60) as u32,
        (rem % 60) as u32,
    )
}

fn now_rfc3339() -> String {
    let (y, mo, d, h, mi, s) = ymd_hms(unix_secs());
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn compact_stamp() -> String {
    let (y, mo, d, h, mi, s) = ymd_hms(unix_secs());
    format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}Z")
}
