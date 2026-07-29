// Drive poulpy-pir at database shapes its DefaultPirParameters32B presets do not
// express. The presets stop at 1 GiB; a single-token balance index is ~2^23
// payloads (256 MB), three doublings below that, and query size is a function of
// the layout width rather than the database size — so the interesting
// configuration (small database, narrow layout) is unreachable through presets.
//
// This is NOT a reimplementation. `Config` carries only the cryptographic
// parameters (n, base2k, k, collapse) — the database size lives entirely in
// `DatabaseLayout`, and `DatabaseLayout::new(rows, cols)` is public. So we borrow
// a preset's `Config` and supply our own layout, exactly as the crate's own
// example passes the two independently.
//
// Output deliberately mirrors examples/pir.rs label-for-label, so
// adapters/_lib/poulpy-to-adapter.mjs parses it unchanged.
//
//   small-pir --collapse recursion-g32 --rows 32768 --cols 4096 [--batch 1]
//
// Shape rules (asserted by the crate, restated here so a bad shape fails with a
// useful message rather than deep inside the library):
//   rows % n == 0                      (n = 2048)
//   rows % column_height == 0          (gamma0 for recursion, n for interpolation)
//   next_pow2(rows / n) <= 2n          (interpolation's second dimension)
// Capacity is then (rows/column_height) * cols * (column_height / P::EXPONENT),
// with EXPONENT 16 for recursion (P65536) and 17 for interpolation (P65535).

use std::time::Instant;

#[cfg(feature = "avx512-fhe")]
use poulpy_cpu_avx512::FFT64Avx512 as BE;
// Fallback so the driver type-checks and runs on hosts without AVX-512. It is
// slower; never publish numbers from it.
#[cfg(not(feature = "avx512-fhe"))]
use poulpy_cpu_avx::FFT64Avx as BE;

use poulpy_pir::{
    client::Client,
    config::{Config, DefaultPirConfig32B, DefaultPirParameters32B},
    database::DatabaseLayout,
    payload::Payload,
    server::Server,
};

const REPEATS: usize = 10;

struct Args {
    collapse: String,
    rows: usize,
    cols: usize,
    batch: usize,
}

fn parse_args() -> Args {
    let mut a = Args {
        collapse: "recursion-g32".to_string(),
        rows: 32768,
        cols: 4096,
        batch: 1,
    };
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let v = argv.get(i + 1).cloned().unwrap_or_default();
        match argv[i].as_str() {
            "--collapse" => a.collapse = v,
            "--rows" => a.rows = v.parse().expect("rows"),
            "--cols" => a.cols = v.parse().expect("cols"),
            "--batch" => a.batch = v.parse().expect("batch"),
            other => panic!("unknown flag: {other}"),
        }
        i += 2;
    }
    a
}

fn format_bytes(bytes: f64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let (mut v, mut u) = (bytes, 0);
    while v >= 1024.0 && u + 1 < UNITS.len() {
        v /= 1024.0;
        u += 1;
    }
    format!("{v:.3} {}", UNITS[u])
}

fn main() {
    let args = parse_args();

    // Borrow cryptographic parameters from a canonical preset. Which size we ask
    // for is irrelevant — Config does not carry the database size — but the
    // collapse must match what we intend to run.
    let preset_name = match args.collapse.as_str() {
        "interpolation" => "InsPIRe-1GiB-c32768",
        "recursion-g16" => "InsPIRe2-g16-1GiB-c32768",
        "recursion-g32" => "InsPIRe2-g32-1GiB-c32768",
        "recursion-g64" => "InsPIRe2-g64-1GiB-c32768",
        other => panic!("unknown collapse: {other}"),
    };
    let preset = DefaultPirParameters32B::from_name(preset_name).expect("preset");

    println!("preset                       : custom-{}-r{}-c{}", args.collapse, args.rows, args.cols);
    match preset.resolve() {
        DefaultPirConfig32B::Interpolation(p) => run(p.config, args),
        DefaultPirConfig32B::Recursion(p) => run(p.config, args),
    }
}

fn run<P>(config: Config<[u8; 32], P>, args: Args)
where
    P: Payload<[u8; 32]>,
{
    let n = config.n();
    let column_height = config.column_height();

    assert_eq!(args.rows % n, 0, "rows must be a multiple of n = {n}");
    assert_eq!(
        args.rows % column_height,
        0,
        "rows must be a multiple of column_height = {column_height}"
    );

    let layout = DatabaseLayout::<P>::new(args.rows, args.cols);
    let capacity = layout.num_payloads(column_height);

    println!("collapse                    : {:?}", config.collapse());
    println!("ring degree n               : {n}\n");
    println!("database                    : {} rows x {} cols", args.rows, args.cols);
    println!(
        "payload capacity            : {} x 32 B = {}",
        capacity,
        format_bytes((capacity * 32) as f64)
    );

    let timer = Instant::now();
    let mut client = Client::<BE, P>::new(config, layout);
    let mut server = Server::<BE, P>::new(config, layout);
    println!("SETUP                        : {:?}", timer.elapsed());

    // Same deterministic filler as the crate's example: content depends only on
    // the payload index, so runs are reproducible and comparable.
    let t = Instant::now();
    let workers = std::thread::available_parallelism().map_or(1, |x| x.get());
    let chunk = (1usize << 22).min(capacity.max(1));
    let mut buf = vec![[0u8; 32]; chunk];
    let mut start = 0;
    while start < capacity {
        let len = chunk.min(capacity - start);
        let sub = len.div_ceil(workers);
        std::thread::scope(|scope| {
            for (w, part) in buf[..len].chunks_mut(sub).enumerate() {
                let first = start + w * sub;
                scope.spawn(move || fill_payloads(part, first));
            }
        });
        server.update_shard(start, &buf[..len]);
        start += len;
    }
    println!("database fill                : {:?}", t.elapsed());

    let t = Instant::now();
    server.generate_query_mask();
    println!("SETUP (query mask)           : {:?}", t.elapsed());

    let off = server.offline();
    println!("OFFLINE total                : {:?}", off.total());

    let item_index = capacity / 3; // somewhere in the middle, not a hot first block
    let stride = (capacity / args.batch).max(1);
    let items: Vec<usize> = (0..args.batch)
        .map(|k| (item_index + k * stride) % capacity)
        .collect();

    let t = Instant::now();
    let mut queries = Vec::with_capacity(args.batch);
    let mut states = Vec::with_capacity(args.batch);
    for &item in &items {
        let (q, st) = client.query(item);
        queries.push(q);
        states.push(st);
    }
    println!("QUERY (build {})            : {:?}", args.batch, t.elapsed());

    let mut total_wall = std::time::Duration::ZERO;
    let mut responses = Vec::new();
    for _ in 0..REPEATS {
        let started = Instant::now();
        let (resps, _online) = server.respond_batch_timed(&queries);
        total_wall += started.elapsed();
        responses = resps;
    }
    let avg_wall = total_wall / REPEATS as u32;
    println!(
        "ONLINE avg wall ({} q × {})    : {:?}",
        args.batch, REPEATS, avg_wall
    );
    if args.batch > 1 {
        println!("  per query (wall-clock)     : {:?}", avg_wall / args.batch as u32);
    }

    let module = server.params().module();
    let mut qbuf = Vec::new();
    queries[0].write_to(module, &mut qbuf).expect("serialize query");
    let mut rbuf = Vec::new();
    responses[0].write_to(module, &mut rbuf).expect("serialize response");
    println!("QUERY size                   : {} B ({})", qbuf.len(), format_bytes(qbuf.len() as f64));
    println!("RESPONSE size                : {} B ({})", rbuf.len(), format_bytes(rbuf.len() as f64));

    let mut ok = 0usize;
    for ((resp, st), &item) in responses.iter().zip(&states).zip(&items) {
        if client.decode(resp, st) == server.get(item) {
            ok += 1;
        }
    }
    println!("RESULT                       : {ok}/{} decoded OK", args.batch);
    if let Some(peak) = peak_rss_bytes() {
        println!("PEAK MEMORY (VmHWM)          : {}", format_bytes(peak as f64));
    }
    assert_eq!(ok, args.batch, "decode mismatch");
}

fn peak_rss_bytes() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmHWM:") {
            let kib: u64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kib * 1024);
        }
    }
    None
}

fn fill_payloads(out: &mut [[u8; 32]], first_index: usize) {
    for (i, payload) in out.iter_mut().enumerate() {
        let index = (first_index + i) as u64;
        for word in 0..4u64 {
            let mut x = (index * 4 + word).wrapping_add(0x9e37_79b9_7f4a_7c15);
            x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            x ^= x >> 31;
            payload[word as usize * 8..][..8].copy_from_slice(&x.to_le_bytes());
        }
    }
}
