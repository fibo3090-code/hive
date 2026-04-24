//! Approximate per-million-token pricing used for cost estimation.
//!
//! These numbers are intentionally conservative rather than authoritative —
//! billing is done by each provider, not by HIVE. Used only for on-screen
//! "approximate spend" indicators and the `cost_events` table.

use crate::ProviderKind;

/// Dollars per million tokens as `(input, output)`.
#[derive(Clone, Copy, Debug)]
pub struct Price {
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
}

/// Best-effort price lookup for `(provider, model)`. Unknown models default to
/// a sane middle-of-the-road estimate so the cost column is never blank.
pub fn price_for(kind: ProviderKind, model: &str) -> Price {
    let m = model.to_ascii_lowercase();
    match kind {
        ProviderKind::Anthropic => {
            if m.contains("opus") {
                Price {
                    input_per_mtok: 15.0,
                    output_per_mtok: 75.0,
                }
            } else if m.contains("haiku") {
                Price {
                    input_per_mtok: 1.0,
                    output_per_mtok: 5.0,
                }
            } else {
                Price {
                    input_per_mtok: 3.0,
                    output_per_mtok: 15.0,
                }
            }
        }
        ProviderKind::Openai => {
            if m.contains("gpt-4o-mini") || m.contains("o3-mini") {
                Price {
                    input_per_mtok: 0.15,
                    output_per_mtok: 0.60,
                }
            } else if m.contains("gpt-4o") || m.contains("chatgpt-4o") {
                Price {
                    input_per_mtok: 2.5,
                    output_per_mtok: 10.0,
                }
            } else if m.starts_with("o1") {
                Price {
                    input_per_mtok: 15.0,
                    output_per_mtok: 60.0,
                }
            } else {
                Price {
                    input_per_mtok: 1.0,
                    output_per_mtok: 3.0,
                }
            }
        }
        ProviderKind::Gemini => {
            if m.contains("flash") {
                Price {
                    input_per_mtok: 0.075,
                    output_per_mtok: 0.30,
                }
            } else {
                Price {
                    input_per_mtok: 1.25,
                    output_per_mtok: 5.0,
                }
            }
        }
        ProviderKind::Ollama => Price {
            input_per_mtok: 0.0,
            output_per_mtok: 0.0,
        },
    }
}

/// Compute cost in cents (rounded up) for a turn's token usage.
pub fn cost_cents(kind: ProviderKind, model: &str, tokens_in: u32, tokens_out: u32) -> i32 {
    let p = price_for(kind, model);
    let dollars = (f64::from(tokens_in) / 1_000_000.0) * p.input_per_mtok
        + (f64::from(tokens_out) / 1_000_000.0) * p.output_per_mtok;
    (dollars * 100.0).ceil() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ollama_is_free() {
        assert_eq!(
            cost_cents(ProviderKind::Ollama, "llama3.1:8b", 1_000_000, 1_000_000),
            0
        );
    }

    #[test]
    fn opus_is_pricier_than_haiku() {
        let opus = cost_cents(
            ProviderKind::Anthropic,
            "claude-opus-4",
            1_000_000,
            1_000_000,
        );
        let haiku = cost_cents(
            ProviderKind::Anthropic,
            "claude-haiku-4",
            1_000_000,
            1_000_000,
        );
        assert!(opus > haiku);
    }
}
