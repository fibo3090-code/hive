# Hive Frontend

A modern, feature-rich React TypeScript application built with Vite and Bun, providing a comprehensive dashboard and management interface for project coordination, agent orchestration, and real-time monitoring.

## Overview

Hive Frontend is a powerful web application designed for managing complex project workflows, coordinating AI agents, tracking budgets, and monitoring system performance in real-time.

## Features

- **Dashboard** - Real-time project overview and key metrics
- **Agent Forge** - Create and manage AI agent blueprints
- **Chat Central** - Centralized communication hub
- **Project Management** - Track and manage projects with detailed metrics
- **Module Management** - Organize and view module dependencies
- **Code Versioning** - Track code changes and versions
- **Session History** - Review past sessions and their outcomes
- **Budget Tracking** - Monitor and forecast costs
- **Real-time Updates** - Live data synchronization via Server-Sent Events
- **Command Palette** - Quick access to features and commands
- **Insights & Analytics** - Data-driven decision making

## Tech Stack

- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite
- **Package Manager**: Bun
- **Styling**: Tailwind CSS
- **UI Components**: Custom component library
- **Real-time**: Server-Sent Events (SSE)
- **Testing**: Vitest + Playwright
- **Linting**: ESLint

## Prerequisites

- Node.js 18+ (or Bun 1.0+)
- Bun package manager (recommended)

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd hive/frontend
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your API endpoint and configuration.

## Development

### Start Development Server

```bash
bun run dev
```

The application will be available at `http://localhost:5173`

### Build for Production

```bash
bun run build
```

### Preview Production Build

```bash
bun run preview
```

### Linting & Code Quality

```bash
bun run lint          # Run ESLint
bun run lint:fix      # Fix ESLint issues
```

### Testing

```bash
bun run test          # Run unit tests
bun run test:ui       # Run tests with UI
bun run test:coverage # Generate coverage report
```

### E2E Testing

```bash
bun run test:e2e      # Run Playwright tests
bun run test:e2e:ui   # Run E2E tests with UI
```

## Project Structure

```
src/
├── api/                 # API client and queries
│   ├── client.ts
│   ├── generated.ts     # Auto-generated API types
│   └── queries/
├── components/          # React components
│   ├── layout/          # Layout components (AppLayout, Sidebar, TopBar)
│   ├── modals/          # Modal dialogs
│   ├── shared/          # Shared UI components
│   └── ui/              # Reusable UI elements
├── context/             # React context providers
├── hooks/               # Custom React hooks
├── lib/                 # Utility functions
├── pages/               # Page components
├── realtime/            # Server-Sent Events integration
├── test/                # Test utilities and fixtures
└── types/               # TypeScript type definitions
```

## Pages

- **Dashboard** - Main overview and metrics
- **Projects** - Project listing and management
- **Modules** - Module catalog and dependencies
- **AgentForge** - AI agent creation and configuration
- **ChatCentral** - Communication interface
- **SessionHistory** - Historical session data
- **Insights** - Analytics and reporting
- **Settings** - Application configuration
- **CodeVersioning** - Version control interface
- **SpecPlan** - Specification and planning
- **HiveGraph** - Visual system representation
- **Onboarding** - Initial setup workflow

## API Integration

The frontend communicates with the backend API. API calls are managed through:

- **Client**: `src/api/client.ts` - HTTP client configuration
- **Queries**: `src/api/queries/` - React hooks for data fetching and caching
- **Types**: `src/api/generated.ts` - Auto-generated TypeScript types from OpenAPI spec

## Real-time Updates

Real-time data is synchronized using Server-Sent Events (SSE) configured in:
- `src/realtime/useSse.ts`

## Environment Variables

Required environment variables (see `.env.example`):

```
VITE_API_URL=http://localhost:3000  # Backend API URL
VITE_API_WS_URL=ws://localhost:3000 # WebSocket URL (if applicable)
```

## Building & Deployment

### Development Build
```bash
bun run build
```

### Production Build
```bash
bun run build
```

The built files are in the `dist/` directory and ready for deployment.

## Best Practices

- Use TypeScript for all new code
- Follow the existing component structure
- Keep components focused and reusable
- Use custom hooks for shared logic
- Write tests for critical features
- Follow ESLint and Prettier configurations

## Troubleshooting

### Port already in use
```bash
# Change the default port
bun run dev -- --port 5174
```

### Build errors
```bash
bun run clean
bun install
bun run build
```

### API connection issues
- Check that `VITE_API_URL` is correctly configured
- Verify the backend is running
- Check browser console for CORS errors

## Contributing

When contributing:
1. Create a feature branch
2. Make your changes
3. Run tests and linting
4. Commit with clear messages
5. Submit a pull request

## License

MIT
