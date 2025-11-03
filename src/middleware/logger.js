import winston, { createLogger, format, transports } from 'winston';

import os from 'os';
const { combine, timestamp, printf, json, prettyPrint, colorize } = format;

const infoFormat = printf(({ level, message, timestamp, service, ...metadata }) => {
    let msg = `[${level}] ${timestamp} [${service}]:--- ${message}`;
    if (metadata) {
        // msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});

const errorFormat = printf(({ level, timestamp, ...metadata }) => {
    let msg = `[${level}] ${timestamp}`;
    if (metadata) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});

const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `[${level}] [Message:- ${message}] `;
    if (metadata) {
        msg += ` ${JSON.stringify(metadata?.log)}`;
    }
    return msg;
});

const logger = createLogger({
    level: 'info',
    defaultMeta: {
        hostname: os.hostname(),
        pid: process.pid,
    },
    transports: [
        new transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: combine(
                timestamp(),
                errorFormat,
                prettyPrint()
            )
        }),
        new transports.File({
            filename: `logs/logs.log`,
            level: 'info',
            format: combine(
                json(),
            )
        })
    ],
    exceptionHandlers: [
        new transports.File({ filename: 'logs/exceptions.log' })
    ],
    handleRejections: true
});


const loggerMiddleware = (req, res, next) => {
    const { method, url, headers, body } = req;
    const { remoteAddress, remotePort } = req.connection;
    const start = process.hrtime();

    res.on('finish', () => {
        const { statusCode } = res;
        const responseBody = res.body ? JSON.stringify(res.body) : '';
        const elapsed = process.hrtime(start);
        const elapsedMs = (elapsed[0] * 1000) + (elapsed[1] / 1000000);
        logger.info({
            method,
            url,
            headers,
            body,
            elapsedMs,
            remoteAddress,
            remotePort,
            statusCode,
            // responseBody,
            time: new Date().toISOString(),
            res: res.data
        });
    });
    next();

};

const responseCaptureMiddelware = (req, res, next) => {
    const oldSend = res.send;

    res.send = function (body) {
        res.body = body;
        return oldSend.apply(res, arguments);
    };

    next();
}


export { logger, loggerMiddleware, responseCaptureMiddelware };