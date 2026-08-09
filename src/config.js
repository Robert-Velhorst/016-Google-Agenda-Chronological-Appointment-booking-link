'use strict';

const path = require('node:path');
require('dotenv').config({ quiet: true });

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name, value, fallback, minimum = 0) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return parsed;
}

function boolean(name, value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const appEnv = env.APP_ENV || 'development';
  const baseUrl = env.BASE_URL || 'http://localhost:8787';
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET);
  const config = {
    appEnv,
    port: integer('PORT', env.PORT, 8787, 1),
    host: env.HOST || (appEnv === 'production' ? '0.0.0.0' : '127.0.0.1'),
    baseUrl: new URL(baseUrl).toString().replace(/\/$/, ''),
    databasePath: path.resolve(env.DATABASE_PATH || './data/booking.sqlite'),
    ownerId: env.OWNER_ID || 'owner-local',
    ownerEmail: env.OWNER_EMAIL || 'owner@example.com',
    adminToken: required('ADMIN_TOKEN', env.ADMIN_TOKEN),
    encryptionKey: env.ENCRYPTION_KEY || '',
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: env.GOOGLE_REDIRECT_URI || `${baseUrl.replace(/\/$/, '')}/oauth/google/callback`,
    googleConfigured,
    trustProxy: boolean('TRUST_PROXY', env.TRUST_PROXY),
    rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', env.RATE_LIMIT_WINDOW_MS, 60000, 1000),
    rateLimitPublic: integer('RATE_LIMIT_PUBLIC', env.RATE_LIMIT_PUBLIC, 60, 1),
    rateLimitAdmin: integer('RATE_LIMIT_ADMIN', env.RATE_LIMIT_ADMIN, 120, 1),
    providerTimeoutMs: integer('PROVIDER_TIMEOUT_MS', env.PROVIDER_TIMEOUT_MS, 10000, 1000),
    reconcileMinAgeMs: integer('RECONCILE_MIN_AGE_MS', env.RECONCILE_MIN_AGE_MS, 60000, 0),
    haiConnectorToken: env.HAI_CONNECTOR_TOKEN || '',
    haiConnectorProjectKey: String(env.HAI_CONNECTOR_PROJECT_KEY || '016-Google-Agenda').trim().slice(0, 120),
    haiConnectorMaxItems: integer('HAI_CONNECTOR_MAX_ITEMS', env.HAI_CONNECTOR_MAX_ITEMS, 100, 1),
    haiConnectorIncludePii: boolean('HAI_CONNECTOR_INCLUDE_PII', env.HAI_CONNECTOR_INCLUDE_PII)
  };

  if (config.adminToken.length < 24) throw new Error('ADMIN_TOKEN must be at least 24 characters');
  if (config.port > 65535) throw new Error('PORT must be <= 65535');
  if (googleConfigured && (!config.googleClientId || !config.googleClientSecret)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together');
  }
  if ((googleConfigured || appEnv === 'production') && !/^[a-f0-9]{64}$/i.test(config.encryptionKey)) {
    throw new Error('ENCRYPTION_KEY must contain exactly 64 hexadecimal characters');
  }
  if (appEnv === 'production' && new URL(config.baseUrl).protocol !== 'https:') {
    throw new Error('BASE_URL must use HTTPS in production');
  }
  const publicUrl = new URL(config.baseUrl);
  if (!['http:', 'https:'].includes(publicUrl.protocol)) throw new Error('BASE_URL must use HTTP or HTTPS');
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') {
    throw new Error('BASE_URL must be an origin without credentials, path, query, or fragment');
  }
  const redirectUrl = new URL(config.googleRedirectUri);
  if (googleConfigured && redirectUrl.origin !== publicUrl.origin) {
    throw new Error('GOOGLE_REDIRECT_URI must use the same origin as BASE_URL');
  }
  if (config.haiConnectorToken && config.haiConnectorToken.length < 32) {
    throw new Error('HAI_CONNECTOR_TOKEN must be at least 32 characters when configured');
  }
  if (!config.haiConnectorProjectKey) throw new Error('HAI_CONNECTOR_PROJECT_KEY must not be empty');
  if (config.haiConnectorMaxItems > 500) throw new Error('HAI_CONNECTOR_MAX_ITEMS must be <= 500');
  if (appEnv === 'production' && config.reconcileMinAgeMs < config.providerTimeoutMs * 2) {
    throw new Error('RECONCILE_MIN_AGE_MS must be at least twice PROVIDER_TIMEOUT_MS in production');
  }
  return Object.freeze(config);
}

module.exports = { loadConfig };
