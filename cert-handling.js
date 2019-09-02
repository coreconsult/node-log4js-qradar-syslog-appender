/* eslint-disable-next-line prefer-destructuring */
const inspect = require("util").inspect;
const fs = require("fs");

const base64Decode = require("./base64-decode");


function readBase64StringOrFile(base64, file, callback) {
  if (base64) {
    callback(null, base64Decode(base64));
  } else {
    fs.readFile(file, { encoding: "utf8" }, callback);
  }
}

function hasClientCert(options) {
  return (
    (options.certificateBase64 || options.certificatePath) &&
    (options.privateKeyBase64 || options.privateKeyPath)
  );
}
function hasCaCert(options) {
  return options.caBase64 || options.caPath;
}
// we only have a CA cert, so we can make sure the server is legit
function configureAuthedServer(options, callback) {
  readBase64StringOrFile(options.caBase64, options.caPath, function(
    err,
    caCert
  ) {
    if (err) {
      console.error(
        `Error while loading ca key from path: ${
          options.caPath
        } Error: ${inspect(err)}`
      );
      return;
    }
    options.caCert = caCert;
    callback(options, true);
  });
}
// set up mutual auth.
function configureMutualAuth(options, callback) {
  readBase64StringOrFile(
    options.certificateBase64,
    options.certificatePath,
    function(err, certificate) {
      if (err) {
        console.error(
          `Error while loading certificate from path: ${
            options.certificatePath
          } Error: ${inspect(err)}`
        );
        return;
      }
      options.certificate = certificate;
      readBase64StringOrFile(
        options.privateKeyBase64,
        options.privateKeyPath,
        function(_err, key) {
          if (_err) {
            console.error(
              `Error while loading private key from path: ${
                options.privateKeyPath
              } Error: ${inspect(_err)}`
            );
            return;
          }
          options.key = key;
          readBase64StringOrFile(options.caBase64, options.caPath, function(
            err2,
            caCert
          ) {
            if (err2) {
              console.error(
                `Error while loading ca key from path: ${
                  options.caPath
                } Error: ${inspect(err2)}`
              );
              return;
            }
            options.caCert = caCert;
            callback(options, true);
          });
        }
      );
    }
  );
}

module.exports = {
  readBase64StringOrFile,
  hasClientCert,
  configureMutualAuth,
  hasCaCert,
  configureAuthedServer
}
