## Brief ServiceVault Explaination

The server will look for a subdirectory under the running directory, called `ServiceVault` (might be user-configurable in the future).

Within that directory, it looks for a subdirectory named after the wtv-service URL requested.

The server will then look for files in sequential order when requesting a URL, stopping at the first match.

Let us use the URL `wtv-1800:/preregister` as an example. This is what the server would look for (in order):

- `./ServiceVault/wtv-1800/preregister` \[ [Example](zefie_wtvp_minisrv/ServiceVault/wtv-star/images/HackTVLogo.gif) \]
  - Exact file name match (*Direct File Mode*)
  - Server sends the raw file, with its content-type. No parsing is done on the file.
  - You do not need to do anything special with this format. 
- `./ServiceVault/wtv-1800/preregister.txt` \[ [Example](zefie_wtvp_minisrv/ServiceVault/wtv-home/splash.txt) \]
  - TXT file match (*Raw TXT Mode*)
  - Service parses and sends AS-IS.
  - You are expected to define headers
- `./ServiceVault/wtv-1800/preregister.async.js` \[ [Example](zefie_wtvp_minisrv/ServiceVault/wtv-flashrom/willie.async.js) \]
  - Asynchronous JS match (*Async JS Interpreter mode*)
  - Executes the JavaScript in asynchronous mode.
  - You are expected to call `sendToClient(socket,headers,data)` yourself, `socket` is already defined by the time your script runs, so you can just pass it through.
- `./ServiceVault/wtv-1800/preregister.js` \[ [Example](zefie_wtvp_minisrv/ServiceVault/wtv-home/home.js) \]
  - Synchronous JS match (*JS Interpreter mode*)
  - Executes the JavaScript in synchronous mode.
  - You are expected to define `headers` and `data` before the end of your script.
- `./ServiceVault/wtv-1800/preregister.html` \[ [Example](zefie_wtvp_minisrv/ServiceVault/wtv-home/zefie.html) \]
  - HTML match (*HTML mode*)
  - Like Direct File Mode, but you don't need to append `.html`.
  - You do not need to do anything special with this format.

The server will stop at the first result it finds using the order above.

So if you have `preregister.txt` and `preregister.js`, it will use `preregister.txt`, but not `preregister.js`.
