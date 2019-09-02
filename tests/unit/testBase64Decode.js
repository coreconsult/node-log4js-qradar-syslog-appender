/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */



const test = require('tape');
const base64Decoder = require('../../base64-decode');

test('Test decoded of known encoded text', function(t) {
  const decodedText = base64Decoder('SGVsbG9Xb3JsZDEK');
  t.equal(decodedText, 'HelloWorld1\n', 'was the text decoded properly?');
  t.end();
});