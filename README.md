# fork of IBM's node-log4js-syslog-appender

This module is a TLS capable syslog appender for node-log4js.

# License

[The MIT License (MIT)](LICENSE.txt)

# Usage

## Pre-requisites
- Use https://github.com/log4js-node/log4js-node for logging
- You must call `log4js.configure('./path/to/log4js.json')` somewhere in your application (as this will cause this appender to initialize) or set it up programmatically

## To upgrade
- `npm i @coreconsult/log4js-syslog-tls-appender@latest --save`

## To install
`npm i @coreconsult/log4js-syslog-tls-appender --save`
- Set the following environment variable to true in order to enable the appender: `export log4js_syslog_appender_enabled=true`
- The default behavior is all log messages will be send to syslog, you can override this behavior by
specifying which loggers' log messages to send via the comma separated list env var `export log4js_syslog_appender_whitelist=audit-logs`
- *For local deveopment only*: Add the following appender to your log4js.json file (note this is the minimal valid configuration):
```

process.env.log4js_syslog_appender_enabled = true;

{
        "type": "@coreconsult/log4js-syslog-tls-appender",
        "options": {
                "host": "your.super.secure.logserver.xyz",
                "port": "6514",
                "certificateBase64": Buffer.from('----BEGIN CERTIFICATE----\nASFsfasdfds\n....').toString('base64'),
                "privateKeyPath": "keys/IDS-key.pem",
                "caPath": "keys/ca.pem",
                "product": "thatbackend2.0",
                "url": "some app identifier"
          }
}
```
- For production environment (and in source), only push the following in the log4js.json file:
```
{
        "type": "log4js-qradar-syslog-appender",
        "options": {}
}
```
- Set the following env vars (in pipeline - values depending on your setup/app):
```
export log4js_syslog_appender_enabled=true
export log4js_syslog_appender_whitelist=audit-logs,audit-logs-v2
export log4js_syslog_appender_host=syslog.yourcorp.xyz
export log4js_syslog_appender_port=6514
export log4js_syslog_appender_product=backend2
export log4js_syslog_appender_url=myspecialTAG
```

## Use with default syslog

You can use this appender with any default UDP syslog in unencrypted mode.  The environment setup is very similar to above:

```
export log4js_syslog_appender_enabled=true
export log4js_syslog_appender_useUdpSyslog=true
export log4js_syslog_appender_whitelist=audit-logs,audit-logs-v2
export log4js_syslog_appender_host=localhost
export log4js_syslog_appender_port=514
export log4js_syslog_appender_product=backend3
export log4js_syslog_appender_url=tacticalTag
```


# Setting Certificates
There are two ways of setting the certs, either through a path (meaning you have to check it into a source control - kind of a nono or by setting the base64 encoded values as env vars - the right way).

## Option 1: Checking them into source control, then specifying the path to them
export log4js_syslog_appender_certificatePath=keys/IDS-crt.pem
export log4js_syslog_appender_privateKeyPath=keys/IDS-key.pem
export log4js_syslog_appender_caPath=keys/ca.pem

## Option 2: A more secure way is actually setting the cert itself as env vars.
Note: To shorten the length, we use the base64 encoded values of the certs.
export log4js_syslog_appender_certificateBase64=LS0tLS1CRUdJTiBDRVJUSUZJQ....
export log4js_syslog_appender_privateKeyBase64=LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0t...
export log4js_syslog_appender_caBase64=LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0t...

## Allow connections to servers with self signed certs.  By default, these connections will fail.
export log4js_syslog_appender_rejectUnauthorized=false
```
