# CFGPT Clone Me

## Overview

CFGPT Clone Me is an AI voice receptionist platform built as a cross-platform mobile/web application using Expo (React Native) with an Express.js backend. The app enables users to create AI voice clones, manage SIP-based inbound call handling, and interact with AI through chat. It replaces Twilio with custom SIP integration (e.g., Switchboard Free) and supports multiple voice cloning providers (Resemble.AI, EL, custom CFGPT).

The platform includes user authentication with role-based access (super_admin, admin, user), a credit/free-trial messaging system, multi-provider AI chat with streaming responses, SIP configuration for inbound call reception, and an admin panel for managing users and AI providers.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (Expo / React Native)

- **Framework**: Expo SDK 54 with expo-router for file-based routing
- **Navigation**: Tab-based layout with 7 tabs (Dashboard, AI Studio, Numbers, Voice, Earn, Phone, Admin) plus a chat detail screen
- **State Management**: React Context for auth (`AuthContext`), React Query (`@tanstack/react-query`) for server state
- **Local Storage**: AsyncStorage for client-side data persistence (users, conversations, voice samples, SIP config). The app stores significant data client-side rather than relying entirely on the server database.
- **Styling**: Dark theme throughout, custom color constants in `constants/colors.ts`, Inter font family via `@expo-google-fonts/inter`
- **Key Libraries**: react-native-gesture-handler, react-native-reanimated, react-native-keyboard-controller, expo-linear-gradient, expo-haptics

### Backend (Express.js)

- **Server**: Express 5 running on the same deployment, serves both API routes and static web builds
- **Entry Point**: `server/index.ts` — sets up CORS (handles Replit domains and localhost), registers routes
- **Routes**: `server/routes.ts` — handles `/api/chat` (streaming SSE), SIP management endpoints, receptionist config, AI provider management
- **AI Providers**: `server/ai-providers.ts` — supports multiple AI backends (Replit built-in, OpenAI direct, custom endpoints). Uses OpenAI SDK with configurable base URLs. Default model is `gpt-5-nano` via Replit AI.
- **SIP Service**: `server/sip-service.ts` — custom SIP protocol implementation using raw TCP/UDP sockets (`net`, `dgram`). Handles SIP REGISTER, INVITE, and digest authentication. Designed for inbound calls only.
- **Call Control**: `server/call-control.ts` — AI voice call answering system. When a call comes in via webhook, it generates AI responses, converts to TTS audio, and returns TwiML/JSON instructions to the telephony provider to answer the call with voice. Supports multi-turn conversations with speech recognition (Gather) and ongoing AI dialogue.
- **Virtual Numbers**: `server/virtual-numbers.ts` — Users register their own phone numbers with SIP credentials, AI agent configuration, TTS voice selection, and optional voice sample ID. No hardcoded defaults — each user sets up their own AI receptionist.
- **Voice Storage**: `server/voice-storage.ts` — Server-side voice sample upload and storage (in-memory). Users can upload voice recordings via API, which are stored with metadata and served via streaming endpoints. Supports activate/deactivate and deletion.
- **Web Phone**: `server/web-phone.ts` — Multi-user SIP softphone manager. Each user gets an isolated SIP session that registers with any SIP provider (Switchboard Free, etc.). When calls come in via SIP INVITE, auto-answers with AI-generated voice response. Tracks call history per user with AI response logs.
- **Storage Layer**: `server/storage.ts` — in-memory storage (`MemStorage`) for users, with an `IStorage` interface ready for database backing

### Call Control Webhook System

The webhook at `/api/webhook/switchboard` actively answers calls with AI voice:
- **Webhook URL**: `https://cfgpt.org/api/webhook/switchboard` (GET or POST)
- **Response Formats**: TwiML XML (default/auto), JSON (`?format=json`), plain text (`?format=text`)
- **Call Flow**: Webhook → AI generates greeting → TTS converts to audio → Returns TwiML with `<Play>` audio URL + `<Gather>` for speech input → Caller speaks → Gather callback → AI responds → Loop continues
- **Endpoints**:
  - `/api/webhook/switchboard` — Main webhook (answers call with voice)
  - `/api/webhook/switchboard/call/{callId}/gather` — Conversation continuation (POST, receives speech)
  - `/api/webhook/switchboard/call/{callId}/audio/{turn}` — Audio for each conversation turn
  - `/api/webhook/switchboard/call/{callId}/status` — Call status callback
  - `/api/webhook/switchboard/call/{callId}/summary` — Call transcript/summary
  - `/api/webhook/switchboard/health` — System health and setup instructions
  - `/api/webhook/switchboard/tts` — Standalone TTS endpoint

### Web Phone API (Zoiper-style SIP Softphone)

The web phone allows users to connect their SIP credentials and have AI answer calls:
- **Architecture**: Per-user SIP sessions managed by `server/web-phone.ts`. Each user gets an isolated `SipService` instance.
- **Auto-Answer**: When a SIP INVITE arrives, the AI twin generates a greeting and responds. Bypasses provider IVR by answering before it activates.
- **UI**: Phone tab (`app/(tabs)/config.tsx`) with sub-tabs: Connect, Calls, AI Twin, Logs
- **SIP Presets**: Switchboard Free, Sipgate, VoIP.ms, Custom
- **API Endpoints**:
  - `POST /api/web-phone/connect` — Connect SIP phone with credentials + AI config
  - `POST /api/web-phone/disconnect` — Disconnect and unregister
  - `GET /api/web-phone/status?userId=X` — Get connection status, call stats, uptime
  - `GET /api/web-phone/call-log?userId=X` — Get call history with AI responses
  - `GET /api/web-phone/logs?userId=X` — Get SIP protocol logs
  - `PUT /api/web-phone/settings` — Update AI twin settings (greeting, voice, system prompt)
  - `DELETE /api/web-phone/call-log?userId=X` — Clear call history
  - `GET /api/web-phone/sessions` — Admin: list all active phone sessions

### EL Voice Cloning & Agents

- **Voice Cloning**: `server/elevenlabs.ts` — EL API integration for instant voice cloning, voice listing, deletion, and text-to-speech. Uses `ELEVENLABS_API_KEY` env var.
  - `POST /api/elevenlabs/clone` — Clone voice from audio (JSON with audioBase64 or raw binary)
  - `GET /api/elevenlabs/voices` — List all cloned voices
  - `DELETE /api/elevenlabs/voices/:voiceId` — Delete a cloned voice
  - `POST /api/elevenlabs/tts` — Text-to-speech with a specific voice
  - Voice cloning costs 5 credits per clone

- **Agent Widgets**: `server/elevenlabs-agents.ts` — EL Conversational AI agent widget system with call billing.
  - `POST /api/agents/create` — Create agent widget with cloned voice
  - `GET /api/agents?userId=X` — List user's agent widgets
  - `DELETE /api/agents/:widgetId?userId=X` — Delete an agent widget
  - `POST /api/agents/call/start` — Start a call session (10 credits connection fee)
  - `POST /api/agents/call/end` — End a call session (1 credit per 10-min block after first 10 min)
  - `GET /api/agents/call/active?widgetId=X` — Check for active call session
  - Call billing: 10 credits initial connection + 1 credit per 10-minute block beyond first 10 min, max 60 min

### PayPal Credits

- **PayPal Integration**: `server/paypal.ts` — PayPal checkout for purchasing credits
  - Two packages: Starter Pack (£10/600 credits), Pro Pack (£20/1500 credits)
  - PayPal buy section integrated into Earn tab (`app/(tabs)/credits.tsx`)

### Replit Integration Modules

Located in `server/replit_integrations/`, these are pre-built modules:
- **chat/**: Conversation and message CRUD with database-backed storage via Drizzle
- **audio/**: Audio processing (speech-to-text, text-to-speech, voice chat), format detection, ffmpeg conversion
- **image/**: Image generation via `gpt-image-1` model
- **batch/**: Batch processing utilities with rate limiting (`p-limit`) and retries (`p-retry`)

Client-side audio utilities exist in `.replit_integration_files/client/` for web-based voice recording and playback using AudioWorklet.

### Database

- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema**: `shared/schema.ts` defines a `users` table (id, username, password). Additional models in `shared/models/chat.ts` define `conversations` and `messages` tables.
- **Config**: `drizzle.config.ts` reads `DATABASE_URL` environment variable
- **Migrations**: Output to `./migrations` directory
- **Push command**: `npm run db:push` to sync schema

Note: The primary app currently uses AsyncStorage for most data (conversations, voice samples, SIP config, user accounts). The Drizzle/Postgres schema is used by the Replit integration modules (chat storage) and is available for migration of other data.

### Authentication

- **Client-side auth**: Fully implemented in AsyncStorage via `lib/storage-helpers.ts` and `contexts/AuthContext.tsx`
- **Roles**: `super_admin`, `admin`, `user` — with a default super admin account created on first run
- **Credits system**: Users have free trial messages and purchasable credits
- **No server-side auth middleware**: Authentication is handled client-side; API routes don't currently verify sessions

### Build & Deployment

- **Development**: Two processes — `expo:dev` for the Expo dev server, `server:dev` for the Express backend (tsx)
- **Production build**: `expo:static:build` creates a static web bundle, `server:build` uses esbuild to bundle the server, `server:prod` runs the production server
- **Environment**: Relies on Replit environment variables (`REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`, `DATABASE_URL`, `EXPO_PUBLIC_DOMAIN`)

## External Dependencies

### AI Services
- **Replit AI Integration**: Primary AI provider, accessed via OpenAI-compatible SDK with `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` environment variables
- **OpenAI API**: Optional direct integration, configurable through admin panel
- **Custom AI endpoints**: Configurable through admin panel for any OpenAI-compatible API

### Database
- **PostgreSQL**: Required via `DATABASE_URL` environment variable, used with Drizzle ORM

### SIP/Telephony
- **Custom SIP providers**: Built-in SIP client implementation supporting any SIP provider (designed for Switchboard Free). No Twilio dependency. Uses raw socket connections for SIP protocol.

### Voice Cloning Providers (Planned/Configured)
- **Resemble.AI**: Voice cloning integration (API key configurable)
- **EL**: Voice cloning integration (API key configurable)
- **CFGPT Custom**: In-house voice cloning option

### Key npm Packages
- `openai` — OpenAI SDK for AI completions and audio
- `pg` — PostgreSQL client
- `drizzle-orm` / `drizzle-kit` — Database ORM and migrations
- `express` — HTTP server
- `expo` — Cross-platform mobile/web framework
- `@tanstack/react-query` — Server state management
- `@react-native-async-storage/async-storage` — Local data persistence
- `p-limit` / `p-retry` — Rate limiting and retry logic for batch operations