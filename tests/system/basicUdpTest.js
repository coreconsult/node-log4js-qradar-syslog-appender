/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */



const test = require('tape');
const log4js = require('log4js');
const dgram = require('dgram');

test('Test message received by udp server', function(t) {
  t.plan(1);

  const server = dgram.createSocket('udp4');

  server.on('error', function(err) {
    console.log(`server error:\n${err.stack}`);
    server.close();
  });

  server.on('message', function(msg, rinfo) {
    console.log(`received message: ${msg.toString()}, ${rinfo}`);
    t.ok(msg, 'did the message get received over udp?');
    t.end();
    process.exit(0);
  });

  server.on('listening', function() {
    const address = server.address();
    console.log(`server listening on port 1514, address: ${address}`);
  });

  server.bind(1514, function(err) {
    if (err) {
      console.log(`Error setting up syslog server: ${  JSON.stringify(err, null, 2)}`);
      throw err;
    }

    log4js.configure({
      appenders: {
        qradar: {
          type: '@coreconsult/log4js-syslog-tls-appender',
          options: {
            host: 'localhost',
            port: '1514',
            useUdpSyslog: true,
            product: 'basic-udp-test'
          }
        }
      },
      categories: { default: { appenders: ['qradar'], level: 'debug' } }
    });
    const logger = log4js.getLogger('');
    logger.info('hai');

  });

});
