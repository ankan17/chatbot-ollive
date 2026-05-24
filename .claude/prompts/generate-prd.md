You are a senior product architect.

I am building an assignment project for an AI infrastructure/platform engineering role.

Your task is to generate a clear, implementation-ready Product Requirements Document (PRD) with your brainstorming superpower for the following system:

PROJECT PROBLEM STATEMENT:
Build a lightweight inference logging and ingestion system for an LLM application.
1. Chatbot Application
Build a simple chatbot using any foundation model API.
Examples:
GPT-4.1
Claude Sonnet
Gemini
DeepSeek
Grok
any equivalent model
The chatbot should:
support multi-turn conversations
maintain short conversational context
expose a simple UI

2. Lightweight SDK / Wrapper
Create a lightweight SDK, middleware, or wrapper around your LLM calls that captures inference metadata.
Examples of metadata:
model
provider
latency
token usage
timestamps
request status/errors
conversation/session ID
input/output previews
The SDK should send logs to an ingestion endpoint in near real time. Implementation details are flexible.

3. Ingestion Pipeline
Build an ingestion service/API that:
receives logs from the SDK
validates/parses payloads
extracts useful metadata
stores processed data in a database

4. Database Storage
Store:
chat messages
inference logs
extracted metadata
We care about sensible schema design and practical tradeoffs.

Bonus 
You will be given a guaranteed interview if you are able to complete the following task.
Multi-provider support
Streaming Responses
Latency + Throughput + Errors dashboards
Docker Compose one-command setup
Event based architecture

Frontend
The UI allows following:
Cancel a conversation
List conversations
Resume a conversation

The system should include:

1. Multi-turn chatbot application using an LLM provider API
2. Lightweight SDK/wrapper around LLM calls
3. Ingestion API/service for inference logs
4. Database storage for chats and inference metadata
5. Production-grade frontend UI

The requirements document should:

* Remove ambiguity from the assignment
* Explicitly define assumptions
* Clearly define system boundaries
* Prioritize practical implementation over enterprise complexity

The output should contain:

1. Executive Summary
2. Goals and Non-Goals
3. Functional Requirements
4. Non-Functional Requirements
5. User Flows
6. API Contracts
7. Logging Schema
8. Database Schema
9. System Architecture
10. Frontend Requirements
11. Backend Requirements
12. SDK Requirements
13. Authentication
13. Ingestion Pipeline Requirements
14. Streaming Requirements
15. Error Handling Expectations
16. Scalability Assumptions
17. Security Assumptions
18. Deployment Requirements
19. Observability Requirements
20. Tradeoffs and Design Decisions
22. Acceptance Criteria

Constraints and preferences:

* Use TypeScript across the stack
* Prefer pragmatic/simple architecture
* Optimize for clarity and engineering quality
* Prefer PostgreSQL
* Include streaming responses via SSE
* Include provider abstraction for future multi-provider support
* Include Docker Compose setup
* Include dashboard metrics for latency/errors/token usage
* Avoid unnecessary microservices unless justified
* Ask questions for even the slightest ambiguity; Don't make assumptions

Important:

* Define exact payload examples where useful
* Explicitly document assumptions and tradeoffs
* Call out areas where simplifications were intentionally made
* Output should feel like a real engineering requirements document that can directly guide implementation
