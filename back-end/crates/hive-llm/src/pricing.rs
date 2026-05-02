//! Approximate per-million-token pricing used for cost estimation.
//!
//! These numbers are intentionally conservative rather than authoritative —
//! billing is done by each provider, not by HIVE. Used only for on-screen
//! "approximate spend" indicators and the `cost_events` table.
//!
//! The lookup is substring-based on the lower-cased model id so new minor
//! variants (e.g. dated suffixes like `-2026-01-15`) inherit the family
//! pricing without code edits. Extend the explicit arms when a new family
//! lands at a different rate.

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
            // Opus family — flagship reasoning. 4.x line: $15 / $75 per Mtok.
            if m.contains("opus") {
                Price {
                    input_per_mtok: 15.0,
                    output_per_mtok: 75.0,
                }
            // Haiku family — fast/cheap. 4.5 holds at $1 / $5 per Mtok.
            } else if m.contains("haiku") {
                Price {
                    input_per_mtok: 1.0,
                    output_per_mtok: 5.0,
                }
            // Sonnet family (default if "sonnet" or unrecognised). $3 / $15 per Mtok.
            } else {
                Price {
                    input_per_mtok: 3.0,
                    output_per_mtok: 15.0,
                }
            }
        }
        ProviderKind::Openai => {
            // gpt-5 flagship — assumed parity with prior flagship until a public sheet drops.
            if m.starts_with("gpt-5") || m.contains("gpt-5-") {
                Price {
                    input_per_mtok: 5.0,
                    output_per_mtok: 20.0,
                }
            } else if m.contains("gpt-4.1-mini") || m.contains("gpt-4o-mini") || m.contains("o3-mini")
                || m.contains("o4-mini")
            {
                Price {
                    input_per_mtok: 0.15,
                    output_per_mtok: 0.60,
                }
            } else if m.contains("gpt-4.1") {
                Price {
                    input_per_mtok: 2.0,
                    output_per_mtok: 8.0,
                }
            } else if m.contains("gpt-4o") || m.contains("chatgpt-4o") {
                Price {
                    input_per_mtok: 2.5,
                    output_per_mtok: 10.0,
                }
            } else if m.starts_with("o3") {
                Price {
                    input_per_mtok: 10.0,
                    output_per_mtok: 40.0,
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
            // Lite tier ships at the lowest price within the Flash family.
            if m.contains("flash-lite") {
                Price {
                    input_per_mtok: 0.05,
                    output_per_mtok: 0.20,
                }
            } else if m.contains("flash") {
                Price {
                    input_per_mtok: 0.075,
                    output_per_mtok: 0.30,
                }
            // Gemini 2.5 Pro and above.
            } else if m.contains("2.5-pro") || m.contains("3-pro") || m.contains("ultra") {
                Price {
                    input_per_mtok: 1.25,
                    output_per_mtok: 10.0,
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
///
/// Returns `i64`; both `cost_events.cost_cents` and `chat_messages.cost_cents`
/// are now i64 columns end-to-end (migration `m20260428_cost_cents_i64`).
pub fn cost_cents(kind: ProviderKind, model: &str, tokens_in: u32, tokens_out: u32) -> i64 {
    let p = price_for(kind, model);
    let dollars = (f64::from(tokens_in) / 1_000_000.0) * p.input_per_mtok
        + (f64::from(tokens_out) / 1_000_000.0) * p.output_per_mtok;
    (dollars * 100.0).ceil() as i64
}

/// Manifest of models the pricing table is required to recognise. New
/// production-supported models must be added here so the drift-detection
/// test fails the build until pricing exists for them.
///
/// "Recognised" here means the lookup hits a *specific* arm rather than
/// the per-provider fallback. Keep this list short and curated; older
/// dated suffixes inherit family pricing automatically.
pub const KNOWN_MODELS: &[(ProviderKind, &str)] = &[
    // Anthropic
    (ProviderKind::Anthropic, "claude-opus-4-7"),
    (ProviderKind::Anthropic, "claude-sonnet-4-6"),
    (ProviderKind::Anthropic, "claude-haiku-4-5"),
    (ProviderKind::Anthropic, "claude-haiku-4-5-20251001"),
    // OpenAI
    (ProviderKind::Openai, "gpt-5"),
    (ProviderKind::Openai, "gpt-5-mini"),
    (ProviderKind::Openai, "gpt-4.1"),
    (ProviderKind::Openai, "gpt-4.1-mini"),
    (ProviderKind::Openai, "gpt-4o"),
    (ProviderKind::Openai, "gpt-4o-mini"),
    // Gemini
    (ProviderKind::Gemini, "gemini-2.5-pro"),
    (ProviderKind::Gemini, "gemini-2.5-flash"),
    (ProviderKind::Gemini, "gemini-2.5-flash-lite"),
];

/// Whether `(provider, model)` resolves to a *specific* pricing arm rather
/// than the per-provider fallback. Used by tests and could power a future
/// "approximate cost (estimate)" UI badge.
pub fn pricing_is_known(kind: ProviderKind, model: &str) -> bool {
    let m = model.to_ascii_lowercase();
    match kind {
        ProviderKind::Anthropic => {
            m.contains("opus") || m.contains("haiku") || m.contains("sonnet")
        }
        ProviderKind::Openai => {
            m.starts_with("gpt-5")
                || m.contains("gpt-4.1-mini")
                || m.contains("gpt-4.1")
                || m.contains("gpt-4o-mini")
                || m.contains("gpt-4o")
                || m.contains("o3-mini")
                || m.contains("o4-mini")
                || m.starts_with("o3")
                || m.starts_with("o1")
                || m.contains("chatgpt-4o")
        }
        ProviderKind::Gemini => {
            m.contains("flash-lite")
                || m.contains("flash")
                || m.contains("2.5-pro")
                || m.contains("3-pro")
                || m.contains("ultra")
        }
        ProviderKind::Ollama => true, // Ollama is always free
    }
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
            "claude-opus-4-7",
            1_000_000,
            1_000_000,
        );
        let haiku = cost_cents(
            ProviderKind::Anthropic,
            "claude-haiku-4-5",
            1_000_000,
            1_000_000,
        );
        assert!(opus > haiku);
    }

    #[test]
    fn current_anthropic_models_priced() {
        // Sonnet 4.6 falls under the default arm (sonnet/unknown).
        let sonnet = price_for(ProviderKind::Anthropic, "claude-sonnet-4-6");
        assert_eq!(sonnet.input_per_mtok, 3.0);
        assert_eq!(sonnet.output_per_mtok, 15.0);

        let haiku = price_for(ProviderKind::Anthropic, "claude-haiku-4-5-20251001");
        assert_eq!(haiku.input_per_mtok, 1.0);

        let opus = price_for(ProviderKind::Anthropic, "claude-opus-4-7");
        assert_eq!(opus.input_per_mtok, 15.0);
    }

    #[test]
    fn current_openai_models_priced() {
        let gpt5 = price_for(ProviderKind::Openai, "gpt-5");
        assert_eq!(gpt5.input_per_mtok, 5.0);

        let gpt41 = price_for(ProviderKind::Openai, "gpt-4.1");
        assert_eq!(gpt41.input_per_mtok, 2.0);

        let mini = price_for(ProviderKind::Openai, "gpt-4.1-mini");
        assert_eq!(mini.input_per_mtok, 0.15);
    }

    #[test]
    fn gemini_flash_cheaper_than_pro() {
        let pro = cost_cents(ProviderKind::Gemini, "gemini-2.5-pro", 1_000_000, 1_000_000);
        let flash = cost_cents(ProviderKind::Gemini, "gemini-2.5-flash", 1_000_000, 1_000_000);
        let lite = cost_cents(
            ProviderKind::Gemini,
            "gemini-2.5-flash-lite",
            1_000_000,
            1_000_000,
        );
        assert!(pro > flash);
        assert!(flash > lite);
    }

    #[test]
    fn pricing_table_covers_known_models() {
        // Every entry in `KNOWN_MODELS` must resolve to a specific pricing
        // arm, never the per-provider fallback. New models added to the
        // manifest fail the build until pricing exists for them.
        for (kind, model) in KNOWN_MODELS {
            assert!(
                pricing_is_known(*kind, model),
                "pricing not specific for ({kind:?}, {model}) — add a match arm in price_for and pricing_is_known"
            );
        }
    }

    #[test]
    fn unknown_model_resolves_to_fallback() {
        assert!(!pricing_is_known(
            ProviderKind::Anthropic,
            "claude-whatever-99"
        ));
        assert!(!pricing_is_known(ProviderKind::Openai, "gpt-99"));
    }

    #[test]
    fn cost_accumulator_does_not_overflow_at_high_token_counts() {
        // i32 cents saturates at ~$21.47M. A long-running session can easily
        // exceed that across many turns; the in-memory accumulator must be
        // wide enough to count past that without wrapping silently.
        // 60 billion output tokens at Opus rates ≈ $4.5B → 4.5e11 cents,
        // well past i32::MAX but inside i64.
        let mut total: i64 = 0;
        for _ in 0..1_000 {
            // 1 billion output tokens per "turn" — extreme but representative
            // of a stress test or long aggregate.
            total = total.saturating_add(cost_cents(
                ProviderKind::Anthropic,
                "claude-opus-4-7",
                0,
                1_000_000_000,
            ));
        }
        assert!(total > i64::from(i32::MAX));
    }
}
