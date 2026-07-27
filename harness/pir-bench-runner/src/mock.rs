//! Synthetic InsPIRe-shaped adapters.
//!
//! These run no real cryptography. They round-trip records correctly (so the
//! runner's correctness check and full lifecycle are exercised) and report
//! **modeled** metrics in the ballpark of lattice PIR, so the pipeline and the
//! site can be developed before any real library is wired in.
//!
//! Three profiles are provided (`mock-paper`, `mock-poulpy`, `mock-hisoka`) with
//! deliberately different constants, purely so the explorer has multiple series
//! to compare. Every record they produce is flagged as modeled in `notes`; the
//! numbers are NOT representative of the real implementations.

use pir_bench_core::{BenchParams, Implementation, Metrics, PirImplementation, Result, SetupInfo};

pub struct Profile {
    pub name: &'static str,
    pub throughput_base: f64, // MB/s at 1 thread
    pub query_bytes: u64,
    pub response_bytes: u64,
    pub client_gen_ms: f64,
    pub client_decode_ms: f64,
}

pub const PROFILES: &[Profile] = &[
    Profile {
        name: "mock-paper",
        throughput_base: 300.0,
        query_bytes: 14_336,
        response_bytes: 6_144,
        client_gen_ms: 1.2,
        client_decode_ms: 0.7,
    },
    Profile {
        name: "mock-poulpy",
        throughput_base: 340.0,
        query_bytes: 12_288,
        response_bytes: 5_632,
        client_gen_ms: 0.9,
        client_decode_ms: 0.5,
    },
    Profile {
        name: "mock-hisoka",
        throughput_base: 280.0,
        query_bytes: 15_360,
        response_bytes: 6_656,
        client_gen_ms: 1.4,
        client_decode_ms: 0.8,
    },
];

pub struct MockInspire {
    profile: &'static Profile,
    params: Option<BenchParams>,
}

impl MockInspire {
    pub fn new(profile: &'static Profile) -> Self {
        Self {
            profile,
            params: None,
        }
    }

    pub fn by_name(name: &str) -> Option<Self> {
        PROFILES.iter().find(|p| p.name == name).map(Self::new)
    }

    fn record_for(index: u64, len: u64) -> Vec<u8> {
        (0..len)
            .map(|j| (index.wrapping_mul(2_654_435_761).wrapping_add(j)) as u8)
            .collect()
    }
}

impl PirImplementation for MockInspire {
    fn metadata(&self) -> Implementation {
        Implementation {
            name: self.profile.name.to_string(),
            repo: None,
            commit: None,
            language: Some("rust".to_string()),
        }
    }

    fn setup(&mut self, params: &BenchParams) -> Result<SetupInfo> {
        self.params = Some(params.clone());
        // InsPIRe uses silent preprocessing: no offline download.
        Ok(SetupInfo {
            offline_hint_bytes: Some(0),
        })
    }

    fn gen_query(&mut self, index: u64) -> Result<Vec<u8>> {
        Ok(index.to_le_bytes().to_vec())
    }

    fn answer(&mut self, query: &[u8]) -> Result<Vec<u8>> {
        let params = self.params.as_ref().ok_or("answer() before setup()")?;
        let mut idx = [0u8; 8];
        idx.copy_from_slice(query.get(..8).ok_or("short query")?);
        let index = u64::from_le_bytes(idx);
        Ok(Self::record_for(index, params.record_bytes))
    }

    fn decode(&mut self, response: &[u8]) -> Result<Vec<u8>> {
        Ok(response.to_vec())
    }

    fn expected_record(&self, index: u64) -> Option<Vec<u8>> {
        let params = self.params.as_ref()?;
        Some(Self::record_for(index, params.record_bytes))
    }

    fn modeled_metrics(&self, params: &BenchParams) -> Option<Metrics> {
        let p = self.profile;
        let db_bytes = (params.num_records * params.record_bytes) as f64;
        let db_mb = db_bytes / 1.0e6;
        let throughput = p.throughput_base * (params.threads as f64).sqrt();
        let server_answer_ms = db_mb / throughput * 1000.0;
        Some(Metrics {
            query_bytes: Some(p.query_bytes),
            response_bytes: Some(p.response_bytes),
            offline_hint_bytes: Some(0),
            preprocessing_ms: Some(db_mb * 2.0),
            server_answer_ms: Some(server_answer_ms),
            server_throughput_mbps: Some(throughput),
            client_query_gen_ms: Some(p.client_gen_ms),
            client_decode_ms: Some(p.client_decode_ms),
            peak_memory_bytes: Some((db_bytes * 1.4) as u64),
        })
    }
}
