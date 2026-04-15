# Career Coach

A Dockerized career coaching app with a FastAPI backend, simple chat UI, and multi-agent support via an OpenAI-compatible LLM API.

## Setup

1. Copy `.env.example` to `.env` and set your LLM endpoint and model:
   ```
   cp .env.example .env
   ```
   ```
   OPENAI_BASE_URL=https://your-endpoint
   LLM_MODEL=your-model-name
   ```

2. Build and run:
   ```
   docker compose up --build
   ```

3. Open `http://localhost:8000` in your browser.

## Agents

- **Agent 1 — Intake**: Initial career assessment and goal-setting
- **Agent 2 — Resume**: Resume review and improvement
- **Agent 3 — Interview**: Interview preparation and coaching
- **Agent 4 — Validator**: Validates and quality-checks outputs

## API Endpoints

- `GET /health` — Health check
- `POST /chat/{agent_id}` — Send a message to an agent
- `POST /files/save` — Save content to the outputs directory
- `GET /files/list` — List saved files
