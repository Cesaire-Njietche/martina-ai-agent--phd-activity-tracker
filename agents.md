# PhD Research Tracker — Agent Instructions

## Project
Passive research activity tracker for PhD students.
Captures browser reading, VSCode coding, and desktop app usage.
Enriches paper metadata, classifies by domain, generates weekly
supervisor reports.

## Stack
- browser-ext/     Plasmo (React, TypeScript, MV3)
- vscode-ext/      VSCode Extension API (TypeScript)
- daemon/          FastAPI + Python 3.11, port 5699
- desktop-watcher/ Python, ActivityWatch bridge
- dashboard/       Next.js 14 App Router
- Database:        Supabase (PostgreSQL + JSONB)
- AI:              Anthropic API (Haiku for classify, Sonnet for report)
- Enrichment:      Semantic Scholar API (free, no key needed)

## My domains (use these in classifier prompts)
- qec: surface code, stabilizer, fault tolerance, syndrome,
       logical observable, qubit, error correction, threshold
- ai: MLP, neural network, CNN, GNN, transformers, RL
- cybersecurity: adversarial attacks, syndrome poisoning, worse-case physical error injection

## Rules agents must follow
- Never ask me to write code. Write it yourself.
- Always write tests alongside new code.
- After writing code, run it to verify it works.
- If a test fails, fix it before reporting back to me.
- Keep all API keys in .env — never hardcode them.
- When done with a task, print a 3-line summary: what was built,
  how to test it, what the next step is.

## Acceptance pattern
When I say "build X", the task is complete when:
1. The code exists and runs without errors
2. At least one test passes that verifies the core behaviour
3. I can manually verify it in 60 seconds or less