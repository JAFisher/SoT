# Twitter Clone Flows

This folder contains the `.flow` files for the Twitter clone application.

## .env Setup

To run the application with an administrative user, you must create a `.env` file in the service root (e.g., `src/twitter/server/.env`).

### Required Variables
- `ADMIN_USERNAME`: The username for the seeded admin account.
- `ADMIN_PASSWORD`: The password for the seeded admin account.
- `JWT_SECRET`: (Optional) Secret key for JWT signing.
- `JWT_REFRESH_SECRET`: (Optional) Secret key for JWT refresh tokens.

> [!IMPORTANT]
> Do NOT include a `$` prefix in the variable names within the `.env` file.
> Correct: `ADMIN_USERNAME=admin`
> Incorrect: `$ADMIN_USERNAME=admin`

## Database Docker Setup

The database layer can be containerized for easy deployment and isolation.

1. **Build the Docker Image**:
   ```bash
   cd src/twitter/db
   npm run build_docker
   ```
   This command builds a Docker image named `twitter-db` using the generated `Dockerfile` in the `db` service folder.

2. **Start the Database Container**:
   ```bash
   npm run start_docker
   ```
   This runs the `twitter-db` container and maps its internal port 5432 to your host's port 5432.

---

## Architecture Overview

The application is built using modular flow files that are compiled into TypeScript.

### Flows
- **[db.flow](db.flow)**: Handles all database interactions, schema initialization, and admin seeding logic.
- **[auth.flow](auth.flow)**: Manages server-side authentication, including registration, login, and JWT token generation.
- **[authfe.flow](authfe.flow)**: Client-side authentication logic for the frontend.
- **[server.flow](server.flow)**: The main HTTP server entry point, defining all API routes and integrating the `Auth` and `Database` flows.
- **[frontend.flow](frontend.flow)**: The primary frontend application logic, including the dashboard, profile, and social views.
- **[admin.flow](admin.flow)**: Specific logic for the administrative dashboard, including message moderation, "Mark as Safe" archiving, and cascading deletions.
- **[feeds.flow](feeds.flow)**: Logic for rendering and managing tweet feeds.
- **[messages.flow](messages.flow)**: Logic for the messaging system.

## Build and Start

1. **Build all flows**:
   ```bash
   npm run build
   ```
2. **Start the backend server**:
   ```bash
   cd src/twitter/server
   npm run start
   ```
3. **Start the frontend**:
   ```bash
   cd src/twitter/frontend
   npm run start
   ```

## Admin & Moderation

The application includes a built-in moderation system.

1. **Accessing the Dashboard**: 
   Log in with the credentials defined in your `.env` file and navigate to `http://localhost:3000/admin.html`.

2. **Moderation Features**:
   - **Reports List**: View and manage all reported tweets, grouped by message ID.
   - **Mark as Safe**: Archive a reported tweet if it's deemed appropriate. This hides the tweet from the dashboard for all associated reports.
   - **Delete & Cascade**: Permanently remove a tweet, all its replies, retweets, and associated images from the server.
