import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes';

const app = express();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const CLIENT_URL = process.env.CLIENT_URL || undefined;

// Parse default port from BASE_URL
let defaultPort = 3001;
try {
  const url = new URL(BASE_URL);
  if (url.port) {
    defaultPort = Number(url.port);
  } else {
    defaultPort = url.protocol === 'https:' ? 443 : 80;
  }
} catch (err) {
  // Use fallback if BASE_URL is invalid
}

// In cloud environments, PORT is set dynamically. Fall back to BASE_URL port.
const listenPort = process.env.PORT ? Number(process.env.PORT) : defaultPort;

app.use(cors(CLIENT_URL ? { origin: CLIENT_URL } : undefined));
app.use(express.json({ limit: '10mb' }));

app.use('/api', routes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(listenPort, () => {
  console.log(`Server running on ${BASE_URL} (listening on port ${listenPort})`);
});