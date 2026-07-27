//! Core contract for pir-bench.
//!
//! Every PIR implementation is wrapped behind [`PirImplementation`] so the runner
//! can drive them all identically, and every run serializes to [`BenchResult`],
//! which matches `schema/result.schema.json`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

// ---------------------------------------------------------------------------
// Serialized result record (mirrors schema/result.schema.json)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchResult {
    pub scheme: String,
    pub implementation: Implementation,
    pub params: BenchParams,
    pub environment: Environment,
    pub metrics: Metrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Implementation {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchParams {
    pub num_records: u64,
    pub record_bytes: u64,
    pub security_bits: u32,
    pub threads: u32,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub scheme_params: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub cpu_model: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cpu_features: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logical_cores: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ram_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runner_version: Option<String>,
}

/// All metrics optional: omit what was not measured rather than reporting 0.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Metrics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline_hint_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preprocessing_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_answer_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_throughput_mbps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_query_gen_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_decode_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_memory_bytes: Option<u64>,
}

// ---------------------------------------------------------------------------
// The unified implementation trait
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct SetupInfo {
    /// One-time offline download (hint / public params). `Some(0)` for
    /// silent-preprocessing schemes; `None` if not applicable.
    pub offline_hint_bytes: Option<u64>,
}

/// A PIR implementation the runner can benchmark.
///
/// The runner times each phase with a monotonic clock and derives throughput.
/// An adapter that cannot run real crypto here (or that carries numbers lifted
/// from a paper) overrides [`PirImplementation::modeled_metrics`]; those values
/// win over wall-clock timing and the record is flagged in `notes`.
pub trait PirImplementation {
    fn metadata(&self) -> Implementation;

    /// Build the database and perform one-time server preprocessing.
    fn setup(&mut self, params: &BenchParams) -> Result<SetupInfo>;

    /// Client: generate a query for record `index`.
    fn gen_query(&mut self, index: u64) -> Result<Vec<u8>>;

    /// Server: answer a query.
    fn answer(&mut self, query: &[u8]) -> Result<Vec<u8>>;

    /// Client: decode a response back into the record bytes.
    fn decode(&mut self, response: &[u8]) -> Result<Vec<u8>>;

    /// The record the runner expects `decode` to return for `index`, used for a
    /// correctness cross-check. `None` skips the check.
    fn expected_record(&self, _index: u64) -> Option<Vec<u8>> {
        None
    }

    /// Modeled / estimated metrics that override measured timing. Real adapters
    /// return `None` (default) and are measured live.
    fn modeled_metrics(&self, _params: &BenchParams) -> Option<Metrics> {
        None
    }
}

/// Median of a slice, or `None` if empty. (Robust to warmup jitter.)
pub fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = v.len() / 2;
    Some(if v.len() % 2 == 0 {
        (v[mid - 1] + v[mid]) / 2.0
    } else {
        v[mid]
    })
}
