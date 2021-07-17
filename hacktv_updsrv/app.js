'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const strftime = require('strftime');
const net = require('net');
const CryptoJS = require('crypto-js');
const mime = require('mime-types');
const crc16 = require('node-crc16');
var WTVSec = require('./wtvsec.js');

var zdebug = true;

var ports = [];

var service_vault_dir = __dirname + "/ServiceVault";

String.prototype.reverse = function () {
    var splitString = this.split("");
    var reverseArray = splitString.reverse(); 
    var joinArray = reverseArray.join(""); 
    return joinArray;
}


function getServiceString(service) {
    if (service === "all") {
        var out = "";
        Object.keys(services_configured.services).forEach(function (k) {
            out += services_configured.services[k].toString() + "\n";
        });
        return out;
    } else {
        if (!services_configured.services[service]) {
            throw ("SERVICE ERROR: Attempted to provision unconfigured service: " + service)
        } else {
            return services_configured.services[service].toString();
        }
    }
}

var ssid_data = new Array();
var socket_buffer = new Array();
var socket_session_data = new Array();

var script_processing_timeout = 10; // seconds

function getSessionData(ssid, key = null) {
    if (typeof (ssid_data[ssid]) === 'undefined') return null;
    if (key == null) return ssid_data[ssid];
    else if (ssid_data[ssid][key]) return ssid_data[ssid][key];
    else return null;
}

function setSessionData(ssid, key, value) {
    if (typeof (ssid_data[ssid]) === 'undefined') ssid_data[ssid] = new Array();
    ssid_data[ssid][key] = value;
}


function getFile(path, deps = false) {
    var dir = null;
    if (deps) dir = __dirname + "/ServiceDeps/";
    else dir = __dirname + "/ServiceVault/";
    if (fs.lstatSync(dir + path).isFile()) {
        return fs.readFileSync(dir + path, {
            encoding: null,
            flags: 'r'
        });
    }
    return null;
}

function getFileExt(path) {
    return path.reverse().split(".")[0].reverse();
}

function doErrorPage(code) {
    var headers, data = null;
    switch (code) {
        case 404:
            data = "The service could not find the requested page.";
            headers = "404 "+data+"\r\n";
            headers += "Content-Type: text/html\r\n";
            break;
        case 400:
            data = "An internal server error has occured.";
            headers = "400 HackTV ran into a technical problem.\r\n";
            headers += "Content-Type: text/html\r\n";
            break;
        default:
            // what we send when we did not detect a wtv-url.
            // e.g. when a pc browser connects
            data = "Hello, stranger!";
            headers = "HTTP/1.1 200 OK\r\n";
            headers += "Content-Type: text/html\r\n";
            break;
    }
    return new Array(headers, data);
}

function getConType(path) {
    // custom contype for flashrom
    if (path.indexOf("wtv-flashrom") && (getFileExt(path).toLowerCase() == "rom" || getFileExt(path).toLowerCase() == "brom")) {
        return "binary/x-wtv-flashblock";
    } else if (getFileExt(path).toLowerCase() == "rmf") {
        return "audio/x-rmf";
    }    
    return mime.lookup(path);
}

async function processPath(socket, path, request_headers = new Array(), query = new Array(), service_name) {
    var headers, data = null;
    var request_is_direct_file = false;
    var request_is_async_js = false;
    path = path.replace(/\\/g, "/");
    try {
        try {
            // try to see if the exact request exists
            if (fs.lstatSync(path).isFile()) {
                request_is_direct_file = true;
            }
        } catch (e) {
            // do nothing its fine
        }

        if (request_is_direct_file) {
            // file exists, read it and return it
            console.log(" * Found " + path + " to handle request (Direct File Mode) [Socket " + socket.id +"]");
            var contype = getConType(path);
            request_is_async_js = true;
            headers = "200 OK\n"
            headers += "Content-Type: " + contype;
            fs.readFile(path, null, function (err, data) {
                sendToClient(socket, headers, data);
            });
        } else if (fs.existsSync(path + ".txt")) {
            // raw text format, entire payload expected (headers and content)
            console.log(" * Found " + path + ".txt to handle request (Raw TXT Mode) [Socket " + socket.id +"]");
            var file_raw = fs.readFileSync(path + ".txt").toString();
            if (file_raw.indexOf("\n\n") > 0) {
                var file_raw_split = file_raw.split("\n\n");
                headers = file_raw_split[0];
                file_raw_split.shift();
                data = file_raw_split.join("\n");
            } else if (file_raw.indexOf("\r\n\r\n") > 0) {
                var file_raw_split = file_raw.split("\r\n\r\n");
                headers = file_raw_split[0].replace(/\r/g, "");
                file_raw_split.shift();
                data = file_raw_split.join("\r\n");
            } else {
                headers = fdat;
            }
        } else if (fs.existsSync(path + ".async.js")) {
            // asynchronous js scripting, process with vars, must manually call sendToClient(socket, headers, data);
            // (hint: socket is already defined)
            // loaded script will have r/w access to any JavaScript vars this function does.
            // any query args are in an array named 'query'
            request_is_async_js = true;
            console.log(" * Found " + path + ".async.js to handle request (Async JS Interpreter mode) [Socket " + socket.id + "]");
            // expose var service_dir for script path to the root of the wtv-service
            var service_dir = service_vault_dir.replace(/\\/g, "/") + "/" + service_name;
            socket_session_data[socket.id].starttime = Math.floor(new Date().getTime() / 1000);
            fs.readFile(path + ".async.js", "utf-8", function (err, data) {
                eval(data);
            });
        } else if (fs.existsSync(path + ".js")) {
            // synchronous js scripting, process with vars, must set 'headers' and 'data' appropriately.
            // loaded script will have r/w access to any JavaScript vars this function does.
            // any query args are in an array named 'query'
            console.log(" * Found " + path + ".js to handle request (JS Interpreter mode) [Socket " + socket.id + "]");
            // expose var service_dir for script path to the root of the wtv-service
            var service_dir = service_vault_dir.replace(/\\/g, "/") + "/" + service_name;
            socket_session_data[socket.id].starttime = Math.floor(new Date().getTime() / 1000);
            var jscript_eval = fs.readFileSync(path + ".js").toString();
            eval(jscript_eval);
        }
        else if (fs.existsSync(path + ".html")) {
            // Standard HTML with no headers, WTV Style
            console.log(" * Found " + path + ".html  to handle request (HTML Mode) [Socket " + socket.id +"]");
            data = fs.readFileSync(path + ".html").toString();
            headers = "200 OK\n"
            headers += "Content-Type: text/html"
        } else {
            var errpage = doErrorPage(404);
            headers = errpage[0];
            data = errpage[1];
        }

        // 'headers' and 'data' should both be set with content by this point!


        if (headers == null && !request_is_async_js) {
            var errpage = doErrorPage(400);
            headers = errpage[0];
            data = errpage[1];
            console.log(" * Scripting or Data error: Headers were not defined. (headers,data) as follows:")
            console.log(socket.id,headers,data)
        }
        if (data === null) {
            data = '';
        }
    } catch (e) {
        var errpage = doErrorPage(400);
        headers = errpage[0];
        data = errpage[1] + "<br><br>The interpreter said:<br><pre>" + e.toString() + "</pre>";
        console.log(e);
    }
    if (!request_is_async_js) {
        sendToClient(socket, headers, data);
    }
}

async function processURL(socket, request_headers) {
    if (request_headers === null) {
        return;
    }
    var shortURL, headers, data = "";
    var query = new Array();
    if (request_headers['request_url']) {
        if (request_headers['request_url'].indexOf('?') >= 0) {
            shortURL = request_headers['request_url'].split('?')[0];
            var qraw = request_headers['request_url'].split('?')[1];
            if (qraw.length > 0) {
                qraw = qraw.split("&");
                for (let i = 0; i < qraw.length; i++) {
                    var k = qraw[i].split("=")[0];
                    if (k) {
                        query[k] = qraw[i].split("=")[1];
                    }
                }
                console.log(" * Request query:", query);
            }
        } else {
            shortURL = request_headers['request_url'];
        }

        if (shortURL.indexOf(':/') >= 0 && shortURL.indexOf('://') < 0) {
            var ssid = socket_session_data[socket.id].ssid;
            if (ssid == null) {
                ssid = request_headers['wtv-client-serial-number'];
            }
            var reqverb = "Request";
            if (request_headers['encrypted'] || request_headers['secure']) {
                reqverb = "Encrypted " + reqverb;
            }
            if (request_headers['psuedo-encryption']) {
                reqverb = "Psuedo-encrypted " + reqverb;
            }
            if (ssid != null) {
                console.log(" * " + reqverb + " for " + request_headers['request_url'] + " from WebTV SSID " + ssid, 'on', socket.id);
            } else {
                console.log(" * " + reqverb + " for " + request_headers['request_url'], 'on', socket.id);
            }
            // assume webtv since there is a :/ in the GET
            var service_name = shortURL.split(':/')[0];
            var urlToPath = service_vault_dir.replace(/\\/g, "/") + "/" + service_name + "/" + shortURL.split(':/')[1];
            console.log(" * Incoming headers on socket ID", socket.id, request_headers);
            processPath(socket, urlToPath, request_headers, query, service_name);
        } else if (shortURL.indexOf('http://') >= 0) {
            doHTTPProxy(socket, request_headers);
        } else {
            // error reading headers (no request_url provided)
            var errpage = doErrorPage(400);
            headers = errpage[0];
            data = errpage[1]
            socket_session_data[socket.id].close_me = true;
            sendToClient(socket, headers, data);
        }
    }
}

async function doHTTPProxy(socket, headers_obj) {
    console.log(socket.id, headers_obj);
}

async function headerStringToObj(headers, response = false) {
    var inc_headers = 0;
    var headers_obj = new Array();
    var headers_obj_pre = headers.split("\n");
    headers_obj_pre.forEach(function (d) {
        if (/^SECURE ON/.test(d) && !response) {
            headers_obj['secure'] = true;
            //socket_session_data[socket.id].secure_headers = true;
        } else if (/^([0-9]{3}) $/.test(d.substring(0, 4)) && response) {
            headers_obj['http_response'] = d.replace("\r", "");
        } else if (/^(GET |PUT |POST)$/.test(d.substring(0, 4)) && !response) {
            headers_obj['request'] = d.replace("\r", "");
            headers_obj['request_url'] = decodeURI(d.split(' ')[1]).replace("\r", "");
        } else if (d.indexOf(":") > 0) {
            var d_split = d.split(':');
            var header_name = d_split[0];
            if (headers_obj[header_name] != null) {
                header_name = header_name + "_" + inc_headers;
                inc_headers++;
            }
            d_split.shift();
            d = d_split.join(':');
            headers_obj[header_name] = (d).replace("\r", "");
            if (headers_obj[header_name].substring(0, 1) == " ") {
                headers_obj[header_name] = headers_obj[header_name].substring(1);
            }
        }
    });
    return headers_obj;
}

async function sendToClient(socket, headers_obj, data) {
    var headers = "";
    if (typeof (headers_obj) === 'string') {
        // string to header object
        headers_obj = await headerStringToObj(headers_obj, true);
    }

    // add Connection header if missing, default to Keep-Alive
    if (!headers_obj['Connection']) {
        headers_obj['Connection'] = "Keep-Alive";
        headers_obj = moveObjectElement('Connection', 'http_response', headers_obj);
    }

    // encrypt if needed
    if (socket_session_data[socket.id].secure == true) {
        var clen = null;
        if (typeof data.length !== 'undefined') {
            clen = data.length;
        } else if (typeof data.byteLength !== 'undefined') {
            clen = data.byteLength;
        }
        headers_obj['wtv-encrypted'] = 'true';
        headers_obj = moveObjectElement('wtv-encrypted', 'Connection', headers_obj);
        if (clen > 0) {
            console.log(" * Encrypting response to client ...")
            var enc_data = socket_session_data[socket.id].wtvsec.Encrypt(1, data);
            data = enc_data;
        }
    }

    // set content-length after encryption
    if (!headers_obj["Content-length"] && !headers_obj["Content-Length"]) {
        if (typeof data.length !== 'undefined') {
            headers_obj['Content-Length'] = data.length;
        } else if (typeof data.byteLength !== 'undefined') {
            headers_obj['Content-Length'] = data.byteLength;
        }
    }

    // header object to string
    console.log(" * Outgoing headers on socket ID", socket.id, headers_obj);
    Object.keys(headers_obj).forEach(function (k) {
        if (k == "http_response") {
            headers += headers_obj[k] + "\r\n";
        } else {
            if (k.indexOf('_') >= 0) {
                var j = k.split('_')[0];
                headers += j + ": " + headers_obj[k] + "\n";
            } else {
                headers += k + ": " + headers_obj[k] + "\n";
            }
        }
    });


    // send to client
    var toClient = null;
    if (typeof data == 'string') {
        toClient = headers + "\n" + data;
        socket.write(toClient);
    } else if (typeof data == 'object') {
        if (socket_session_data[socket.id].secure_headers == true) {
            // encrypt headers
            var enc_headers = socket_session_data[socket.id].wtvsec.Encrypt(1, headers + "\n");
            socket.write(new Uint8Array(concatArrayBuffer(enc_headers, data)));
        } else {
            socket.write(new Uint8Array(concatArrayBuffer(Buffer.from(headers + "\n"), data)));
        }
    }
    socket_session_data[socket.id].buffer = null;
    if (socket_session_data[socket.id].close_me) socket.end();
    if (headers_obj['Connection']) {
        if (headers_obj['Connection'].toLowerCase() == "close") {
            socket.destroy();
        }
    }
}

function concatArrayBuffer(buffer1, buffer2) {
    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
}

function moveObjectElement(currentKey, afterKey, obj) {
    var result = {};
    var val = obj[currentKey];
    delete obj[currentKey];
    var next = -1;
    var i = 0;
    if (typeof afterKey == 'undefined' || afterKey == null) afterKey = '';
    Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if ((afterKey == '' && i == 0) || next == 1) {
            result[currentKey] = val;
            next = 0;
        }
        if (k == afterKey) { next = 1; }
        result[k] = v;
        ++i;
    });
    if (next == 1) {
        result[currentKey] = val;
    }
    if (next !== -1) return result; else return obj;
}

function headersAreStandard(string, verbose) {
    // the test will see the binary compressed/enrypted data as ASCII, so a generic "isAscii"
    // is not suffuicent. This checks for characters expected in unecrypted headers, and returns
    // true only if every character in the string matches the regex. Once we know the string is binary
    // we can better process it with the raw base64 data in processRequest() below.
    var test = /^([A-Za-z0-9\+\/\=\-\.\,\ \"\;\:\?\&\r\n\(\)\%\<\>\_]{8,})$/.test(string);
    if (verbose) {
        if (zdebug) console.log(" # Request is ascii: " + test);
        if (zdebug) console.log(" # Request is SECURE ON: " + /^SECURE ON/.test(string));
    }
    return test;
}

async function processRequest(socket, data_hex, returnHeadersBeforeSecure = false, encryptedRequest = false) {
    var url = "";
    var data = CryptoJS.enc.Latin1.stringify(CryptoJS.enc.Hex.parse(data_hex));

    var headers = new Array();
    if (typeof data === "string") {
        if (data.length > 1) {
            if (data.indexOf("\r\n\r\n") != -1) {
                data = data.split("\r\n\r\n")[0];
            } else {
                data = data.split("\n\n")[0];
            }
            if (headersAreStandard(data)) {
                headers = await headerStringToObj(data);
            } else if (!returnHeadersBeforeSecure) {
                // if its a POST request, assume its a binary blob and not encrypted (dangerous)
                if (!encryptedRequest) {
                    // its not a POST and it 1failed the headersAreStandard test, so we think this is an encrypted blob
                    if (socket_session_data[socket.id].secure != true) {
                        // first time so reroll sessions
                        if (zdebug) console.log(" # [ UNEXPECTED BINARY BLOCK ] First sign of encryption, re-creating RC4 sessions for socket id", socket.id);
                        socket_session_data[socket.id].wtvsec = new WTVSec();
                        socket_session_data[socket.id].wtvsec.IssueChallenge();
                        socket_session_data[socket.id].wtvsec.SecureOn();
                        socket_session_data[socket.id].secure = true;
                    }
                    var enc_data = CryptoJS.enc.Hex.parse(data_hex.substring(header_length * 2));
                    if (enc_data.sigBytes > 0) {
                        var dec_data = CryptoJS.lib.WordArray.create(socket_session_data[socket.id].wtvsec.Decrypt(0, enc_data));
                        var secure_headers = await processRequest(socket, dec_data.toString(CryptoJS.enc.Hex), true, true);
                        headers['encrypted'] = true;
                        Object.keys(secure_headers).forEach(function (k, v) {
                            headers[k] = secure_headers[k];
                        });
                    }
                }
            }

            if (headers['wtv-client-serial-number'] != null) {
                socket_session_data[socket.id].ssid = headers['wtv-client-serial-number'];
            }
            if (headers['wtv-client-rom-type'] != null) {
                if (socket_session_data[socket.id].ssid) {
                    setSessionData(socket_session_data[socket.id].ssid, 'wtv-client-rom-type', headers['wtv-client-rom-type']);
                }
            }
            if (headers['wtv-incarnation'] != null) {
                if (socket_session_data[socket.id].wtvsec) {
                    socket_session_data[socket.id].wtvsec.set_incarnation(headers['wtv-incarnation']);
                } else {
                    setSessionData(socket_session_data[socket.id].ssid, 'incarnation', headers['wtv-incarnation'])
                }
            }

            if (returnHeadersBeforeSecure) {
                headers = await checkForPostData(socket, headers, data, data_hex, returnHeadersBeforeSecure);
                return headers;
            }

            if (headers['secure'] === true) {
                if (!socket_session_data[socket.id].wtvsec) {
                    console.log(" * Starting new WTVSec instance on socket", socket.id);
                    socket_session_data[socket.id].wtvsec = new WTVSec();
                    socket_session_data[socket.id].wtvsec.DecodeTicket(headers['wtv-ticket']);
                    socket_session_data[socket.id].wtvsec.ticket_b64 = headers['wtv-ticket'];
                    if (getSessionData(socket_session_data[socket.id].ssid, 'incarnation')) {
                        socket_session_data[socket.id].wtvsec.incarnation = getSessionData(socket_session_data[socket.id].ssid, 'incarnation');
                    }
                    socket_session_data[socket.id].wtvsec.SecureOn();
                }
                if (socket_session_data[socket.id].secure != true) {
                    // first time so reroll sessions
                    if (zdebug) console.log(" # [ SECURE ON BLOCK (" + socket.id + ")]");
                    socket_session_data[socket.id].secure = true;
                }
                if (!headers['request_url']) {

                    if (data_hex.indexOf("0d0a0d0a")) {
                        // \r\n\r\n
                        var header_length = data.length + 4;
                    } else if (data_hex.indexOf("0a0a")) {
                        // \n\n
                        var header_length = data.length + 2;
                    }
                    var enc_data = CryptoJS.enc.Hex.parse(data_hex.substring(header_length * 2));
                    if (enc_data.sigBytes > 0) {
                        if (headersAreStandard(enc_data.toString(CryptoJS.enc.Latin1), (!returnHeadersBeforeSecure && !encryptedRequest))) {
                            // some builds (like our targeted 3833), send SECURE ON but then unencrypted headers
                            if (zdebug) console.log(" # Psuedo-encrypted Request (SECURE ON)", "on", socket.id);
                            // don't actually encrypt output
                            headers['psuedo-encryption'] = true;
                            setSessionData(socket_session_data[socket.id].ssid, 'box-does-psuedo-encryption', true);
                            socket_session_data[socket.id].secure = false;
                            var secure_headers = await processRequest(socket, enc_data.toString(CryptoJS.enc.Hex), true);
                        } else {
                            // SECURE ON and detected encrypted data
                            setSessionData(socket_session_data[socket.id].ssid, 'box-does-psuedo-encryption', false);
                            var dec_data = CryptoJS.lib.WordArray.create(socket_session_data[socket.id].wtvsec.Decrypt(0, enc_data))
                            var secure_headers = await processRequest(socket, dec_data.toString(CryptoJS.enc.Hex), true);
                            if (zdebug) console.log(" # Encrypted Request (SECURE ON)", "on", socket.id);
                        }
                        // Merge new headers into existing headers object
                        Object.keys(secure_headers).forEach(function (k, v) {
                            headers[k] = secure_headers[k];
                        });
                    }
                }
            }
            headers = await checkForPostData(socket, headers, data);
            if (!headers['request_url']) {
                // still no url, likely lost encryption stream, tell client to relog
                socket_session_data[socket.id].secure = false;                
                headers = `200 OK
Connection: Keep-Alive
Expires: Wed, 09 Oct 1991 22:00:00 GMT
wtv-expire-all: wtv-head-waiter:
wtv-expire-all: wtv-1800:
wtv-visit: client:relog
Content-type: text/html`;
                data = '';
                delete socket_session_data[socket.id].wtvsec;
                sendToClient(socket, headers, data);
            } else {
                processURL(socket, headers);
            }
        } else {
            // socket error, terminate it.
            socket.destroy();
        }
    }
}

async function checkForPostData(socket, headers, data) {
    if (headers['request']) {
        if (headers['request'].substring(0, 4) == "POST") {
            if (data_hex.indexOf("0d0a0d0a") != -1) {
                // \r\n\r\n
                var header_length = data.length + 4;
            } else if (data_hex.indexOf("0a0a") != -1) {
                // \n\n
                var header_length = data.length + 2;
            }
            if (socket_session_data[socket.id].secure == true) {
                var enc_data = CryptoJS.enc.Hex.parse(socket_session_data[socket.id].buffer.toString(CryptoJS.enc.Hex).substring(header_length * 2));
                if (enc_data.sigBytes > 0) {
                    if (headersAreStandard(enc_data.toString(CryptoJS.enc.Latin1))) {
                        // some builds (like our targeted 3833), send SECURE ON but then unencrypted headers
                        if (zdebug) console.log(" # Psuedo-encrypted POST Content (SECURE ON)", "on", socket.id);
                        // don't actually encrypt output
                        headers['psuedo-encryption'] = true;
                        setSessionData(socket_session_data[socket.id].ssid, 'box-does-psuedo-encryption', true);
                        socket_session_data[socket.id].secure = false;
                        headers['post_data'] = await processRequest(socket, enc_data.toString(CryptoJS.enc.Hex), true);
                    } else {
                        // SECURE ON and detected encrypted data
                        setSessionData(socket_session_data[socket.id].ssid, 'box-does-psuedo-encryption', false);
                        headers['post_data'] = CryptoJS.lib.WordArray.create(socket_session_data[socket.id].wtvsec.Decrypt(0, enc_data))
                        if (zdebug) console.log(" # Encrypted POST Content (SECURE ON)", "on", socket.id);
                    }
                }
            } else {
                if (zdebug) console.log(" # Unencrypted POST Content", "on", socket.id);
                headers['post_data'] = CryptoJS.enc.Hex.parse(socket_session_data[socket.id].buffer.toString(CryptoJS.enc.Hex).substring(header_length * 2));
            }
        }
    }
    return headers;
}

async function cleanupSocket(socket) {
    try {
        console.log(" * Destroying old WTVSec instance on disconnected socket", socket.id);
        delete socket_session_data[socket.id].buffer;

        delete socket_session_data[socket.id].wtvsec;
        delete socket_session_data[socket.id];
        socket.end();
    } catch (e) {
        console.log(" # Could not clean up socket data for socket ID", socket.id, e);
    }
}


async function handleSocket(socket) {
    // create unique socket id with client address and port
    socket.id = parseInt(crc16.checkSum(Buffer.from(String(socket.remoteAddress) + String(socket.remotePort), "utf8")).toString("hex"), 16);
    socket_session_data[socket.id] = [];
    socket.setEncoding('hex'); //set data encoding (either 'ascii', 'utf8', or 'base64')
    socket.on('data', function (data_hex) {
        socket.setTimeout(300);
        if (socket_session_data[socket.id].buffer) {
            socket_session_data[socket.id].buffer.concat(CryptoJS.enc.Hex.parse(data_hex));
        } else {
            socket_session_data[socket.id].buffer = CryptoJS.enc.Hex.parse(data_hex);
        }
    });

    socket.on('timeout', async function () {
        socket.setTimeout(0);
        // start the async chain
        processRequest(this, socket_session_data[socket.id].buffer.toString(CryptoJS.enc.Hex));
    });

    socket.on('error', (err) => {
        socket.end();
    });

    socket.on('end', function () {
        cleanupSocket(socket);
    });
}

var z_title = "zefie's wtv minisrv v" + require('./package.json').version;
console.log("**** Welcome to " + z_title + " ****");
console.log(" *** Reading service configuration...");
try {
    var services_configured = JSON.parse(fs.readFileSync(__dirname + "/services.json"));
} catch (e) {
    throw("ERROR: Could not read services.json", e);
}
var service_ip = services_configured.config.service_ip;
Object.keys(services_configured.services).forEach(function (k) {
    services_configured.services[k].name = k;
    if (!services_configured.services[k].host) {
        services_configured.services[k].host = service_ip;
    }
    if (services_configured.services[k].port && !services_configured.services[k].nobind) {
        ports.push(services_configured.services[k].port);
    }

    services_configured.services[k].toString = function () {
        var outstr = "wtv-service: name=" + this.name + " host=" + this.host + " port=" + this.port;
        if (this.flags) outstr += " flags=" + this.flags;
        if (this.connections) outstr += " flags=" + this.connections;
        if (k == "wtv-star") {
            outstr += "\nwtv-service: name=wtv-* host=" + this.host + " port=" + this.port;
            if (this.flags) outstr += " flags=" + this.flags;
            if (this.connections) outstr += " flags=" + this.connections;
        }
        return outstr;
    }
    console.log(" * Configured Service", k, "on Port", services_configured.services[k].port, "- Host", services_configured.services[k].host, "- Bind Port:", !services_configured.services[k].nobind);
})

var initstring = '';
ports.sort();

// de-duplicate ports in case user configured multiple services on same port
const bind_ports = [...new Set(ports)]

bind_ports.forEach(function (v) {
    try {
        var server = net.createServer(handleSocket);
        server.listen(v, '0.0.0.0');
        initstring += v + ", ";
    } catch (e) {
        throw ("Could not bind to port", v, e.toString());
    }
});
initstring = initstring.substring(0, initstring.length - 2);

console.log(" * Started server on ports " + initstring + "... Service IP is " + service_ip);

