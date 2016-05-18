/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
'use strict';

var log4js = require('log4js'),
    syslogConnectionSingleton = require('./syslog-connection-singleton'),
    tls = require('tls'),
    fs = require('fs'),
    util = require('util'),
    os = require('os');

module.exports = {
    appender: appender,
    configure: configure
};


function retryLogic(retryFunction, tries) {
    // we are in circuit break mode. There is something wrong with the qradar connection. We won't try to
    // send any log messages to qradar until the circuit is connected again.
    if (syslogConnectionSingleton.circuitBreak) {
        syslogConnectionSingleton.droppedMessages++;
        return;
    }
    
    // initialize (or increment if already initialized) tries
    if (!tries) {
        tries = 1;
    }
    else {
        tries++;
    }

    if (tries >= syslogConnectionSingleton.MAX_TRIES) {
        util.log('QRadar Syslog Appender: Tried sending a message ' + syslogConnectionSingleton.MAX_TRIES + 
            ' times but the client was not connected. ' + 
            'Initiating circuit breaker protocol. ' + 
            'For the next ' + syslogConnectionSingleton.CIRCUIT_BREAK_MINS + 
            ' mins, we will not attempt to send any messages to Logmet.');
        // circuit breaker logic - if detected bad connection, stop trying
        // to send log messages to qradar for syslogConnectionSingleton.CIRCUIT_BREAK_MINS.

        syslogConnectionSingleton.droppedMessages++;
        syslogConnectionSingleton.circuitBreak = true;
        setTimeout(connectCircuit.bind(this), 
            syslogConnectionSingleton.CIRCUIT_BREAK_MINS * 60 * 1000);
        return;
    }
    setTimeout(retryFunction.bind(this, tries), 100);
    return;
};

function connectCircuit() {
    util.log('QRadar Syslog Appender: Re-connecting the circuit. So far we have dropped ' + 
        syslogConnectionSingleton.droppedMessages + ' messages.');
    syslogConnectionSingleton.circuitBreak = false;
};

function loggingFunction(options, log, tries) {
    // we are in circuit break mode. There is something wrong with the qradar connection. We won't try to
    // send any log messages to qradar until the circuit is connected again.
    if (syslogConnectionSingleton.circuitBreak) {
        syslogConnectionSingleton.droppedMessages++;
        return;
    }

    if (!syslogConnectionSingleton.connection && !syslogConnectionSingleton.connecting) {
        syslogConnectionSingleton.connecting = true;

        // set up mutual auth.
        fs.readFile(options.certificatePath, function(err, certificate) {
            if (err) {
                console.error('Error while loading certificate from path: ' + options.certificatePath + ' Error: ' + JSON.stringify(err, null, 2));
                return;
            }

            fs.readFile(options.privateKeyPath, function(err, key) {
                if (err) {
                    console.error('Error while loading private key from path: ' + options.privateKeyPath + ' Error: ' + JSON.stringify(err, null, 2));
                    return;
                }

                fs.readFile(options.caPath, function(err, caCert) {
                    if (err) {
                        console.error('Error while loading ca key from path: ' + options.caPath + ' Error: ' + JSON.stringify(err, null, 2));
                        return;
                    }

                        var tlsOptions = JSON.parse(JSON.stringify(options)); // deep copy (no functions in options)
                        delete tlsOptions.certificatePath;
                        delete tlsOptions.privateKeyPath;
                        delete tlsOptions.caPath;

                        tlsOptions.cert = certificate;
                        tlsOptions.key = key;
                        tlsOptions.ca = caCert;

                        syslogConnectionSingleton.connection = tls.connect(tlsOptions, connected.bind(this, log, options, tries));

                        syslogConnectionSingleton.connection.setEncoding('utf8');
                        syslogConnectionSingleton.connection.on('error', function(err) {
                            cleanupConnection(err, 'error');
                            retryLogic(loggingFunction.bind(this, options, log), tries);
                        });
                        syslogConnectionSingleton.connection.on('close', function(err) {
                            cleanupConnection(err, 'closed');
                            retryLogic(loggingFunction.bind(this, options, log), tries);
                        });
                        syslogConnectionSingleton.connection.on('end', function(err) {
                            cleanupConnection(err, 'ended');
                            retryLogic(loggingFunction.bind(this, options, log), tries);
                        });
                    });

            });
        });
    } else {
        logMessage(log, options, tries);
    }
};

function cleanupConnection(err, type) {
    console.warn('QRadar Syslog appender: connection ' + type + '. Error: ' + JSON.stringify(err, null, 2));
    if (syslogConnectionSingleton.connection) {
        syslogConnectionSingleton.connection.destroy();
        syslogConnectionSingleton.connection = null;
    }
    syslogConnectionSingleton.connecting = false;
};

function appender(options) {
    return loggingFunction.bind(this, options);
};

function connected(message, options, tries) {
    syslogConnectionSingleton.connecting = false;
    console.warn('QRadar Syslog appender: we have reconnected to QRadar. ' + 
        syslogConnectionSingleton.droppedMessages + ' messages have been dropped.');
    logMessage(message, options, tries);
};

function logMessage(log, options, tries) {
    // we are in circuit break mode. There is something wrong with the qradar connection. We won't try to
    // send any log messages to qradar until the circuit is connected again.
    if (syslogConnectionSingleton.circuitBreak) {
        syslogConnectionSingleton.droppedMessages++;
        return;
    }

    // we got disconnected. Try to reconnect
    if (!syslogConnectionSingleton.connection) {
        return retryLogic(loggingFunction.bind(this, options, log), tries);
    }

    // if theres a whitelist then only send those messages
    var logWhitelist = process.env.log4js_syslog_appender_whitelist;
    var categoriesToSend = logWhitelist && logWhitelist.split(',');
    if (logWhitelist && categoriesToSend.indexOf(log.categoryName) === -1) return;

    var formattedMessage = formatMessage(log.data.join(' | '), log.level && log.level.levelStr, options);

    syslogConnectionSingleton.connection.write(formattedMessage);
};

function levelToSeverity(levelStr) {
    var levels = [
        'FATAL',
        'ERROR',
        'WARN',
        'INFO',
        'DEBUG',
        'TRACE'
    ];

    return levels.indexOf(levelStr) !== -1 ? levels.indexOf(levelStr) + 1 : 4;
};

function formatMessage(message, levelStr, options) {
    // format as:
    // HEADER STRUCTURED_DATA MESSAGE
    // where HEADER = <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID
    // for details see the RFC here http://tools.ietf.org/html/rfc5424# .
    return util.format(
        '<%d>%d %s %s %s %d %s %s %s\n',
        16*8+levelToSeverity(levelStr), // hardcoded facility of local0 which translates to 16 according to RFC. TODO: use passed in facility.
        1,
        new Date().toJSON(),
        process.env.url || os.hostname(),
        options.product,
        process.pid,
        '-', 
        '-',
        message || '{}'
    );
};

function configure(config) {
    if (process.env.log4js_syslog_appender_enabled !== 'true') {
        return function() {};
    } else {
        if (config.appender) {
            log4js.loadAppender(config.appender.type);
            config.actualAppender = log4js.appenderMakers[config.appender.type](config.appender);
        }

        var options = {
            host: process.env.log4js_syslog_appender_host || config.options && config.options.host,
            port: process.env.log4js_syslog_appender_port || config.options && config.options.port,
            certificatePath: process.env.log4js_syslog_appender_certificatePath || config.options && config.options.certificatePath,
            privateKeyPath: process.env.log4js_syslog_appender_privateKeyPath || config.options && config.options.privateKeyPath,
            passphrase: process.env.log4js_syslog_appender_passphrase || config.options && config.options.passphrase || '',
            caPath: process.env.log4js_syslog_appender_caPath || config.options && config.options.caPath,
            facility: process.env.log4js_syslog_appender_facility || config.options && config.options.facility || '',
            tag: process.env.log4js_syslog_appender_tag || config.options && config.options.tag || '',
            leef: process.env.log4js_syslog_appender_leef || config.options && config.options.leef || '',
            vendor: process.env.log4js_syslog_appender_vendor || config.options && config.options.vendor || '',
            product: process.env.log4js_syslog_appender_product || config.options && config.options.product,
            product_version: process.env.log4js_syslog_appender_product_version || config.options && config.options.product_version || ''
        };

        if (!verifyOptions(options)) {
            return function() {};
        }
        util.log('Syslog appender is enabled');
        return appender(options);
    }
};

function verifyOptions(options) {
    var requiredOptions = [
        'log4js_syslog_appender_host',
        'log4js_syslog_appender_port',
        'log4js_syslog_appender_certificatePath',
        'log4js_syslog_appender_privateKeyPath',
        'log4js_syslog_appender_caPath',
        'log4js_syslog_appender_product'
    ];
    var valid = true;

    requiredOptions.forEach(function(option) {
        var key = option.substring(option.lastIndexOf('_')+1);
        if (!options[key]) {
            util.log('node-log4js-syslog-appender: ' + key + ' is a required option. It is settable with the ' + option + ' environment variable.');
            valid = false; // array.forEach is blocking
        }
    });

    return valid;
};