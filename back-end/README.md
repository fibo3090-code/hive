# Hive Backend

A high-performance, modular Rust backend built with Axum, providing a robust API for project management, agent orchestration, and real-time data synchronization.

## Overview

Hive Backend is a production-ready REST API powered by Rust, designed to handle complex project workflows, manage AI agents, track resources, and provide real-time updates to connected clients.

## Features

- **RESTful API** - Clean and intuitive API endpoints
- **Database Support** - SQLite and PostgreSQL via SeaORM
- **Async Runtime** - Built on Tokio for high concurrency
- **CORS Support** - Cross-origin resource sharing configured
- **OpenAPI Documentation** - Auto-generated API documentation
- **Modular Codebase** - Organized into focused crates
- **Type Safety** - Full Rust type safety and compile-time guarantees
- **Database Migrations** - Version-controlled schema changes
- **Seed Data** - Pre-populated datasets for development
- **LLM Providers** - Pluggable clients for Anthropic, OpenAI, Gemini, Ollama with encrypted key storage
- **Secret Encryption** - ChaCha20-Poly1305 AEAD for API keys at rest

## Tech Stack

- **Language**: Rust
- **Web Framework**: Axum 0.7+
- **Async Runtime**: Tokio
- **Database ORM**: SeaORM
- **Database Drivers**: SQLx (SQLite & PostgreSQL)
- **API Documentation**: OpenAPI/Swagger
- **HTTP Client**: Tower

## Prerequisites

- Rust 1.70+ (see `rust-toolchain.toml`)
- Cargo
- PostgreSQL or SQLite (depending on configuration)

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd hive/hive-code/back-end
   ```

2. **Install Rust (if not already installed):**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Verify Rust installation:**
   ```bash
   rustc --version
   cargo --version
   ```

## Configuration

### Environment Setup

1. **Copy the example configuration:**
   ```bash
   cp config/local.example.toml config/local.toml
   ```

2. **Edit `config/local.toml`** with your settings:
   ```toml
   [database]
   url = "sqlite://hive.db"  # or PostgreSQL URL
   
   [server]
   host = "127.0.0.1"
   port = 3000
   ```

### Database Setup

1. **Run migrations:**
   ```bash
   cargo run -p hive-api -- migrate
   ```

2. **Seed the database (optional):**
   ```bash
   cargo run -p hive-api -- seed
   ```

Migrations and seeds also run automatically on `serve`.

## Development

### Start Development Server

```bash
cargo run -p hive-api -- serve
```

The API will be available at `http://127.0.0.1:8787`.

On first start the API generates `~/.hive/master.key` (ChaCha20-Poly1305 master key for secret encryption) and probes Ollama at `http://localhost:11434` — if Ollama is running, its provider row is flagged connected automatically.

### Build for Production

```bash
cargo build --release
```

Binary will be at `target/release/hive-api`

### Run Tests

```bash
cargo test
```

### Build Documentation

```bash
cargo doc --open
```

### Check Code Quality

```bash
cargo clippy -- -D warnings
cargo fmt --check
```

## Project Structure

```
hive-code/back-end/
├── crates/
│   ├── hive-api/           # REST API and main server
│   │   └── src/
│   ├── hive-domain/        # Business logic and domain models
│   │   └── src/
│   ├── hive-db/            # Database models and queries
│   │   ├── migration/       # Database migrations
│   │   └── src/
│   ├── hive-crypto/        # ChaCha20-Poly1305 AEAD for secrets at rest
│   │   └── src/
│   ├── hive-llm/           # LLM provider clients (Anthropic/OpenAI/Gemini/Ollama)
│   │   └── src/
│   └── hive-seed/          # Database seeding utilities
│       └── src/
├── config/
│   ├── default.toml        # Default configuration
│   └── local.example.toml   # Example local configuration
├── openapi/
│   └── openapi.json        # OpenAPI specification
├── seed/                    # Seed data files
│   ├── activity_feed.json
│   ├── agent_blueprints.json
│   ├── module_catalog.json
│   ├── requirements.json
│   ├── session_history.json
│   ├── settings_state.json
│   ├── spend.json
│   ├── task_throughput.json
│   └── user_stories.json
├── Cargo.toml              # Workspace manifest
└── rust-toolchain.toml     # Rust version specification
```

## Crates

### hive-api
Main REST API server built with Axum. Contains:
- Route handlers
- Request/response models
- Middleware configuration
- CORS setup

### hive-domain
Core business logic and domain models:
- Business rules
- Domain entities
- Service layer
- Error types

### hive-db
Database layer with SeaORM:
- Entity models
- Database queries
- Connection pool management
- Schema definitions

#### Migrations
Located in `crates/hive-db/migration/`. Create new migrations with:
```bash
cargo run --package hive-db --bin migration create <migration_name>
```

### hive-seed
Database seeding utilities:
- Loads JSON seed files from `seed/` directory
- Populates initial data for development

### hive-crypto
Secret-at-rest encryption. On first use, generates a master key at `~/.hive/master.key` (0600 on Unix). Provides `seal` / `open` helpers using ChaCha20-Poly1305 AEAD plus `mask_key` for UI-safe previews (`sk-…abcd`).

### hive-llm
Async trait `LlmProvider` with `list_models`, `test_connection`, and `complete` methods. Factory `client_for(ProviderKind, ProviderConfig)` returns a boxed client. Built-in kinds:
- `anthropic` — `https://api.anthropic.com`
- `openai` — `https://api.openai.com`
- `gemini` — `https://generativelanguage.googleapis.com`
- `ollama` — `http://localhost:11434` (no API key required)

## LLM Providers API

Sprint 0 delivers CRUD + live model discovery for LLM providers.

| Method | Route | Purpose |
|--------|-------|---------|
| GET    | `/v1/llm-providers`             | List all providers (never returns ciphertext; `hasKey` derived server-side) |
| PATCH  | `/v1/llm-providers/:id`         | Update `apiKey` (stored encrypted, masked for display) and/or `baseUrl` |
| POST   | `/v1/llm-providers/:id/test`    | Live connection test; persists `connected` flag |
| GET    | `/v1/llm-providers/:id/models`  | Live model list from provider (cached 5 min) |

Empty-string `apiKey` clears the stored key. Setting/changing keys invalidates the model cache for that provider.

## Database

### Supported Databases

- **SQLite** - Development (default)
- **PostgreSQL** - Production recommended

### Connection String Examples

```
# SQLite (file-based)
DATABASE_URL=sqlite://hive.db

# SQLite (in-memory)
DATABASE_URL=sqlite://:memory:

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/hive
```

## API Documentation

OpenAPI documentation is available at:
- `http://localhost:3000/swagger-ui/` (if Swagger UI is configured)
- `openapi/openapi.json` - Raw OpenAPI spec

### Common Endpoints

Refer to individual handler files in `hive-api/src/` for endpoint definitions.

## Deployment

### Docker Build (if Dockerfile exists)

```bash
docker build -t hive-backend .
docker run -p 3000:3000 hive-backend
```

### Binary Distribution

```bash
cargo build --release
# Binary at: target/release/hive-api
```

### System Service (Linux)

Create a systemd service file and configure for your platform.

## Performance Optimization

- Async handlers throughout
- Connection pooling configured in SeaORM
- CORS middleware for efficient cross-origin handling
- Efficient database queries with SeaORM

## Security Considerations

- Input validation on all endpoints
- CORS restrictions (configure in `config/local.toml`)
- Sensitive data handling in environment variables
- Use HTTPS in production

## Troubleshooting

### Database Connection Issues

```bash
# Check connection string
echo $DATABASE_URL

# Verify database exists and is accessible
sqlite3 hive.db ".tables"
```

### Build Issues

```bash
# Clean build
cargo clean
cargo build

# Check for outdated dependencies
cargo update
```

### Runtime Errors

```bash
# Enable debug logging
RUST_LOG=debug cargo run
```

## Contributing

When contributing:
1. Follow Rust conventions and idioms
2. Run `cargo fmt` before committing
3. Ensure `cargo clippy` passes
4. Write tests for new functionality
5. Update documentation

## Code Style

- Format code with: `cargo fmt`
- Lint code with: `cargo clippy`
- Write idiomatic Rust
- Use meaningful variable names

## Testing

```bash
# Run all tests
cargo test

# Run tests for specific crate
cargo test -p hive-api

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_name
```

## Dependencies

Key workspace dependencies:

- **tokio** - Async runtime
- **axum** - Web framework
- **sea-orm** - ORM
- **sqlx** - SQL toolkit
- **serde** - Serialization
- **tower** - Middleware framework
- **tower-http** - HTTP utilities

## License

MIT

## Support

For issues or questions:
1. Check existing documentation
2. Review similar code patterns in the codebase
3. Open an issue with detailed information