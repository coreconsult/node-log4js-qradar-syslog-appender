/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2016, 2018. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
/* eslint-env node */

import tls from "tls";
import { inspect, format, log as _log } from "util";
import { hostname } from "os";
import { createSocket } from "dgram";
import net from "net";
import * as Singleton from "./syslog-connection-singleton";
import {
  hasCaCert,
  hasClientCert,
  configureMutualAuth,
  configureAuthedServer
} from "./cert-handling";

const state = new Singleton();

function internalLog(msg) {
  _log(`log4js-syslog-tls-appender: ${msg}`);
}

function levelToSeverity(levelStr) {
  const levels = ["FATAL", "ERROR", "WARN", "INFO", "DEBUG", "TRACE"];

  return levels.indexOf(levelStr) !== -1 ? levels.indexOf(levelStr) + 1 : 4;
}

function formatMessage(message, levelStr, options) {
  // format as:
  // HEADER STRUCTURED_DATA MESSAGE
  // where HEADER = <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID
  // for details see the RFC here http://tools.ietf.org/html/rfc5424# .
  return format(
    "<%d>%d %s %s %s %d %s %s %s\n",
    16 * 8 +
      levelToSeverity(
        levelStr
      ) /* hardcoded facility of local0 which translates to 16 according to RFC.
                                           TODO: use passed in facility. */,
    1,
    new Date().toJSON(),
    options.url,
    options.product,
    process.pid,
    "-",
    "-",
    message || "{}"
  );
}

function connectCircuit() {
  internalLog(
    `Re-connecting the circuit. So far we have dropped ${state.droppedMessages} messages.`
  );
  state.circuitBreak = false;
}

function cleanupConnection(err, type) {
  console.warn(`Syslog appender: connection ${type}. Error: ${inspect(err)}`);
  if (state.connection) {
    state.connection.destroy();
    state.connection = null;
  }
  state.connecting = false;
}

function shutdown(callback) {
  state.shutdown = true;
  cleanupConnection("log4js is shutting down", "shutting down");
  callback();
}

function retryLogic(retryFunction, tries) {
  // we are in circuit break mode. There is something wrong with the syslog connection. We won't try to
  // send any log messages to the syslog server until the circuit is connected again.
  if (state.circuitBreak) {
    state.droppedMessages = +1;
    return;
  }

  // initialize (or increment if already initialized) tries
  if (!tries) {
    tries = 1;
  } else {
    tries = +1;
  }

  if (tries > state.MAX_TRIES) {
    state.circuitBreak = true;
    internalLog(
      `Tried sending a message ${state.MAX_TRIES} times but the client was not connected. ` +
        `Initiating circuit breaker protocol. ` +
        `For the next ${state.CIRCUIT_BREAK_MINS} mins, we will not attempt to send any messages to syslog.`
    );
    // circuit breaker logic - if detected bad connection, stop trying
    // to send log messages to syslog for syslogConnectionSingleton.state.CIRCUIT_BREAK_MINS.

    state.droppedMessages = +1;
    setTimeout(connectCircuit.bind(this), state.CIRCUIT_BREAK_MINS * 60 * 1000);
    return;
  }
  setTimeout(retryFunction.bind(this, tries), 100);
}

function logMessage(log, options, tries) {
  // we are in circuit break mode. There is something wrong with the syslog connection. We won't try to
  // send any log messages to syslog until the circuit is connected again.
  if (state.circuitBreak) {
    state.droppedMessages = +1;
    return;
  }

  // we got disconnected or are still connecting
  // retry later when we are hopefully (re)connected
  if (!state.connection || state.connecting) {
    /* eslint-disable-next-line no-use-before-define */
    retryLogic(loggingFunction.bind(this, options, log), tries);
    return;
  }

  // if theres a whitelist then only send those messages
  const logWhitelist = process.env.log4js_syslog_appender_whitelist;
  const categoriesToSend = logWhitelist && logWhitelist.split(",");
  if (logWhitelist && categoriesToSend.indexOf(log.categoryName) === -1) return;

  const formattedMessage = formatMessage(
    log.data.join(" | "),
    log.level && log.level.levelStr,
    options
  );

  state.connection.write(formattedMessage);
}

function loggingFunction(options, log, tries) {
  if (state.shutdown) {
    return;
  }
  // we are in circuit break mode. There is something wrong with the syslog connection. We won't try to
  // send any log messages to syslog until the circuit is connected again.
  if (state.circuitBreak) {
    state.droppedMessages = +1;
    return;
  }

  if (!state.connection && !state.connecting) {
    state.connecting = true;
    // udp
    if (options.useUdpSyslog) {
      /* eslint-disable-next-line no-use-before-define */
      attemptUdpConnection(options, log, tries);
    } else {
      // tcp
      /* eslint-disable-next-line no-use-before-define */
      const boundFunction = attemptTcpConnection.bind(this, log, tries);
      if (hasCaCert(options)) {
        if (hasClientCert(options)) {
          configureMutualAuth(options, boundFunction);
        } else {
          configureAuthedServer(options, boundFunction);
        }
      } else {
        boundFunction(options);
      }
    }
  } else {
    logMessage(log, options, tries);
  }
}

function attemptUdpConnection(options, log, tries) {
  const client = createSocket("udp4");
  state.connection = {
    write(msg) {
      client.send(msg, 0, msg.length, options.port, options.host, function(
        err
      ) {
        if (err && err !== 0) {
          cleanupConnection(err, "error");
          retryLogic(loggingFunction.bind(this, options, log), tries);
        }
      });
    },
    destroy() {
      client.close();
    }
  };
  client.on("error", function(err) {
    cleanupConnection(err, "error");
    retryLogic(loggingFunction.bind(this, options, log), tries);
  });
  state.connecting = false;
  logMessage(log, options, tries);
}

function connected(message, options, tries) {
  state.connecting = false;
  console.warn(
    `Syslog appender: we have (re)connected using a secure connection with ${
      state.connection.authorized ? "a valid " : "an INVALID "
    }peer certificate. ${state.droppedMessages} messages have been dropped.`
  );
  logMessage(message, options, tries);
}

function attemptTcpConnection(log, tries, options, useTLS) {
  const tlsOptions = {
    cert: options.certificate,
    key: options.key,
    ca: options.caCert,
    host: options.host,
    port: options.port,
    passphrase: options.passphrase,
    facility: options.facility,
    tag: options.tag,
    leef: options.leef,
    vendor: options.vendor,
    product: options.product,
    product_version: options.product_version,
    rejectUnauthorized: options.rejectUnauthorized
  };

  let tcpLib;

  if (useTLS) {
    tcpLib = tls;
  } else {
    tcpLib = net;
  }

  state.connection = tcpLib.connect(
    tlsOptions,
    connected.bind(this, log, options, tries)
  );

  state.connectionsetEncoding("utf8");
  state.connectionon("error", function(err) {
    cleanupConnection(err, "error");
    retryLogic(loggingFunction.bind(this, options, log), tries);
  });
  state.connectionon("close", function(err) {
    cleanupConnection(err, "closed");
    retryLogic(loggingFunction.bind(this, options, log), tries);
  });
  state.connectionon("end", function(err) {
    cleanupConnection(err, "ended");
    retryLogic(loggingFunction.bind(this, options, log), tries);
  });
}

function parseToBoolean(val, defaultValue) {
  if (defaultValue) {
    // default is true
    return val !== "false" && val !== false;
  }
  // default is false
  return val === "true" || val === true;
}

function verifyOptions(options) {
  const requiredOptions = [
    "log4js_syslog_appender_host",
    "log4js_syslog_appender_port",
    "log4js_syslog_appender_product"
  ];
  let valid = true;

  requiredOptions.forEach(function(option) {
    const key = option.substring(option.lastIndexOf("_") + 1);
    if (!options[key]) {
      internalLog(
        `${key} is a required option. It is settable with the ${option} environment variable.`
      );
      valid = false; // array.forEach is blocking
    }
  });

  [
    "log4js_syslog_appender_certificate",
    "log4js_syslog_appender_privateKey",
    "log4js_syslog_appender_ca"
  ].forEach(function(option) {
    const key = option.split("_").pop();

    if (
      !options[`${key}Path`] &&
      !options[`${key}Base64`] &&
      !options.useUdpSyslog
    ) {
      internalLog(
        `In order to enable mutual auth, either ${key}Path or ${key}Base64 are required options.
         It is settable with the ${option} environment variable.`
      );
    }

    // Deprecated warnings.
    if (options[`${key}Path`]) {
      if (options.useUdpSyslog) {
        internalLog(
          `WARNING env var ${key}Path will not be used for unencrypted syslog UDP/514.`
        );
      } else {
        internalLog(
          `WARNING env var ${key}Path is now deprecated and will be removed in a future` +
            ` release. Please switch to ${key}Base64 instead.`
        );
      }
    }
    if (options[`${key}Base64`] && options.useUdpSyslog) {
      internalLog(
        `WARNING env var ${key}Base64 will not be used for unencrypted syslog UDP/514.`
      );
    }
  });

  return valid;
}

function appender(config) {
  const options = {
    host:
      process.env.log4js_syslog_appender_host ||
      (config.options && config.options.host),
    port:
      process.env.log4js_syslog_appender_port ||
      (config.options && config.options.port),
    useUdpSyslog:
      process.env.log4js_syslog_appender_useUdpSyslog !== undefined
        ? process.env.log4js_syslog_appender_useUdpSyslog
        : config.options && config.options.useUdpSyslog,
    certificatePath:
      process.env.log4js_syslog_appender_certificatePath ||
      (config.options && config.options.certificatePath),
    privateKeyPath:
      process.env.log4js_syslog_appender_privateKeyPath ||
      (config.options && config.options.privateKeyPath),
    passphrase:
      process.env.log4js_syslog_appender_passphrase ||
      (config.options && config.options.passphrase) ||
      "",
    caPath:
      process.env.log4js_syslog_appender_caPath ||
      (config.options && config.options.caPath),
    certificateBase64:
      process.env.log4js_syslog_appender_certificateBase64 ||
      (config.options && config.options.certificateBase64),
    privateKeyBase64:
      process.env.log4js_syslog_appender_privateKeyBase64 ||
      (config.options && config.options.privateKeyBase64),
    caBase64:
      process.env.log4js_syslog_appender_caBase64 ||
      (config.options && config.options.caBase64),
    facility:
      process.env.log4js_syslog_appender_facility ||
      (config.options && config.options.facility) ||
      "",
    tag:
      process.env.log4js_syslog_appender_tag ||
      (config.options && config.options.tag) ||
      "",
    leef:
      process.env.log4js_syslog_appender_leef ||
      (config.options && config.options.leef) ||
      "",
    vendor:
      process.env.log4js_syslog_appender_vendor ||
      (config.options && config.options.vendor) ||
      "",
    product:
      process.env.log4js_syslog_appender_product ||
      (config.options && config.options.product),
    product_version:
      process.env.log4js_syslog_appender_product_version ||
      (config.options && config.options.product_version) ||
      "",
    rejectUnauthorized:
      process.env.log4js_syslog_appender_rejectUnauthorized !== undefined
        ? process.env.log4js_syslog_appender_rejectUnauthorized
        : config.options && config.options.rejectUnauthorized,
    url:
      process.env.log4js_syslog_appender_url ||
      (config.options && config.options.url) ||
      process.env.url ||
      hostname() ||
      ""
  };

  const stripOut = ["https://", "http://"];
  for (let i = 0; i < stripOut.length; i += 1) {
    if (options.url.startsWith(stripOut[i])) {
      options.url = options.url.slice(stripOut[i].length);
    }
  }

  // make sure boolean flags work properly with string inputs
  options.useUdpSyslog = parseToBoolean(options.useUdpSyslog); // default is false
  options.rejectUnauthorized = parseToBoolean(options.rejectUnauthorized, true); // default is true

  if (!verifyOptions(options)) {
    return function() {};
  }

  // deep clone of options
  const optionsClone = JSON.parse(JSON.stringify(options));

  if (typeof optionsClone.privateKeyBase64 === "string") {
    optionsClone.privateKeyBase64 = `REDACTED string, len: ${optionsClone.privateKeyBase64.length}`;
  }
  internalLog(
    `Syslog appender is enabled with options: ${JSON.stringify(
      optionsClone,
      null,
      2
    )}`
  );

  state.shutdown = false;

  return loggingFunction.bind(this, options);
}

function configure(config) {
  if (process.env.log4js_syslog_appender_enabled !== "true") {
    return function() {};
  }
  return appender(config);
}

export default {
  appender,
  configure,
  shutdown
};
