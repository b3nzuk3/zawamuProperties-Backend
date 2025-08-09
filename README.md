# Zawamu Properties Backend

This is the backend API for Zawamu Properties, built with Node.js, Express, and MongoDB.

## Features

- User authentication (register, login, JWT)
- CRUD for properties/listings
- Blog management
- Contact form handling
- Admin dashboard endpoints
- Analytics endpoints

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- MongoDB database (Atlas or local)

### Setup

1. Clone the repository or copy the `server` folder to your backend host.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your MongoDB URI and JWT secret:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```
4. Start the server:
   ```bash
   npm run dev
   # or for production
   npm start
   ```

The server will run on the port specified in `.env` (default: 5000).

## API Endpoints

- `POST   /api/auth/register` — Register a new user
- `POST   /api/auth/login` — Login and receive JWT
- `GET    /api/auth/profile` — Get user profile (JWT required)
- `GET    /api/properties` — List all properties
- `POST   /api/properties` — Create a property
- `GET    /api/properties/:id` — Get property by ID
- `PUT    /api/properties/:id` — Update property
- `DELETE /api/properties/:id` — Delete property
- `GET    /api/blog` — List all blog posts
- `POST   /api/blog` — Create a blog post
- `GET    /api/blog/:id` — Get blog post by ID
- `PUT    /api/blog/:id` — Update blog post
- `DELETE /api/blog/:id` — Delete blog post
- `POST   /api/contact` — Submit contact form
- `GET    /api/admin/stats` — Admin dashboard stats
- `GET    /api/analytics` — Analytics data

## Deployment

- Deploy to [Render](https://render.com/), Heroku, or any Node.js host.
- Set environment variables in your host dashboard.

## License

MIT
