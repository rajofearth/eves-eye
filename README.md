# Eve's Eye

Eve's Eye is a real-time, AI-powered security monitoring and threat detection system. Built with Next.js 16, it leverages the **Cerebras Cloud SDK** (running Gemma 4 31B) for high-speed object detection and threat analysis.

## Demo

<video src="https://github.com/user-attachments/assets/60b4b2b5-82c4-4d5f-9245-a7620b038416" controls width="100%"></video>

## Key Features

- **Live Multi-Camera Monitoring**: Supports active browser webcams and simulated video feeds in a responsive grid.
- **Real-time Threat Detection**: Uses Gemma 4 31B via Cerebras for rapid object identification and threat assessment.
- **Auto-Promotion**: Automatically highlights feeds that detect critical security threats.
- **Local SQLite Database**: Fast, reliable logging of detections, threats, and video analysis jobs using Better SQLite3 (with WAL mode).

## Getting Started

First, install the dependencies using your preferred package manager (pnpm is recommended):

```bash
pnpm install
```
Copy the `.env.example` file to `.env` and update the environment variables as needed.
```bash
cp .env.example .env
```
Then, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to view the surveillance dashboard.
