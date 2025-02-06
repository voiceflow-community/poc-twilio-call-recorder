# Voiceflow Call Recorder and Audio PII Redaction

A real-time call recording and transcription system built with Voiceflow Twilio voice integration and Next.js. This application automatically records incoming calls, transcribes them, and provides a dashboard to manage and review call recordings and transcripts.

## Features

- 🎥 Automatic call recording for incoming calls
- 🔊 Dual-channel recording support
- 📝 Optional real-time transcription with PII redaction (Twilio Voice Intelligence)
  - Enable by setting `PII_REDACTION_ENABLED=true`
  - When enabled: Uses Twilio Voice Intelligence for transcription and PII redaction
  - When disabled: Uses standard Twilio call recording without transcription
- 💻 Web-based dashboard for call management
- 🔄 Real-time updates via WebSocket

## Prerequisites

- [Node.js](https://nodejs.org/) (v20)
- A Twilio account with:
  - Account SID
  - Auth Token
  - Voice Intelligence Service SID

## Setup

1. Clone the repository:
```bash
git clone [repository-url]
cd poc-twilio-call-recorder
```

2. Install dependencies:
```bash
cd dashboard
npm install
```

3. Configure environment variables:
   - Copy `dashboard/.env.template` to `dashboard/.env`
   - Fill in your Twilio credentials:
     - `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
     - `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token
     - `TWILIO_SERVICE_SID`: Your Twilio Voice Intelligence Service SID
     - `PII_REDACTION_ENABLED`: Set to 'true' to enable PII redaction and transcription
   - Update the `PUBLIC_URL` to your public-facing URL (e.g., ngrok URL)
   - Set `NEXT_PUBLIC_WS_URL` for WebSocket connections (default: ws://localhost:3902)
   - Configure port if needed:
     - `PORT`: Server port (default: 3902)

## Running the Application

### Development Mode

Start both the Next.js frontend and API server in development mode:
```bash
cd dashboard
npm run dev
```

The application will be available at:
- Dashboard: http://localhost:3000
- API/WebSocket Server: http://localhost:3902

### Production Mode

Build and start the application in production mode:
```bash
cd dashboard
npm run build
npm run start
```

## Running with Docker Compose

1. Make sure you have Docker and Docker Compose installed

2. Configure environment variables:
   - Copy `dashboard/.env.template` to `dashboard/.env` for application configuration
   - Copy `dashboard/.env.template` to `.env` in the project root for Docker Compose
   - Configure both files with the same values as described in the Setup section
   - The docker-compose.yml will use both files automatically

3. Start the services from the project root:
```bash
docker compose up -d
```

4. View logs (optional):
```bash
docker compose logs -f
```

5. Stop the services:
```bash
docker compose down
```

The application will be available at:
- Dashboard: http://localhost:3000
- API/WebSocket Server: http://localhost:3902

Note: The Docker setup includes hot-reloading for development and proper production configuration.

## Twilio Configuration

1. Set up your Twilio phone number
2. Configure the webhook URL in your Twilio console:
   - Voice Configuration -> A call comes in
   - Replace `https://runtime-api.voiceflow.com` with `[YOUR_PUBLIC_URL]`
   - Add the piiRedaction parameter according to your needs:
     - For PII redaction: `[YOUR_PUBLIC_URL]/v1/twilio/webhooks/projectID/answer?authorization=VF.DM.XXX&piiRedaction=true`
     - Without PII redaction: `[YOUR_PUBLIC_URL]/v1/twilio/webhooks/projectID/answer?authorization=VF.DM.XXX&piiRedaction=false`
     To use the piiRedaction parameter, you need to set the `TWILIO_SERVICE_SID` environment variable to your Voice Intelligence Service SID from Twilio.
   - Method: GET

## Architecture

The application consists of two main components:

1. **Express Server** (Port 3902)
   - Handles Twilio webhooks
   - Manages call recording
   - Processes transcriptions
   - WebSocket server for real-time updates
   - REST API endpoints

2. **Next.js Dashboard** (Port 3000)
   - User interface for call management
   - Real-time call updates via WebSocket
   - Search and filtering capabilities
   - Call record deletion

## Development

The project uses:
- Node.js as the runtime
- TypeScript for type safety
- Next.js for the frontend
- Express for the backend API
- WebSocket for real-time communication
- SQLite for data storage

## Available Scripts

- `npm run dev`: Start both frontend and backend in development mode
- `npm run build`: Build both frontend and backend for production
- `npm run start`: Run the application in production mode
- `npm run dev:next`: Run only the Next.js frontend in development
- `npm run dev:server`: Run only the API server in development
- `npm run build:next`: Build only the Next.js frontend
- `npm run build:server`: Build only the API server

## Security Considerations

- Never commit `.env` to version control
- Keep your Twilio credentials secure
- Use HTTPS in production
- Implement proper authentication for the dashboard in production

## License

ISC

## Author

Nicolas Arcay Bermejo | Voiceflow
