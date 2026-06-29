# Docker Workflow for SmartTravello

This document explains how Docker is used in this project, from the basics to the complete execution flow. It is written for interview preparation, but it stays grounded in the current codebase.

## Current Docker Reality

SmartTravello currently uses Docker for one thing:

```text
MongoDB runs in Docker through docker/docker-compose.yml.
```

The backend and frontend are not containerized yet:

```text
docker/Dockerfile.backend   -> empty placeholder
docker/Dockerfile.frontend  -> empty placeholder
```

So the current local development flow is:

```text
Docker Compose starts MongoDB
  -> backend runs locally with Node.js
  -> frontend runs locally with Next.js
  -> backend connects to MongoDB at mongodb://localhost:27017/smarttravello
```

This is important in an interview. Do not claim the whole app is Dockerized today. The accurate answer is:

> This project currently uses Docker Compose to provide the MongoDB infrastructure. The Node.js backend and Next.js frontend still run locally. Dockerfiles exist for future backend/frontend containerization, but they are currently empty placeholders.

## Why Docker Is Used

Docker solves the local MongoDB setup problem.

Without Docker, every developer would need to install MongoDB directly on their machine, configure it, ensure it runs on port `27017`, and keep the version compatible with the project. With Docker, the project can start a MongoDB 7 container using one command:

```bash
docker compose -f docker/docker-compose.yml up -d
```

That command gives the backend a predictable database endpoint:

```text
mongodb://localhost:27017/smarttravello
```

### What Problem Docker Solves Here

The backend uses Prisma with MongoDB:

```prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}
```

The application needs MongoDB for users, trips, itinerary items, weather data, routes, events, budget items, and agent task logs. Docker provides that MongoDB dependency without requiring a manual database installation.

### Why This Is Better Than Running Everything Locally

Running MongoDB locally means:

- Install MongoDB manually.
- Keep the database service running.
- Avoid port conflicts.
- Handle operating-system-specific setup differences.
- Clean up database files manually when needed.

Running MongoDB with Docker means:

- MongoDB version is declared in code: `mongo:7`.
- The service can be started and stopped consistently.
- Data can be persisted in a named volume.
- The database can be recreated without reinstalling anything.

Analogy:

Running MongoDB locally is like installing a coffee machine permanently in every room. Docker is like bringing a ready-to-use coffee cart wherever the team needs it.

## Docker-Related Project Structure

Docker-related files are in:

```text
docker/
  docker-compose.yml
  Dockerfile.backend
  Dockerfile.frontend
```

Related environment/schema files:

```text
backend/.env
backend/.env.example
frontend/.env.local
frontend/.env.example
backend/prisma/schema.prisma
database/schema.prisma
```

The active Prisma schema is:

```text
backend/prisma/schema.prisma
```

There is also a copy at:

```text
database/schema.prisma
```

### File Purposes

| File | Current purpose |
| --- | --- |
| `docker/docker-compose.yml` | Starts a MongoDB 7 container and persists data in a Docker named volume. |
| `docker/Dockerfile.backend` | Empty placeholder. It does not currently build a backend image. |
| `docker/Dockerfile.frontend` | Empty placeholder. It does not currently build a frontend image. |
| `.dockerignore` | No project-level `.dockerignore` exists right now. |
| `backend/.env` | Runtime environment variables for the local backend process. |
| `frontend/.env.local` | Runtime/build environment variables for the local Next.js frontend. |
| `backend/prisma/schema.prisma` | Prisma schema that reads `DATABASE_URL`. |

### Which Files To Read First

Study in this order:

1. `docker/docker-compose.yml`
2. `backend/.env.example`
3. `backend/prisma/schema.prisma`
4. `backend/src/config/db.js`
5. `backend/index.js`
6. `docker/Dockerfile.backend`
7. `docker/Dockerfile.frontend`
8. `README.md` Docker/setup sections

Why this order works:

```text
Compose starts MongoDB
  -> backend .env tells Prisma where MongoDB is
  -> Prisma schema defines the database provider
  -> backend db config creates Prisma Client
  -> backend index starts Express
```

## Docker Compose File

Current file:

```yaml
version: '3.9'
services:
  mongodb:
    image: mongo:7
    container_name: smarttravello_mongodb
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db


volumes:
  mongodb_data:
```

### Line-by-Line Explanation

```yaml
version: '3.9'
```

This declares the Compose file format version. Newer Docker Compose versions do not rely heavily on this field, but it tells readers the file was written for Compose syntax around version `3.9`.

Internally, Docker Compose parses the YAML and interprets supported fields like `services`, `ports`, and `volumes`.

```yaml
services:
```

This starts the list of containers Compose should manage.

In this project, there is only one service: `mongodb`.

```yaml
mongodb:
```

This is the service name. Docker Compose uses this name as an internal DNS hostname on the Compose network.

If the backend were also inside Compose, it could connect to:

```text
mongodb://mongodb:27017/smarttravello
```

But because the backend currently runs on the host machine, it connects through the published host port:

```text
mongodb://localhost:27017/smarttravello
```

```yaml
image: mongo:7
```

This tells Docker to use the official MongoDB image, version 7.

What happens internally:

1. Docker checks whether `mongo:7` exists locally.
2. If not, Docker pulls it from Docker Hub.
3. Docker uses that image as the read-only template for the MongoDB container.

```yaml
container_name: smarttravello_mongodb
```

This gives the container a fixed name.

Without this, Compose would generate a name based on the project directory and service name. A fixed name makes commands easier:

```bash
docker logs smarttravello_mongodb
docker exec -it smarttravello_mongodb mongosh
```

```yaml
ports:
  - "27017:27017"
```

This maps a port from the host machine to the container.

Format:

```text
HOST_PORT:CONTAINER_PORT
```

In this project:

```text
localhost:27017 on your computer
  -> forwards to port 27017 inside the MongoDB container
```

That is why the local backend can use:

```env
DATABASE_URL="mongodb://localhost:27017/smarttravello"
```

```yaml
volumes:
  - mongodb_data:/data/db
```

This mounts a named Docker volume called `mongodb_data` into the MongoDB data directory inside the container.

MongoDB stores database files in:

```text
/data/db
```

The named volume makes that data survive container deletion.

```yaml
volumes:
  mongodb_data:
```

This declares the named volume.

Docker manages this volume outside the container lifecycle. If the MongoDB container is removed, the volume still exists unless you explicitly delete it.

## What Docker Compose Does In This Project

When you run:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Docker Compose does this:

```text
Read docker/docker-compose.yml
  -> find service mongodb
  -> check for image mongo:7
  -> pull mongo:7 if missing
  -> create a Compose network
  -> create named volume mongodb_data if missing
  -> create container smarttravello_mongodb
  -> mount mongodb_data at /data/db
  -> publish host port 27017 to container port 27017
  -> start MongoDB process inside the container
```

After that, the backend can connect to MongoDB.

## Backend Database Connection

Backend environment example:

```env
DATABASE_URL="mongodb://localhost:27017/smarttravello"
```

Prisma reads that through:

```prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}
```

The flow is:

```text
backend/.env
  -> dotenv loads environment variables
  -> Prisma reads DATABASE_URL
  -> Prisma Client connects to MongoDB
  -> MongoDB request reaches localhost:27017
  -> Docker forwards it to the MongoDB container
```

Important:

`localhost` means different things depending on where the backend runs.

### Backend Running Locally

Current project behavior:

```text
backend process runs on your host machine
DATABASE_URL=mongodb://localhost:27017/smarttravello
```

Here, `localhost` means your laptop. Docker publishes MongoDB to your laptop's port `27017`, so this works.

### Backend Running Inside Docker

Future Dockerized backend behavior:

```text
backend process runs inside a container
DATABASE_URL=mongodb://mongodb:27017/smarttravello
```

Inside a container, `localhost` means the backend container itself, not the MongoDB container. To reach MongoDB, the backend container should use the Compose service name `mongodb`.

Interview answer:

> When the backend runs on the host, it connects to `localhost:27017`. If the backend is containerized in the same Compose network, it must use `mongodb:27017`, because Compose service names become internal DNS names.

## Dockerfile Status

Current files:

```text
docker/Dockerfile.backend   -> empty
docker/Dockerfile.frontend  -> empty
```

Because they are empty, they do not currently define:

- `FROM`
- `WORKDIR`
- `COPY`
- `RUN`
- `EXPOSE`
- `CMD`
- `ENTRYPOINT`
- `ENV`
- `ARG`
- `USER`
- `VOLUME`

That means this command would not create a useful backend/frontend image today:

```bash
docker build -f docker/Dockerfile.backend -t smarttravello-backend .
```

Docker would have no base image, no files to copy, no dependencies to install, and no startup command.

## Dockerfile Instructions Explained For This Project

Even though the Dockerfiles are empty today, these are the instructions you would expect when the backend/frontend are Dockerized.

### FROM

Example:

```dockerfile
FROM node:20-alpine
```

What it does:

Uses an existing Node.js image as the starting point.

Why needed:

The backend and frontend need Node.js and npm.

What happens internally:

Docker checks whether `node:20-alpine` exists locally. If not, it pulls the image layers from Docker Hub. The new project image starts from those layers.

### WORKDIR

Example:

```dockerfile
WORKDIR /app
```

What it does:

Sets `/app` as the current directory inside the image.

Why needed:

Later commands like `COPY`, `RUN`, and `CMD` run relative to this directory.

What happens internally:

Docker creates the directory if it does not exist and stores that as image metadata.

### COPY

Example:

```dockerfile
COPY backend/package*.json ./
COPY backend/prisma ./prisma
COPY backend .
```

What it does:

Copies files from the build context into the image.

Why needed:

The container needs application code, package files, and Prisma schema.

What happens internally:

Docker reads files from the build context, adds them to a new image layer, and calculates a checksum for caching.

### RUN

Example:

```dockerfile
RUN npm ci
RUN npx prisma generate
```

What it does:

Executes commands during image build.

Why needed:

Installs dependencies and generates Prisma Client.

What happens internally:

Docker creates a temporary container from the previous layer, runs the command, captures filesystem changes, and saves them as a new layer.

### EXPOSE

Example:

```dockerfile
EXPOSE 5000
```

What it does:

Documents the port the app listens on inside the container.

Why needed:

The backend listens on port `5000`.

What happens internally:

This does not publish the port by itself. It adds metadata. You still need `docker run -p` or Compose `ports`.

### CMD

Example:

```dockerfile
CMD ["npm", "start"]
```

What it does:

Defines the default process that starts when a container is created from the image.

Why needed:

A container should run one main process. For the backend, that process would start Express through `index.js`.

What happens internally:

Docker stores this command as image metadata and runs it when `docker run` starts a container.

### ENTRYPOINT

Example:

```dockerfile
ENTRYPOINT ["node"]
CMD ["index.js"]
```

What it does:

Defines the fixed executable. `CMD` becomes default arguments.

Why needed:

Not required for this project right now. `CMD ["npm", "start"]` is simpler.

### ENV

Example:

```dockerfile
ENV NODE_ENV=production
```

What it does:

Sets an environment variable inside the image/container.

Why needed:

Node apps often use `NODE_ENV` to enable production behavior.

Important:

Secrets should not be baked into images with `ENV`. Runtime secrets should come from Compose, `--env-file`, cloud secret managers, or Kubernetes Secrets.

### ARG

Example:

```dockerfile
ARG NEXT_PUBLIC_API_URL
```

What it does:

Defines a build-time variable.

Why needed:

Next.js may need public environment variables during build.

Difference from `ENV`:

`ARG` exists during build. `ENV` exists in the final image and container.

### USER

Example:

```dockerfile
USER node
```

What it does:

Runs the app as a non-root user.

Why needed:

Better production security.

What happens internally:

Docker changes the Linux user for later image instructions and the final container process.

### VOLUME

Example:

```dockerfile
VOLUME ["/data/db"]
```

What it does:

Marks a directory as externally persisted.

Why needed:

MongoDB images use data volumes for database files.

In this project:

The Compose file handles the volume:

```yaml
mongodb_data:/data/db
```

## Docker Build Process

Generic command:

```bash
docker build -t my-app .
```

In this project today:

- There is no root `Dockerfile`.
- `docker/Dockerfile.backend` is empty.
- `docker/Dockerfile.frontend` is empty.
- The current Compose file does not build backend/frontend images.

So `docker build -t my-app .` is not the normal project command right now.

The normal Docker command is:

```bash
docker compose -f docker/docker-compose.yml up -d
```

### What Would Happen During A Real Build

If a Dockerfile existed, Docker would:

```text
Read Dockerfile
  -> send build context to Docker Engine
  -> execute each instruction
  -> create reusable layers
  -> cache layers by instruction and file checksum
  -> tag final image as my-app
  -> store image locally
```

### Build Context

The build context is the folder Docker can read during build.

Example:

```bash
docker build -f docker/Dockerfile.backend -t smarttravello-backend .
```

Here, the build context is:

```text
.
```

That means Docker can copy files from the repository root.

Because there is no project-level `.dockerignore`, Docker would send too much context if real Dockerfiles were added, including `node_modules`, `.next`, and other unnecessary files. A future `.dockerignore` should exclude these.

## Image vs Container

### Image

An image is a read-only package or blueprint.

In this project:

```text
mongo:7
```

is the image.

It contains MongoDB binaries, default configuration, and a startup command.

### Container

A container is a running instance of an image.

In this project:

```text
smarttravello_mongodb
```

is the container created from `mongo:7`.

### Interview Analogy

Image:

```text
A class definition in JavaScript or TypeScript.
```

Container:

```text
An object created from that class.
```

You can create many MongoDB containers from the same `mongo:7` image, as long as they have different container names and host ports.

## Running The Project With Docker

Current Docker-supported command:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Then run backend locally:

```bash
cd backend
npm run dev
```

Then run frontend locally:

```bash
cd frontend
npm run dev
```

Current full development flow:

```text
Start MongoDB container
  -> start backend on localhost:5000
  -> start frontend on localhost:3000
  -> browser opens localhost:3000
  -> frontend calls backend localhost:5000/api
  -> backend uses Prisma
  -> Prisma connects to MongoDB localhost:27017
  -> Docker forwards traffic to MongoDB container
```

## docker run In This Project

You usually do not need `docker run` manually because Compose manages MongoDB.

But the equivalent MongoDB command would be:

```bash
docker run -d \
  --name smarttravello_mongodb \
  -p 27017:27017 \
  -v mongodb_data:/data/db \
  mongo:7
```

What happens internally:

```text
Docker checks for mongo:7 image
  -> pulls it if missing
  -> creates container filesystem
  -> attaches named volume mongodb_data to /data/db
  -> maps host port 27017 to container port 27017
  -> starts MongoDB process
  -> streams logs through Docker logging driver
```

Useful logs command:

```bash
docker logs smarttravello_mongodb
```

## Port Mapping

Current mapping:

```yaml
ports:
  - "27017:27017"
```

Meaning:

```text
Host port 27017
  -> Container port 27017
```

Request flow:

```text
Backend Prisma Client
  -> mongodb://localhost:27017/smarttravello
  -> host machine port 27017
  -> Docker port forwarding
  -> MongoDB container port 27017
  -> MongoDB database process
```

Example from the prompt:

```bash
docker run -p 3000:3000
```

This would mean:

```text
localhost:3000 on host
  -> port 3000 inside container
```

For a future Dockerized frontend, that is how browser requests would reach Next.js.

## Environment Variables

Backend `.env.example` includes:

```env
PORT=5000
DATABASE_URL="mongodb://localhost:27017/smarttravello"
GROQ_API_KEY=your_groq_api_key_here
SERPAPI_KEY=your_serpapi_key_here
AWS_LOCATION_API_KEY=your_amazon_location_api_key_here
GEOAPIFY_API_KEY=your_geoapify_api_key_here
JWT_SECRET=replace_with_a_long_random_secret
```

Frontend `.env.example` includes:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

### How They Are Used Today

The backend runs locally and loads environment variables through `dotenv` in `backend/index.js`:

```js
import dotenv from 'dotenv';
dotenv.config();
```

Then code reads values through:

```js
process.env.PORT
process.env.DATABASE_URL
process.env.JWT_SECRET
process.env.SERPAPI_KEY
```

Docker Compose currently does not pass application environment variables because it only starts MongoDB. The MongoDB service in this repo does not define custom environment variables.

### Build-Time vs Runtime Variables

Build-time variables:

- Used while building an image.
- Dockerfile uses `ARG`.
- Example future use: `ARG NEXT_PUBLIC_API_URL` during frontend build.

Runtime variables:

- Used when a container starts.
- Compose uses `environment` or `env_file`.
- Node reads them with `process.env`.

In this project today:

- Backend runtime variables come from `backend/.env`.
- Frontend variables come from `frontend/.env.local`.
- MongoDB container does not use project env variables.

## Volumes

Current volume:

```yaml
volumes:
  - mongodb_data:/data/db
```

Named volume declaration:

```yaml
volumes:
  mongodb_data:
```

Purpose:

MongoDB must persist data beyond the lifetime of a single container.

Without the volume:

```text
Remove container
  -> database files disappear
```

With the volume:

```text
Remove container
  -> database files stay in mongodb_data
  -> recreate container
  -> MongoDB sees previous data
```

### Named Volume vs Bind Mount

Named volume:

```yaml
mongodb_data:/data/db
```

Docker owns and manages the storage location.

Bind mount:

```yaml
./mongo-data:/data/db
```

A host folder is mounted directly into the container.

This project uses a named volume, which is simpler and cleaner for local database persistence.

## Networking

Docker Compose creates a default network for services in the Compose file.

Current services:

```text
mongodb
```

Because only MongoDB is in Compose, there is no service-to-service application communication yet.

If backend were added to Compose:

```yaml
services:
  backend:
    ...
    environment:
      DATABASE_URL: mongodb://mongodb:27017/smarttravello
    depends_on:
      - mongodb
```

Then the backend could reach MongoDB using the service name:

```text
mongodb
```

Why not `localhost`?

Inside a container:

```text
localhost = this same container
```

So if the backend container tries `mongodb://localhost:27017`, it looks for MongoDB inside the backend container, not inside the MongoDB container.

## Complete Execution Flow

Command:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Flow:

```text
Docker CLI receives command
  -> Docker Compose reads docker/docker-compose.yml
  -> Docker Engine checks for mongo:7
  -> Docker pulls mongo:7 if missing
  -> Docker creates default Compose network
  -> Docker creates named volume mongodb_data if missing
  -> Docker creates smarttravello_mongodb container
  -> Docker mounts mongodb_data to /data/db
  -> Docker maps localhost:27017 to container:27017
  -> MongoDB starts inside container
```

Then:

```text
Developer starts backend locally
  -> Node runs backend/index.js
  -> dotenv loads backend/.env
  -> Express listens on localhost:5000
  -> Prisma reads DATABASE_URL
  -> Prisma connects to localhost:27017
  -> Docker forwards connection to MongoDB container
```

Then:

```text
Developer starts frontend locally
  -> Next.js listens on localhost:3000
  -> browser opens localhost:3000
  -> frontend calls localhost:5000/api
  -> backend handles request
  -> backend reads/writes MongoDB through Prisma
```

## Node.js Inside Docker

Current project status:

Node.js does not currently run inside Docker for this project.

Today:

```text
backend Node process runs on host
frontend Next.js process runs on host
MongoDB process runs in Docker
```

If backend Dockerfile is added later, expected flow:

```text
Docker build
  -> copy package files
  -> npm ci installs dependencies in image
  -> copy source code
  -> npx prisma generate
  -> CMD starts node index.js or npm start
```

Dependencies would be installed inside:

```text
/app/node_modules
```

inside the image/container, not in the host `backend/node_modules`.

## Docker Layer Caching

Current Dockerfiles are empty, so there are no backend/frontend application layers to cache today.

MongoDB image layers come from Docker Hub. Once `mongo:7` is pulled, Docker reuses those image layers locally.

For a future backend Dockerfile, this pattern would cache well:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY backend .
EXPOSE 5000
CMD ["npm", "start"]
```

Caching behavior:

```text
FROM node:20-alpine
  -> reused unless base image changes

COPY backend/package*.json ./
  -> invalidated only when package files change

RUN npm ci
  -> reused if package files did not change

COPY backend .
  -> invalidated when app source changes
```

Why this is good:

Source code changes should not force `npm ci` to rerun unless dependencies changed.

## Suggested Future Dockerfiles

These are not currently in the repo. They are examples of what production-ready Dockerfiles could look like later.

### Backend Example

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend .

EXPOSE 5000

CMD ["npm", "start"]
```

### Frontend Example

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "start"]
```

These examples would still need careful environment handling because many frontend pages currently hardcode:

```text
http://localhost:5000/api
```

The README already notes that those should be replaced with `NEXT_PUBLIC_API_URL` before production deployment.

## Docker Hub

Current project:

Only the MongoDB image is pulled from Docker Hub:

```text
mongo:7
```

If backend/frontend images are added later, tagging would look like:

```bash
docker build -f docker/Dockerfile.backend -t yourname/smarttravello-backend:v1 .
docker build -f docker/Dockerfile.frontend -t yourname/smarttravello-frontend:v1 .
```

Push:

```bash
docker login
docker push yourname/smarttravello-backend:v1
docker push yourname/smarttravello-frontend:v1
```

Pull and run elsewhere:

```bash
docker pull yourname/smarttravello-backend:v1
docker run -p 5000:5000 --env-file backend.env yourname/smarttravello-backend:v1
```

Tagging guidance:

- `latest` means default/current, but it is vague.
- `v1`, `v1.1`, or Git SHA tags are better for deployments.

## Production Deployment

### AWS EC2, Azure VM, DigitalOcean Droplet

High-level flow:

```text
Provision VM
  -> install Docker and Docker Compose
  -> copy compose file or pull repository
  -> configure production .env files
  -> run docker compose up -d
  -> configure firewall/security group ports
  -> put Nginx/Caddy/reverse proxy in front
  -> enable HTTPS
```

Current limitation:

Because backend/frontend Dockerfiles are empty, production deployment cannot use this repo's Dockerfiles yet. You would either:

- run backend/frontend directly on the VM with Node.js, or
- create production-ready Dockerfiles first.

### Kubernetes Overview

In Kubernetes, the future architecture would be:

```text
frontend Deployment + Service
backend Deployment + Service
MongoDB StatefulSet or external MongoDB Atlas
Secrets for API keys
ConfigMaps for non-secret config
Ingress for public traffic
PersistentVolumeClaim for MongoDB if self-hosted
```

For production, MongoDB Atlas is usually easier and safer than running MongoDB yourself in Kubernetes.

## Common Docker Commands For This Project

List images:

```bash
docker images
```

Use it to see whether `mongo:7` has been pulled.

List running containers:

```bash
docker ps
```

You should see `smarttravello_mongodb` when MongoDB is running.

List all containers:

```bash
docker ps -a
```

Shows stopped containers too.

Build an image:

```bash
docker build -t my-app .
```

Not currently the normal SmartTravello command because the app Dockerfiles are empty.

Run MongoDB manually:

```bash
docker run -d --name smarttravello_mongodb -p 27017:27017 -v mongodb_data:/data/db mongo:7
```

Stop container:

```bash
docker stop smarttravello_mongodb
```

Start stopped container:

```bash
docker start smarttravello_mongodb
```

Restart container:

```bash
docker restart smarttravello_mongodb
```

Remove container:

```bash
docker rm smarttravello_mongodb
```

Remove image:

```bash
docker rmi mongo:7
```

View logs:

```bash
docker logs smarttravello_mongodb
```

Enter container shell:

```bash
docker exec -it smarttravello_mongodb bash
```

Open Mongo shell:

```bash
docker exec -it smarttravello_mongodb mongosh
```

Inspect container:

```bash
docker inspect smarttravello_mongodb
```

List networks:

```bash
docker network ls
```

List volumes:

```bash
docker volume ls
```

Start Compose service:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Stop and remove Compose container/network:

```bash
docker compose -f docker/docker-compose.yml down
```

Stop and remove Compose container/network plus volume:

```bash
docker compose -f docker/docker-compose.yml down -v
```

Warning:

`down -v` deletes the MongoDB data volume.

## Interview Questions And Answers

### What is Docker?

Docker is a container platform that packages an application or service with its runtime dependencies. In this project, Docker is used to run MongoDB 7 consistently without installing MongoDB directly on the host machine.

### Why did you use Docker?

We use Docker to provide the MongoDB dependency for local development. It gives every developer the same MongoDB version, port mapping, and persistent storage through a named volume.

### Docker vs Virtual Machines

Virtual machines virtualize a full operating system. Docker containers share the host kernel and isolate processes, filesystems, networking, and resources. Containers are usually lighter and faster to start than VMs.

Project-specific answer:

> I do not need a full VM just to run MongoDB for SmartTravello. A MongoDB container is enough, starts quickly, and can be removed without affecting the host system.

### Image vs Container

Image:

```text
mongo:7
```

Container:

```text
smarttravello_mongodb
```

The image is the read-only template. The container is the running MongoDB instance created from that image.

### What is Docker Compose?

Docker Compose is a tool for defining and running multi-container applications with a YAML file. In this project, Compose currently defines one service: MongoDB.

### What is Port Mapping?

Port mapping connects a host port to a container port.

In this project:

```text
localhost:27017 -> MongoDB container:27017
```

This lets the local backend connect to the Dockerized database.

### What are Volumes?

Volumes persist data outside a container. This project uses `mongodb_data` so MongoDB data survives container deletion.

### What are Docker Layers?

Docker images are built from layers. Each Dockerfile instruction usually creates a layer. This project currently reuses layers from the pulled `mongo:7` image. Future backend/frontend Dockerfiles would create application-specific layers.

### What is Layer Caching?

Docker reuses unchanged layers to speed up builds. For example, in a future backend Dockerfile, `RUN npm ci` can be cached if `package-lock.json` has not changed.

### What Happens Internally When docker run Is Executed?

Docker:

```text
checks image
  -> pulls image if missing
  -> creates container filesystem
  -> applies network settings
  -> applies volume mounts
  -> applies environment variables
  -> starts the main process
```

For this project's MongoDB container, the main process is the MongoDB server.

### What Happens Internally When docker build Is Executed?

Docker:

```text
reads Dockerfile
  -> sends build context
  -> executes instructions in order
  -> creates layers
  -> caches reusable layers
  -> tags the final image
```

In this project today, backend/frontend builds are not meaningful because both app Dockerfiles are empty.

## Learning Order

Study in this exact order:

1. Read `docker/docker-compose.yml`.
2. Run `docker compose -f docker/docker-compose.yml up -d`.
3. Run `docker ps` and identify `smarttravello_mongodb`.
4. Run `docker logs smarttravello_mongodb`.
5. Run `docker volume ls` and find `mongodb_data`.
6. Read `backend/.env.example`, especially `DATABASE_URL`.
7. Read `backend/prisma/schema.prisma`.
8. Start backend locally and understand how Prisma reaches Dockerized MongoDB.
9. Start frontend locally and follow request flow from browser to backend to MongoDB.
10. Inspect empty `docker/Dockerfile.backend` and `docker/Dockerfile.frontend`.
11. Learn Dockerfile instructions using the suggested future Dockerfiles above.
12. Learn image/container difference with `mongo:7` and `smarttravello_mongodb`.
13. Learn cleanup commands: `docker compose down` vs `docker compose down -v`.
14. Only after that, study Docker Hub and production deployment.

## One-Minute Interview Summary

Use this if an interviewer asks for a quick explanation:

> In SmartTravello, Docker is currently used for infrastructure, specifically MongoDB. The Compose file starts a `mongo:7` container named `smarttravello_mongodb`, maps host port `27017` to container port `27017`, and persists database files using the `mongodb_data` named volume mounted at `/data/db`. The backend and frontend are not containerized yet; their Dockerfiles are empty placeholders. During local development, I start MongoDB with Docker Compose, run the backend locally on port `5000`, run the frontend locally on port `3000`, and the backend connects to MongoDB using `DATABASE_URL=mongodb://localhost:27017/smarttravello`. If the backend were containerized later, the database URL would change from `localhost` to the Compose service name `mongodb`.

