import Redis from "ioredis";

const REDIS_URL = process.env.SWARM_REDIS_URL || "redis://localhost:6379";

/** Shared Redis client for commands. */
let client;

/** Separate Redis client for pub/sub subscriptions. */
let subscriber;

/** Separate Redis client for publishing. */
let publisher;

function createClient(label = "default") {
  const opts = {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
    tls: REDIS_URL.startsWith("rediss://") ? {} : undefined,
  };

  const c = new Redis(REDIS_URL, opts);
  c.on("error", (err) => console.error(`[redis:${label}]`, err.message));
  return c;
}

export function getClient() {
  if (!client) {
    client = createClient("cmd");
  }
  return client;
}

export function getSubscriber() {
  if (!subscriber) {
    subscriber = createClient("sub");
  }
  return subscriber;
}

export function getPublisher() {
  if (!publisher) {
    publisher = createClient("pub");
  }
  return publisher;
}

/**
 * Connect all Redis clients. Call once at startup.
 */
export async function connectAll() {
  await Promise.all([
    getClient().connect(),
    getSubscriber().connect(),
    getPublisher().connect(),
  ]);
}

/**
 * Gracefully disconnect all Redis clients.
 */
export async function disconnectAll() {
  const clients = [client, subscriber, publisher].filter(Boolean);
  await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
  client = null;
  subscriber = null;
  publisher = null;
}
