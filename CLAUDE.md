Project Brief: Career Coach — Project Structure & Tech Stack
Goal
Scaffold a Dockerized career coaching app with a FastAPI backend, simple chat UI, and multi-agent support via an OpenAI-compatible LLM API. No frontend framework — everything served from FastAPI.

Tech Stack
| Layer                 | Choice                                              |
|----------------------|-----------------------------------------------------|
| Language             | Python 3.11                                         |
| Backend              | FastAPI                                             |
| LLM                  | OpenAI-compatible API (OPENAI_BASE_URL + LLM_MODEL) |
| Containerization     | Docker + Docker Compose                             |
| Frontend             | Vanilla HTML/CSS/JS (served as static files)        |
| File Output          | Host filesystem via Docker volume mount             |
| Session Storage      | In-memory dict (keyed by session ID)                |
| Dependency Management| uv                                                  |

Directory Structure to Scaffold
career-coach/
├── docker-compose.yml
├── Dockerfile
├── .env                         # OPENAI_BASE_URL, LLM_MODEL
├── .env.example
├── .gitignore
├── README.md
├── pyproject.toml               # uv-managed deps
│
├── app/
│   ├── main.py                  # FastAPI app entry point
│   ├── config.py                # Env vars, constants
│   ├── models.py                # Pydantic request/response schemas
│   ├── session.py               # In-memory session/history management
│   │
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── base.py              # Shared call_agent() function
│   │   ├── agent1_intake.py     # System prompt + any agent-specific logic
│   │   ├── agent2_resume.py
│   │   ├── agent3_interview.py
│   │   └── agent4_validator.py
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── chat.py              # POST /chat/{agent_id}
│   │   └── files.py             # POST /files/save, GET /files/list
│   │
│   └── static/
│       └── index.html           # Entire UI in one file
│
└── outputs/                     # Mounted to host via Docker volume

Key Implementation Notes
base.py — one shared function that all agents call:
pythoncall_agent(system_prompt: str, history: list, user_message: str) -> str
Agents just pass their system prompt in. No other differences at the API call level.
session.py — simple dict, no database:
python# { session_id: { "agent_id": str, "history": [...] } }
Sessions reset on container restart — that's fine for a personal project.
/chat/{agent_id} — accepts { session_id, message }, returns { response, session_id }. Agent ID maps to the correct system prompt.
/files/save — accepts { filename, content }, writes to /outputs/ inside the container (mounted to host).
index.html — single file, no build step. Agent switcher (4 buttons), chat window, message input, save-to-file button on any response.
Docker volume in docker-compose.yml:
yamlvolumes:
  - ./outputs:/app/outputs