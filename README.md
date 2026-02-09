⚠️ Work in progress / NOT READY FOR PRODUCTION USE

# LatticeStore SDK (WIP)

### LatticeStore is a set of tools for building PQC E2EE applications using the Lattice-based PQC over S3-compatible object storages to allow building collaborative applications with strong security guarantees.

![image](/docs/basic.svg)

// TODO fix docs

1. install Node.js and npm
2. install dependencies

```bash
# Install dependencies
npm install
```

3. rename `.dev.vars.example` to `.dev.vars` and set the environment variables
4. run the app

```bash
# Run the app - development mode
npm run dev
```

It builds the client & service code into `dist/` folder and starts the dev server for example app (`http://localhost:5173/`) and the backend API service (`http://localhost:8787/`). Everything is hot reloaded so changes are reflected immediately.

### Structure

`src/` - source code of protocol library

- `src/client` - browser client side code
- `src/service` - server side for protocol library

`dist/` - compiled code from `src/` folder

`examples/` - example API implementations

- `examples/web` - web app using the client side library
- `infra/cloudflare` | `infra/local-docker` - backend API service using the server side library
