import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from './config';

export function createLogger(config: Config, destination?: DestinationStream): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: [
      'authorization',
      'cookie',
      'apiKey',
      'token',
      'password',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.token',
      'req.body.password',
      'req.body.apiKey',
      'headers.authorization',
      'headers.cookie',
      '*.apiKey',
      '*.token',
      '*.password',
    ],
  }, destination);
}
