# SmartTravello - AI-Powered Travel Assistant

SmartTravello is a full-stack travel planning app for creating personalized trips, budgets, routes, itineraries, and travel recommendations. The backend AI features use Groq through an OpenAI-compatible API client, while the frontend provides a Next.js dashboard and travel chatbot.

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-18-green?style=for-the-badge&logo=node.js)
![Prisma](https://img.shields.io/badge/Prisma-6.0-2D3748?style=for-the-badge&logo=prisma)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?style=for-the-badge&logo=tailwind-css)

## Features

- AI-powered trip creation from a natural-language prompt
- Daily itinerary generation with places of interest, weather, and budgets
- Flight, train, hotel, event, news, and route agents
- Authenticated dashboard for managing trips
- Groq-powered travel assistant chatbot
- Automated travel recommendation emails
- Dark/light mode and responsive UI

## Prerequisites

- Node.js 18+
- npm
- MongoDB database
- Groq API key
- Optional provider keys for SerpAPI, Google Maps, Geoapify, Google OAuth, and email

## Quick Start

1. **Install dependencies**

   ```bash
   cd frontend
   npm install

   cd ../backend
   npm install
   ```

2. **Create environment files**

   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local
   ```

   `backend/.env` is where your real `GROQ_API_KEY` belongs. Keep real secrets out of `.env.example`.

3. **Configure backend environment**

   ```env
   PORT=5000
   DATABASE_URL="mongodb://localhost:27017/smarttravello"
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_MODEL=llama-3.3-70b-versatile
   SERPAPI_KEY=your_serpapi_key_here
   GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
   GEOAPIFY_API_KEY=your_geoapify_api_key_here
   EMAIL_USER=your_email@gmail.com
   EMAIL_PASS=your_email_app_password
   JWT_SECRET=replace_with_a_long_random_secret
   JWT_EXPIRES_IN=1d
   ```

4. **Configure frontend environment**

   ```env
   NEXT_PUBLIC_API_URL=http://localhost:5000/api
   GOOGLE_CLIENT_ID=your_google_client_id_here
   GOOGLE_CLIENT_SECRET=your_google_client_secret_here
   NEXTAUTH_SECRET=replace_with_a_long_random_secret
   ```

5. **Set up the database**

   ```bash
   cd backend
   npx prisma generate
   npx prisma db push
   ```

6. **Start the app**

   ```bash
   # Terminal 1
   cd backend
   npm run dev

   # Terminal 2
   cd frontend
   npm run dev
   ```

   Frontend: http://localhost:3000  
   Backend API: http://localhost:5000/api

## Project Structure

```text
SmartTravello/
├── frontend/                 # Next.js application
│   ├── src/app/              # App Router pages and API routes
│   ├── src/components/       # React components
│   └── public/               # Static assets
├── backend/                  # Express API
│   ├── src/agents/           # Travel planning agents
│   ├── src/controllers/      # Route controllers
│   ├── src/routes/           # API routes
│   ├── src/services/         # Email, cron, and recommendation services
│   ├── src/config/           # Database and Groq client config
│   └── prisma/               # Prisma schema and migrations
├── database/                 # Shared Prisma schema copy
└── docker/                   # Docker setup
```

## Environment Notes

- `backend/.env` and `frontend/.env.local` are local-only secret files.
- `backend/.env.example` and `frontend/.env.example` are safe templates.
- The dashboard chatbot calls the backend `/api/chat` endpoint so the Groq key is never exposed in browser code.
