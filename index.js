const { Client, GatewayIntentBits, Events } = require('discord.js');
const config = require('./src/config');
const store = require('./src/store');
const smart = require('./src/smart');
const { syncCommands } = require('./src/commands');
const { createApp, startServer } = require('./src/http');
const { createJobManager, reconcilePanels } = require('./src/jobs');
const { createInteractionHandler } = require('./src/interactions');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const app = createApp({ client });
const jobs = createJobManager({ client });
let httpServer = null;
let shuttingDown = false;
let processLockHeld = false;
let guardsInstalled = false;

function installProcessGuards() {
  if (guardsInstalled) return;
  guardsInstalled = true;

  process.on('unhandledRejection', error => {
    console.error(`[PROCESS] Unhandled promise rejection: ${smart.safeError(error)}`);
    gracefulShutdown('UNHANDLED_REJECTION', 1).catch(() => process.exit(1));
  });

  process.on('uncaughtException', error => {
    console.error(`[PROCESS] Uncaught exception: ${smart.safeError(error)}`);
    gracefulShutdown('UNCAUGHT_EXCEPTION', 1).catch(() => process.exit(1));
    setTimeout(() => process.exit(1), 10_000).unref();
  });

  client.on(Events.Error, error => console.error(`[DISCORD] Client error: ${smart.safeError(error)}`));
  client.on(Events.Warn, warning => console.warn(`[DISCORD] ${smart.safeError(warning)}`));
}

function waitForClientReady(timeoutMs = 30_000) {
  if (client.isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Discord client did not become ready within the startup timeout.'));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off(Events.ClientReady, onReady);
      client.off(Events.Error, onError);
    };

    client.once(Events.ClientReady, onReady);
    client.once(Events.Error, onError);
  });
}

async function gracefulShutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SHUTDOWN] ${signal}`);

  if (httpServer) {
    const server = httpServer;
    httpServer = null;
    if (server.listening) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000).unref();
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  client.destroy();
  if (processLockHeld) {
    processLockHeld = false;
    await store.releaseProcessLock().catch(() => {});
  }

  process.exitCode = exitCode;
  if (require.main === module) process.exit(exitCode);
}

async function main() {
  installProcessGuards();
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM').catch(() => process.exit(0)));
  process.once('SIGINT', () => gracefulShutdown('SIGINT').catch(() => process.exit(0)));

  await store.acquireProcessLock();
  processLockHeld = true;
  if (shuttingDown) return;
  await store.ensure();
  if (shuttingDown) return;

  client.on(Events.InteractionCreate, createInteractionHandler({ client, jobs }));

  const serverReady = startServer(app, server => { httpServer = server; });
  await serverReady;
  if (shuttingDown) return;
  await client.login(config.token);
  if (shuttingDown) return;
  await waitForClientReady();
  if (shuttingDown) return;

  console.log(`Logged in as ${client.user.tag}`);
  try {
    const result = await syncCommands({ retries: 3 });
    console.log(result.changed
      ? `Slash commands synchronized automatically: ${result.count}.`
      : `Slash commands already synchronized: ${result.count}.`);
  } catch (error) {
    // Command sync failure should not hide a healthy already-running bot, but it is logged loudly.
    console.error(`Automatic slash command synchronization failed: ${smart.safeError(error)}`);
  }

  await reconcilePanels({ client });
  await jobs.recover();
}

if (require.main === module) {
  main().catch(async error => {
    console.error(`[STARTUP] ${smart.safeError(error)}`);
    await gracefulShutdown('STARTUP_FAILURE', 1).catch(() => {});
  });
}

module.exports = { client, main, gracefulShutdown, waitForClientReady };
