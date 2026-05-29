# Development server

How to run the web app locally with `npm run dev`.

**Note:** PostgreSQL install commands below are for **Linux** (Debian/Ubuntu-style). Adapt for other OSes.

## Database setup

```bash
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER sandboxed WITH PASSWORD 'sandboxed123';"
sudo -u postgres psql -c "CREATE DATABASE sandboxed_agents OWNER sandboxed;"
```

Apply the schema:

```bash
npm run prisma:migrate
```

## Run

Put the **Development** env block from [`packages/web/README.md`](packages/web/README.md#development) in `.env.local` at the repo root.

```bash
npm install
npm run dev
```
