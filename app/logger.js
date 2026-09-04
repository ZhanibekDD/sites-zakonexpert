'use strict';

const path = require('path');
const winston = require('winston');
const { ROOT_DIR } = require('./paths');

function createLogger() {
  const LOG_MAX_SIZE = 2 * 1024 * 1024;
  const LOG_MAX_FILES = 2;

  function fileLog(filename, level) {
    return new winston.transports.File({
      filename: path.join(ROOT_DIR, filename),
      level,
      maxsize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      tailable: true,
    });
  }

  function consoleLog() {
    return new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} ${level}: ${stack || message}`;
        })
      ),
      level: 'info',
    });
  }

  // Plesk captures stdout/stderr. File logs are opt-in and always rotated, so
  // an unattended application can no longer fill the hosting disk.
  const FILE_LOGS_ENABLED = /^(1|true|yes)$/i.test(process.env.FILE_LOGS_ENABLED || '');

  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.printf(({ timestamp, level, message, stack }) => {
        return `${timestamp} ${level}: ${stack || message}`;
      })
    ),
    transports: [consoleLog(), ...(FILE_LOGS_ENABLED ? [fileLog('app.log', 'info')] : [])],
    exceptionHandlers: [consoleLog(), ...(FILE_LOGS_ENABLED ? [fileLog('exceptions.log', 'error')] : [])],
    rejectionHandlers: [consoleLog(), ...(FILE_LOGS_ENABLED ? [fileLog('rejections.log', 'error')] : [])],
  });

  return { logger };
}

module.exports = { createLogger };
